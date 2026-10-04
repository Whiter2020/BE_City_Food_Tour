const mongoose = require("mongoose");

const tripStopSchema = new mongoose.Schema({
  restaurant: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  order: { type: Number, required: true },
  diningMinutes: { type: Number, default: 30, min: 1, max: 480 },
  status: { type: String, enum: ["planned", "active", "en_route", "dining", "completed", "skipped"], default: "planned" },
  skipReason: { type: String, default: "" },
  plannedArrival: Date,
  plannedDeparture: Date,
  travelMinutes: { type: Number, default: 0 },
  waitingMinutes: { type: Number, default: 0 },
  completedAt: Date,
  arrivedAt: Date,
  diningStartedAt: Date,
  mealEndsAt: Date,
  restaurantSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: true });

const tripSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tour: { type: mongoose.Schema.Types.ObjectId, ref: "Tour", required: true },
  status: { type: String, enum: ["active", "completed", "cancelled"], default: "active" },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  lastRecalculatedAt: { type: Date, default: Date.now },
  currentLocation: { lat: Number, lon: Number, label: String },
  currentStopId: { type: mongoose.Schema.Types.ObjectId, default: null },
  stops: { type: [tripStopSchema], default: [] },
  routeGeometry: { type: mongoose.Schema.Types.Mixed, default: null },
  routeLegs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  navigationInstructions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  completedRouteHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("TripSession", tripSessionSchema);
