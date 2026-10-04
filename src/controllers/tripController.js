const Tour = require("../models/Tour");
const TripSession = require("../models/TripSession");
const geoapify = require("../utils/geoapify");

const DEFAULT_DINING_MINUTES = 30;
const round = (value) => Math.round(Number(value || 0));

const normalizeLocation = (location) => {
  const lat = Number(location?.lat);
  const lon = Number(location?.lon ?? location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const error = new Error("Current location must include valid latitude and longitude");
    error.statusCode = 400;
    throw error;
  }
  return { lat, lon, label: String(location?.label || "Current location").slice(0, 120) };
};

const pointFor = (restaurant) => {
  const lat = Number(restaurant?.lat);
  const lon = Number(restaurant?.lng ?? restaurant?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
};

const distanceKm = (from, to) => {
  if (!from || !to) return 0;
  const r = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fallbackTravelMinutes = (from, to) => round((distanceKm(from, to) / 25) * 60);

const parseClock = (value) => {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

const atClock = (date, minutes, offset = 0) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + offset);
  result.setMinutes(minutes);
  return result;
};

// Finds the current or next service window and supports overnight schedules, e.g. 17:00-02:00.
const findServiceWindow = (arrival, openingTime, closingTime) => {
  const opening = parseClock(openingTime);
  const closing = parseClock(closingTime);
  if (opening == null || closing == null) return null;
  const overnight = closing <= opening;
  const windows = [-1, 0, 1].map((offset) => ({
    opensAt: atClock(arrival, opening, offset),
    closesAt: atClock(arrival, closing, offset + (overnight ? 1 : 0)),
  }));
  return windows.find(({ opensAt, closesAt }) => arrival >= opensAt && arrival < closesAt)
    || windows.find(({ opensAt }) => opensAt > arrival)
    || null;
};

const snapshotRestaurant = (restaurant) => ({
  _id: restaurant._id,
  name: restaurant.name,
  image: restaurant.image || "",
  address: restaurant.address || "",
  lat: restaurant.lat,
  lng: restaurant.lng,
  openingTime: restaurant.openingTime || "",
  closingTime: restaurant.closingTime || "",
});

const buildNearestOrder = (stops, location) => {
  const remaining = [...stops];
  const ordered = [];
  let current = location;
  while (remaining.length) {
    let index = 0;
    let best = Infinity;
    remaining.forEach((stop, candidateIndex) => {
      const cost = distanceKm(current, pointFor(stop.restaurantSnapshot || stop.restaurant));
      if (cost < best) { best = cost; index = candidateIndex; }
    });
    const [next] = remaining.splice(index, 1);
    ordered.push(next);
    current = pointFor(next.restaurantSnapshot || next.restaurant) || current;
  }
  return ordered;
};

const scheduleStops = (stops, startLocation, startedAt) => {
  let point = startLocation;
  let clock = new Date(startedAt);
  const remaining = [...stops];
  const scheduled = [];
  while (remaining.length) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    remaining.forEach((candidate, index) => {
      const candidatePoint = pointFor(candidate.restaurantSnapshot || candidate.restaurant);
      const candidateDistance = candidatePoint ? distanceKm(point, candidatePoint) : Infinity;
      if (candidateDistance < nearestDistance) { nearestDistance = candidateDistance; nearestIndex = index; }
    });
    const [source] = remaining.splice(nearestIndex, 1);
    const restaurant = source.restaurantSnapshot || source.restaurant;
    const restaurantPoint = pointFor(restaurant);
    const travelMinutes = restaurantPoint ? fallbackTravelMinutes(point, restaurantPoint) : 0;
    const arrival = new Date(clock.getTime() + travelMinutes * 60000);
    const diningMinutes = Math.max(1, Number(source.diningMinutes ?? source.estimatedTime) || DEFAULT_DINING_MINUTES);
    const window = findServiceWindow(arrival, restaurant?.openingTime, restaurant?.closingTime);
    const serviceStart = window && arrival < window.opensAt ? window.opensAt : arrival;
    const waitingMinutes = Math.max(0, round((serviceStart - arrival) / 60000));
    const departure = new Date(serviceStart.getTime() + diningMinutes * 60000);
    const skipped = Boolean(window && departure > window.closesAt);
    const stop = {
      restaurant: restaurant?._id || source.restaurant,
      restaurantSnapshot: snapshotRestaurant(restaurant),
      order: scheduled.length + 1,
      diningMinutes,
      travelMinutes,
      waitingMinutes,
      plannedArrival: arrival,
      plannedDeparture: departure,
      status: skipped ? "skipped" : "planned",
      skipReason: skipped ? "Closed before the planned meal can finish" : "",
    };
    if (!skipped) { point = restaurantPoint || point; clock = departure; }
    scheduled.push(stop);
  }
  return scheduled;
};

const routeForStops = async (startLocation, stops) => {
  const points = [startLocation, ...stops.filter((stop) => stop.status !== "skipped").map((stop) => pointFor(stop.restaurantSnapshot)).filter(Boolean)];
  if (points.length < 2) return null;
  try {
    const data = await geoapify.calculateRoute(points, "drive");
    return data.features?.[0]?.geometry || null;
  } catch (error) {
    console.warn("Trip route geometry unavailable:", error.message);
    return null;
  }
};

const instructionSteps = (feature) => {
  const legs = feature?.properties?.legs || [];
  return legs.flatMap((leg) => leg.steps || []).map((step) => {
    const instruction = step.instruction || step;
    return {
      text: instruction.text || instruction.post_transition_instruction || instruction.transition_instruction || "Continue on the route",
      type: instruction.type || "Straight",
      distanceMeters: Math.round(Number(step.distance || 0)),
    };
  }).filter((step) => step.text);
};

const navigationForCurrentStop = async (startLocation, trip) => {
  const current = getCurrentStop(trip, ["en_route", "active"]);
  const destination = pointFor(current?.restaurantSnapshot);
  if (!current || !destination) return [];
  try {
    const data = await geoapify.calculateRoute(
      [startLocation, destination],
      "drive",
      { details: "instruction_details", lang: "en" },
    );
    return instructionSteps(data.features?.[0]);
  } catch (error) {
    console.warn("Turn-by-turn instructions unavailable:", error.message);
    return [];
  }
};

const sameId = (left, right) => String(left || "") === String(right || "");

const getCurrentStop = (trip, statuses = []) => {
  const byId = trip.currentStopId && trip.stops.find((stop) => sameId(stop._id, trip.currentStopId));
  if (byId && (!statuses.length || statuses.includes(byId.status))) return byId;
  return trip.stops.find((stop) => !statuses.length || statuses.includes(stop.status));
};

const routeLegFor = async (from, toStop, status) => {
  const destination = pointFor(toStop.restaurantSnapshot);
  if (!from || !destination) return null;
  try {
    const data = await geoapify.calculateRoute(
      [from, destination], "drive", { details: "instruction_details", lang: "en" },
    );
    const feature = data.features?.[0];
    return {
      toStopId: toStop._id,
      from,
      to: destination,
      geometry: feature?.geometry || null,
      instructions: instructionSteps(feature),
      status,
    };
  } catch (error) {
    console.warn("Trip route leg unavailable:", error.message);
    return { toStopId: toStop._id, from, to: destination, geometry: null, instructions: [], status };
  }
};

const buildRouteLegs = async (startLocation, stops) => {
  const visibleStops = stops.filter((stop) => stop.status !== "skipped" && pointFor(stop.restaurantSnapshot));
  const legs = [];
  let origin = startLocation;
  for (const stop of visibleStops) {
    const leg = await routeLegFor(origin, stop, stop.status === "en_route" || stop.status === "active" ? "active" : "future");
    if (leg) legs.push(leg);
    origin = pointFor(stop.restaurantSnapshot) || origin;
  }
  return legs;
};

const syncTripLegs = async (trip, startLocation) => {
  const remaining = trip.stops.filter((stop) => ["en_route", "active", "planned"].includes(stop.status));
  trip.routeLegs = await buildRouteLegs(startLocation, remaining);
  trip.routeGeometry = trip.routeLegs.find((leg) => leg.status === "active")?.geometry || null;
  const activeLeg = trip.routeLegs.find((leg) => leg.status === "active");
  trip.navigationInstructions = activeLeg?.instructions || [];
};

// Completed, skipped and the current stop are immutable. Only future planned stops are reordered.
const replanRemainingStops = async (trip, startLocation, startTime) => {
  const frozen = trip.stops.filter((stop) => ["completed", "active", "en_route", "dining", "skipped"].includes(stop.status));
  const remaining = trip.stops.filter((stop) => stop.status === "planned");
  const scheduled = scheduleStops(remaining, startLocation, startTime);
  trip.stops = [...frozen, ...scheduled];
  trip.stops.forEach((stop, index) => { stop.order = index + 1; });
  const routeStops = [
    ...trip.stops.filter((stop) => ["en_route", "active"].includes(stop.status)),
    ...scheduled,
  ];
  await syncTripLegs(trip, startLocation, routeStops);
  return scheduled;
};

const startTrip = async (req, res) => {
  try {
    const tour = await Tour.findOne({ _id: req.params.tourId, user: req.user.id }).populate("restaurants.restaurant");
    if (!tour) return res.status(404).json({ message: "Tour not found" });
    const currentLocation = normalizeLocation(req.body?.startLocation);
    const startedAt = req.body?.startedAt ? new Date(req.body.startedAt) : new Date();
    if (Number.isNaN(startedAt.getTime())) return res.status(400).json({ message: "Invalid start time" });
    const stops = scheduleStops(tour.restaurants, currentLocation, startedAt);
    const firstPlanned = stops.find((stop) => stop.status === "planned");
    if (firstPlanned) firstPlanned.status = "en_route";
    const trip = new TripSession({ user: req.user.id, tour: tour._id, startedAt, currentLocation, currentStopId: firstPlanned?._id || null, stops, status: firstPlanned ? "active" : "completed" });
    await syncTripLegs(trip, currentLocation);
    await trip.save();
    res.status(201).json({ message: "Tour started", trip: trip.toObject() });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to start tour" });
  }
};

const getTrip = async (req, res) => {
  try {
    const trip = await TripSession.findOne({ _id: req.params.tripId, user: req.user.id });
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    res.json(trip.toObject());
  } catch (error) { res.status(500).json({ message: "Failed to load trip" }); }
};

const arriveAtCurrentStop = async (req, res) => {
  try {
    const trip = await TripSession.findOne({ _id: req.params.tripId, user: req.user.id });
    if (!trip || trip.status !== "active") return res.status(404).json({ message: "Active trip not found" });
    const current = getCurrentStop(trip, ["en_route", "active"]);
    if (!current) return res.status(400).json({ message: "There is no stop to mark as arrived" });
    const arrivedAt = new Date();
    current.status = "dining";
    trip.currentStopId = current._id;
    current.arrivedAt = arrivedAt;
    current.diningStartedAt = arrivedAt;
    current.mealEndsAt = new Date(arrivedAt.getTime() + current.diningMinutes * 60000);
    const destination = pointFor(current.restaurantSnapshot);
    if (destination) trip.currentLocation = { ...destination, label: current.restaurantSnapshot.name };
    const completedLeg = (trip.routeLegs || []).find((leg) => sameId(leg.toStopId, current._id));
    await replanRemainingStops(trip, trip.currentLocation, current.mealEndsAt);
    trip.routeLegs = [
      ...(completedLeg ? [{ ...completedLeg, status: "completed" }] : []),
      ...(trip.routeLegs || []),
    ];
    trip.routeGeometry = null;
    trip.navigationInstructions = [];
    trip.lastRecalculatedAt = arrivedAt;
    await trip.save();
    res.json({ message: "Meal time started", trip: trip.toObject() });
  } catch (error) { console.error(error); res.status(500).json({ message: "Failed to mark arrival" }); }
};

const completeCurrentStop = async (req, res) => {
  try {
    const trip = await TripSession.findOne({ _id: req.params.tripId, user: req.user.id });
    if (!trip || trip.status !== "active") return res.status(404).json({ message: "Active trip not found" });
    // `active` is supported for TripSessions created before the En route/Dining flow.
    const active = getCurrentStop(trip, ["dining", "active"]);
    if (!active) return res.status(400).json({ message: "Arrive at the stop before continuing" });
    active.status = "completed";
    active.completedAt = new Date();
    trip.completedRouteHistory.push({
      stopId: active._id,
      from: trip.currentLocation,
      restaurant: active.restaurantSnapshot,
      geometry: (trip.routeLegs || []).find((leg) => sameId(leg.toStopId, active._id))?.geometry || null,
      completedAt: active.completedAt,
    });
    const destination = pointFor(active.restaurantSnapshot);
    if (destination) trip.currentLocation = { ...destination, label: active.restaurantSnapshot.name };
    await replanRemainingStops(trip, trip.currentLocation, active.completedAt);
    const next = trip.stops.find((stop) => stop.status === "planned");
    if (next) {
      next.status = "en_route";
      trip.currentStopId = next._id;
      await syncTripLegs(trip, trip.currentLocation);
    } else {
      trip.status = "completed";
      trip.completedAt = active.completedAt;
      trip.currentStopId = null;
      trip.routeLegs = [];
      trip.routeGeometry = null;
      trip.navigationInstructions = [];
    }
    trip.lastRecalculatedAt = active.completedAt;
    await trip.save();
    res.json({ message: next ? "Stop completed" : "Tour completed", trip: trip.toObject() });
  } catch (error) { console.error(error); res.status(500).json({ message: "Failed to complete stop" }); }
};

const recalculateTrip = async (req, res) => {
  try {
    const trip = await TripSession.findOne({ _id: req.params.tripId, user: req.user.id });
    if (!trip || trip.status !== "active") return res.status(404).json({ message: "Active trip not found" });
    const currentLocation = normalizeLocation(req.body?.startLocation);
    const recalculatedAt = req.body?.at ? new Date(req.body.at) : new Date();
    if (Number.isNaN(recalculatedAt.getTime())) return res.status(400).json({ message: "Invalid recalculation time" });
    const diningStop = trip.stops.find((stop) => stop.status === "dining");
    const diningLocation = diningStop ? pointFor(diningStop.restaurantSnapshot) : null;
    const plannedStartTime = diningStop?.mealEndsAt && new Date(diningStop.mealEndsAt) > recalculatedAt
      ? new Date(diningStop.mealEndsAt)
      : recalculatedAt;
    const routeStartLocation = diningLocation
      ? { ...diningLocation, label: diningStop.restaurantSnapshot.name }
      : currentLocation;
    const scheduled = await replanRemainingStops(trip, routeStartLocation, plannedStartTime);
    trip.currentLocation = routeStartLocation;
    trip.lastRecalculatedAt = recalculatedAt;
    await trip.save();
    res.json({ message: "Remaining route recalculated", trip: trip.toObject() });
  } catch (error) { console.error(error); res.status(error.statusCode || 500).json({ message: error.message || "Failed to recalculate trip" }); }
};

module.exports = { startTrip, getTrip, arriveAtCurrentStop, completeCurrentStop, recalculateTrip };
