const Tour = require("../models/Tour");
const Restaurant = require("../models/Restaurant");

const geoapify = require("../utils/geoapify");

const populateTourRestaurants = (tour) => tour.populate("restaurants.restaurant");

///Bổ sung
// =======================================
// Meal time configuration
// =======================================

const MAIN_DISH_CATEGORIES = new Set([
  "main",
  "món chính",
  "mon chinh",
]);

const LIGHT_DISH_CATEGORIES = new Set([
  "appetizer",
  "khai vị",
  "khai vi",

  "dessert",
  "tráng miệng",
  "trang mieng",

  "drink",
  "drinks",
  "đồ uống",
  "do uong",
  "beverage",
]);


// Chuẩn hóa category món ăn
const normalizeDishCategory = (category) =>
  String(category || "")
    .trim()
    .toLowerCase();


// =======================================
// Tính thời gian ăn tại nhà hàng
//
// Có món chính -> 30 phút
// Chỉ khai vị / tráng miệng / đồ uống
// -> 20 phút
//
// Dữ liệu cũ chưa có category
// -> fallback 30 phút
// =======================================
const getMealTimeMinutes = (restaurant) => {
  const dishes = Array.isArray(
    restaurant?.dishes
  )
    ? restaurant.dishes
    : [];

  const categories = dishes
    .map((dish) =>
      normalizeDishCategory(
        dish?.category
      )
    )
    .filter(Boolean);

  // Có ít nhất một món chính
  if (
    categories.some((category) =>
      MAIN_DISH_CATEGORIES.has(category)
    )
  ) {
    return 30;
  }

  // Có món và tất cả đều là
  // khai vị / tráng miệng / nước uống
  if (
    categories.length > 0 &&
    categories.every((category) =>
      LIGHT_DISH_CATEGORIES.has(category)
    )
  ) {
    return 20;
  }

  // Dữ liệu cũ / category không xác định
  return 30;
};


// =======================================
// Tổng thời gian ăn của toàn bộ tour
// =======================================
const getTotalMealTimeMinutes = (
  restaurants
) =>
  (Array.isArray(restaurants)
    ? restaurants
    : []
  ).reduce(
    (total, item) =>
      total +
      Number(item?.estimatedTime || 0),
    0
  );


// =======================================
// Refresh estimatedTime của toàn bộ
// restaurant trong tour
//
// Dùng khi:
// - create tour
// - update tour
// - add restaurant
// - reorder
// - remove
//
// Giúp tour cũ cũng cập nhật lại
// nếu category món ăn thay đổi.
// =======================================
const refreshTourMealTimes = async (
  tour
) => {
  const restaurantIds =
    tour.restaurants.map(
      (item) =>
        item.restaurant?._id ||
        item.restaurant
    );

  if (!restaurantIds.length) {
    tour.totalTime = 0;
    return tour;
  }

  const restaurants =
    await Restaurant.find({
      _id: {
        $in: restaurantIds,
      },
    });

  const restaurantMap =
    new Map(
      restaurants.map(
        (restaurant) => [
          String(restaurant._id),
          restaurant
        ]
      )
    );

  tour.restaurants.forEach(
    (item) => {
      const restaurant =
        restaurantMap.get(
          String(
            item.restaurant?._id ||
            item.restaurant
          )
        );

      if (restaurant) {
        item.estimatedTime =
          getMealTimeMinutes(
            restaurant
          );
      }
    }
  );

  tour.totalTime =
    getTotalMealTimeMinutes(
      tour.restaurants
    );

  return tour;
};


// =======================================
// Parse HH:mm -> phút trong ngày
// =======================================
const parseTimeToMinutes = (
  time
) => {
  if (!time) {
    return null;
  }

  const match =
    String(time)
      .trim()
      .match(
        /^([01]\d|2[0-3]):([0-5]\d)$/
      );

  if (!match) {
    return null;
  }

  return (
    Number(match[1]) * 60 +
    Number(match[2])
  );
};


// =======================================
// Phút -> HH:mm
// =======================================
const formatMinutesAsTime = (
  minutes
) => {
  const normalized =
    ((Number(minutes) % 1440) +
      1440) %
    1440;

  const hours = String(
    Math.floor(normalized / 60)
  ).padStart(2, "0");

  const mins = String(
    normalized % 60
  ).padStart(2, "0");

  return `${hours}:${mins}`;
};


// =======================================
// Tính giờ bắt đầu ăn muộn nhất
//
// Ví dụ:
// closingTime = 22:00
// mealTime = 30
// => 21:30
// =======================================
const getLatestMealStartTime = (
  closingTime,
  mealTime
) => {
  const closingMinutes =
    parseTimeToMinutes(
      closingTime
    );

  if (
    closingMinutes === null
  ) {
    return null;
  }

  return formatMinutesAsTime(
    closingMinutes - mealTime
  );
};


// =======================================
// Kiểm tra thời gian ăn có vượt
// giờ đóng cửa hay không.
//
// Có hỗ trợ quán mở qua đêm:
// 18:00 -> 02:00
// =======================================
const isMealWithinOpeningHours = ({
  mealStartMinutes,
  openingTime,
  closingTime,
  mealTime,
}) => {
  const openingMinutes =
    parseTimeToMinutes(
      openingTime
    );

  const closingMinutes =
    parseTimeToMinutes(
      closingTime
    );

  // Nếu restaurant chưa có giờ
  // thì không chặn tour.
  if (
    openingMinutes === null ||
    closingMinutes === null
  ) {
    return true;
  }

  let openingAbs =
    openingMinutes;

  let closingAbs =
    closingMinutes;

  // Quán qua ngày hôm sau
  if (
    closingMinutes <=
    openingMinutes
  ) {
    closingAbs += 1440;

    // Ví dụ:
    // quán 18:00 -> 02:00
    // mealStart = 01:00
    // cần xem 01:00 thuộc ngày trước.
    if (
      mealStartMinutes <
      openingMinutes
    ) {
      openingAbs -= 1440;
      closingAbs -= 1440;
    }
  }

  return (
    mealStartMinutes >=
      openingAbs &&
    mealStartMinutes +
      mealTime <=
      closingAbs
  );
};


// =======================================
// Build schedule của tour
// dựa trên startTime + travel time
// + meal time
// =======================================
const buildMealSchedule = ({
  orderedStops,
  legTimesMinutes,
  startTime,
}) => {
  const startMinutes =
    parseTimeToMinutes(
      startTime
    );

  if (
    startMinutes === null
  ) {
    return {
      valid: false,
      message:
        "startTime phải có định dạng HH:mm, ví dụ 18:00",
    };
  }

  let currentMinutes =
    startMinutes;

  const schedule = [];

  for (
    let index = 0;
    index < orderedStops.length;
    index += 1
  ) {
    const stop =
      orderedStops[index];

    const restaurant =
      stop.restaurant;

    const travelMinutes =
      Number(
        legTimesMinutes?.[index] ||
          0
      );

    // Đi tới nhà hàng
    currentMinutes +=
      travelMinutes;

    const mealTime =
      Number(
        stop.estimatedTime ||
          getMealTimeMinutes(
            restaurant
          )
      );

    const mealStartMinutes =
      currentMinutes;

    const mealEndMinutes =
      currentMinutes +
      mealTime;

    const valid =
      isMealWithinOpeningHours({
        mealStartMinutes,
        openingTime:
          restaurant?.openingTime,
        closingTime:
          restaurant?.closingTime,
        mealTime,
      });

    const latestMealStartTime =
      getLatestMealStartTime(
        restaurant?.closingTime,
        mealTime
      );

    schedule.push({
      restaurantId:
        restaurant?._id,

      restaurantName:
        restaurant?.name,

      order:
        index + 1,

      travelTimeMinutes:
        travelMinutes,

      mealTimeMinutes:
        mealTime,

      openingTime:
        restaurant?.openingTime ||
        null,

      closingTime:
        restaurant?.closingTime ||
        null,

      latestMealStartTime,

      mealStartTime:
        formatMinutesAsTime(
          mealStartMinutes
        ),

      mealEndTime:
        formatMinutesAsTime(
          mealEndMinutes
        ),

      valid,
    });

    if (!valid) {
      return {
        valid: false,
        message:
          `Restaurant "${restaurant?.name}" cannot be completed before closing time`,
        failedRestaurant:
          schedule[
            schedule.length - 1
          ],
        schedule,
      };
    }

    currentMinutes =
      mealEndMinutes;
  }

  return {
    valid: true,

    schedule,

    totalElapsedMinutes:
      currentMinutes -
      startMinutes,
  };
};
///Kết thúc bổ sung

const clearRouteOptimization = (tour) => {
  tour.isOptimized = false;

  tour.totalDistance = 0;

  // Giữ lại tổng thời gian ăn
  // thay vì reset về 0.
  tour.totalTime =
    getTotalMealTimeMinutes(
      tour.restaurants
    );

  tour.routeGeometry = null;
  tour.optimizationSummary = null;
  tour.routeStartLocation =
    undefined;
};

const toPoint = (restaurant) => {
    if (
    !restaurant ||
    restaurant.lat == null ||
    restaurant.lng == null
  ) {
    return null;
  }

  const lat = Number(restaurant.lat);
  const lon = Number(restaurant.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return null;
  }

  return {
    lat,
    lon,
  };
};

const distanceKm = (from, to) => {
  const radiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const normalizeOptimizationObjective = (objective) =>
  objective === "driving-time" ? "driving-time" : "driving-distance";

const normalizeStartLocation = (startLocation) => {
  if (!startLocation) return null;

  const lat = Number(startLocation.lat);
  const lon = Number(startLocation.lon ?? startLocation.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    const error = new Error(
      "Start location must include valid latitude and longitude"
    );
    error.statusCode = 400;
    throw error;
  }

  return {
    lat,
    lon,
    label:
      String(
        startLocation.label ||
          "Custom start"
      )
        .trim()
        .slice(0, 120) ||
      "Custom start",
  };
};

const createStartNode = (startLocation) =>
  startLocation
    ? {
        restaurant: {
          lat: startLocation.lat,
          lng: startLocation.lon,
        },
        isStartLocation: true,
      }
    : null;

const getFallbackDistanceKm = (
  fromStop,
  toStop
) => {
  const from = toPoint(
    fromStop.restaurant
  );

  const to = toPoint(
    toStop.restaurant
  );

  return from && to
    ? distanceKm(from, to)
    : Number.POSITIVE_INFINITY;
};

const getFallbackTimeMinutes = (
  fromStop,
  toStop
) => {
  const distance =
    getFallbackDistanceKm(
      fromStop,
      toStop
    );

  return Number.isFinite(distance)
    ? (distance / 25) * 60
    : Number.POSITIVE_INFINITY;
};

const getMatrixMetric = (
  matrix,
  fromIndex,
  toIndex,
  metric
) => {
  const value =
    matrix?.[fromIndex]?.[toIndex]?.[
      metric
    ];

  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }

  return metric === "distance"
    ? value / 1000
    : value / 60;
};

const calculateStopCost = (
  stops,
  getCost,
  startNode = null
) => {
  if (stops.length === 0) {
    return 0;
  }

  let total = 0;

  let previous =
    startNode ||
    stops[0];

  const candidates =
    startNode
      ? stops
      : stops.slice(1);

  for (
    const stop of candidates
  ) {
    const legCost =
      getCost(
        previous,
        stop
      );

    if (
      !Number.isFinite(
        legCost
      )
    ) {
      return Number.POSITIVE_INFINITY;
    }

    total += legCost;
    previous = stop;
  }

  return total;
};

const orderByNearestStop = (
  stops,
  getCost,
  startNode = null
) => {
  if (stops.length <= 1) {
    return [...stops];
  }

  const remaining =
    [...stops];

  const ordered = [];

  let current =
    startNode;

  if (!current) {
    current =
      remaining.shift();

    ordered.push(
      current
    );
  }

  while (
    remaining.length > 0
  ) {
    let bestIndex = 0;

    let bestCost =
      Number.POSITIVE_INFINITY;

    remaining.forEach(
      (item, index) => {
        const currentCost =
          getCost(
            current,
            item
          );

        if (
          currentCost <
          bestCost
        ) {
          bestCost =
            currentCost;

          bestIndex =
            index;
        }
      }
    );

    const [next] =
      remaining.splice(
        bestIndex,
        1
      );

    ordered.push(
      next
    );

    current =
      next;
  }

  return ordered;
};

const estimateRouteFromStops = (
  stops,
  startNode = null
) => {
  const totalDistance =
    calculateStopCost(
      stops,
      getFallbackDistanceKm,
      startNode
    );

  const totalTime =
    calculateStopCost(
      stops,
      getFallbackTimeMinutes,
      startNode
    );

  return {
    totalDistance:
      Number.isFinite(
        totalDistance
      )
        ? totalDistance
        : 0,

    totalTime:
      Number.isFinite(
        totalTime
      )
        ? totalTime
        : 0,
  };
};

const roundMetric = (
  value,
  digits = 2
) =>
  Number(
    Number(
      value || 0
    ).toFixed(
      digits
    )
  );

const EXACT_OPTIMIZATION_LIMIT = 8;

const MAX_ROUTE_MATRIX_NODES = 31;

const findExactBestStopOrder = (
  stops,
  getCost,
  startNode = null
) => {
  if (stops.length <= 1) {
    return [...stops];
  }

  const hasCustomStart =
    Boolean(startNode);

  const fixedFirstStop =
    hasCustomStart
      ? null
      : stops[0];

  const remainingStops =
    hasCustomStart
      ? [...stops]
      : stops.slice(1);

  let bestOrder =
    [...stops];

  let bestCost =
    calculateStopCost(
      bestOrder,
      getCost,
      startNode
    );

  const search = (
    prefix,
    remaining
  ) => {
    if (
      remaining.length === 0
    ) {
      const candidate =
        fixedFirstStop
          ? [
              fixedFirstStop,
              ...prefix,
            ]
          : prefix;

      const candidateCost =
        calculateStopCost(
          candidate,
          getCost,
          startNode
        );

      if (
        candidateCost <
        bestCost
      ) {
        bestOrder =
          candidate;

        bestCost =
          candidateCost;
      }

      return;
    }

    remaining.forEach(
      (stop, index) => {
        search(
          [
            ...prefix,
            stop,
          ],
          [
            ...remaining.slice(
              0,
              index
            ),
            ...remaining.slice(
              index + 1
            ),
          ]
        );
      }
    );
  };

  search(
    [],
    remainingStops
  );

  return bestOrder;
};

const twoOptImprove = (
  stops,
  getCost,
  startNode = null
) => {
  if (stops.length <= 2) {
    return [...stops];
  }

  let best =
    [...stops];

  let bestCost =
    calculateStopCost(
      best,
      getCost,
      startNode
    );

  let improved = true;

  let passes = 0;

  const maxPasses = 50;

  const firstMutableIndex =
    startNode
      ? 0
      : 1;

  while (
    improved &&
    passes < maxPasses
  ) {
    improved = false;

    passes += 1;

    for (
      let i =
        firstMutableIndex;
      i <
        best.length - 1;
      i += 1
    ) {
      for (
        let k =
          i + 1;
        k <
          best.length;
        k += 1
      ) {
        const candidate = [
          ...best.slice(
            0,
            i
          ),

          ...best
            .slice(
              i,
              k + 1
            )
            .reverse(),

          ...best.slice(
            k + 1
          ),
        ];

        const candidateCost =
          calculateStopCost(
            candidate,
            getCost,
            startNode
          );

        if (
          candidateCost +
            0.001 <
          bestCost
        ) {
          best =
            candidate;

          bestCost =
            candidateCost;

          improved =
            true;
        }
      }
    }
  }

  return best;
};

const buildRoadCostMatrix = async (
  nodes
) => {
  if (
    !Array.isArray(nodes) ||
    nodes.length <= 1
  ) {
    return null;
  }

  const points =
    nodes.map(
      (node) =>
        toPoint(
          node.restaurant
        )
    );

  if (
    points.some(
      (point) => !point
    )
  ) {
    return null;
  }

  const matrixResponse =
    await geoapify.calculateRouteMatrix(
      points,
      "drive"
    );

  const matrix =
    matrixResponse?.sources_to_targets;

  const hasEveryRoadLeg =
    Array.isArray(matrix) &&
    matrix.length ===
      nodes.length &&
    matrix.every(
      (
        row,
        fromIndex
      ) =>
        Array.isArray(row) &&
        row.length ===
          nodes.length &&
        row.every(
          (
            leg,
            toIndex
          ) =>
            fromIndex ===
              toIndex ||
            (
              Number.isFinite(
                leg?.distance
              ) &&
              Number.isFinite(
                leg?.time
              )
            )
        )
    );

  if (
    !hasEveryRoadLeg
  ) {
    throw new Error(
      "Geoapify did not return a complete road distance matrix"
    );
  }

  return matrix;
};

const buildOptimizedStops = async (
  stops,
  options = {}
) => {
  const startLocation =
    normalizeStartLocation(
      options.startLocation
    );

  const objective =
    normalizeOptimizationObjective(
      options.optimizationObjective
    );

  const startNode =
    createStartNode(
      startLocation
    );

  const matrixNodes =
    startNode
      ? [
          startNode,
          ...stops,
        ]
      : stops;

  const invalidCoordinateStops =
    stops.filter(
      (stop) =>
        !toPoint(
          stop.restaurant
        )
    );

  if (
    invalidCoordinateStops.length >
    0
  ) {
    const error =
      new Error(
        "All restaurants in the route must have valid latitude and longitude"
      );

    error.statusCode =
      400;

    throw error;
  }

  // =======================================
  // Giới hạn số node
  // =======================================

  if (
    matrixNodes.length >
    MAX_ROUTE_MATRIX_NODES
  ) {
    const error =
      new Error(
        `Route optimization supports up to ${
          MAX_ROUTE_MATRIX_NODES -
          (startNode
            ? 1
            : 0)
        } stops for the selected starting point`
      );

    error.statusCode =
      400;

    throw error;
  }


  // =======================================
  // Route cost model
  // =======================================

  let costMatrix =
    null;

  let distanceModel =
    "haversine-estimate";

  let orderingProvider =
    "local";

  let getDistance =
    getFallbackDistanceKm;

  let getTime =
    getFallbackTimeMinutes;


  // =======================================
  // Ưu tiên Geoapify road matrix
  // Nếu fail -> Haversine fallback
  // =======================================

  try {
    costMatrix =
      await buildRoadCostMatrix(
        matrixNodes
      );

    if (
      costMatrix
    ) {
      const getIndex = (
        node
      ) =>
        matrixNodes.indexOf(
          node
        );

      getDistance = (
        fromNode,
        toNode
      ) =>
        getMatrixMetric(
          costMatrix,
          getIndex(
            fromNode
          ),
          getIndex(
            toNode
          ),
          "distance"
        );

      getTime = (
        fromNode,
        toNode
      ) =>
        getMatrixMetric(
          costMatrix,
          getIndex(
            fromNode
          ),
          getIndex(
            toNode
          ),
          "time"
        );

      distanceModel =
        "geoapify-road-matrix";

      orderingProvider =
        "geoapify";
    }
  } catch (
    matrixError
  ) {
    console.warn(
      "Geoapify route matrix failed, using Haversine fallback:",
      matrixError.message
    );
  }


  // =======================================
  // Objective:
  // driving-distance
  // hoặc
  // driving-time
  // =======================================

  const getObjectiveCost =
    objective ===
    "driving-time"
      ? getTime
      : getDistance;


  // =======================================
  // Tối ưu thứ tự nhà hàng
  // =======================================

  const useExactSearch =
    stops.length <=
    EXACT_OPTIMIZATION_LIMIT;

  const optimizedStops =
    useExactSearch
      ? findExactBestStopOrder(
          stops,
          getObjectiveCost,
          startNode
        )
      : twoOptImprove(
          orderByNearestStop(
            stops,
            getObjectiveCost,
            startNode
          ),
          getObjectiveCost,
          startNode
        );


  // =======================================
  // BEFORE
  //
  // Tính theo thứ tự ban đầu
  // =======================================

  const distanceBeforeKm =
    calculateStopCost(
      stops,
      getDistance,
      startNode
    );

  const timeBeforeMinutes =
    calculateStopCost(
      stops,
      getTime,
      startNode
    );


  // =======================================
  // AFTER
  //
  // Tính theo thứ tự đã tối ưu
  // =======================================

  const optimizedDistanceAfterKm =
    calculateStopCost(
      optimizedStops,
      getDistance,
      startNode
    );

  const optimizedTimeAfterMinutes =
    calculateStopCost(
      optimizedStops,
      getTime,
      startNode
    );


  // =======================================
  // SAVED TOUR
  //
  // Chỉ tính giữa các restaurant được
  // lưu trong Tour.
  //
  // Không tính startLocation tạm thời.
  // =======================================

  const savedTourDistanceAfterKm =
    calculateStopCost(
      optimizedStops,
      getDistance
    );

  const savedTourTimeAfterMinutes =
    calculateStopCost(
      optimizedStops,
      getTime
    );
  // =======================================
  // Travel time từng chặng
  //
  // Có startLocation:
  //
  // start
  //   ↓
  // restaurant 1
  //   ↓
  // restaurant 2
  //   ↓
  // ...
  //
  // Không có startLocation:
  //
  // restaurant 1 = 0 phút
  // restaurant 1 -> restaurant 2
  // ...
  // =======================================

  const optimizedLegTimesMinutes = [];

  if (
    optimizedStops.length > 0
  ) {
    // -----------------------------------
    // Có điểm bắt đầu
    // -----------------------------------

    if (
      startNode
    ) {
      let previous =
        startNode;

      for (
        const stop of
        optimizedStops
      ) {
        const legTime =
          getTime(
            previous,
            stop
          );

        if (
          !Number.isFinite(
            legTime
          )
        ) {
          const error =
            new Error(
              "Unable to calculate travel time for one of the route legs"
            );

          error.statusCode =
            422;

          throw error;
        }

        optimizedLegTimesMinutes.push(
          legTime
        );

        previous =
          stop;
      }
    }

    // -----------------------------------
    // Không có điểm bắt đầu
    // -----------------------------------

    else {
      // Restaurant đầu tiên
      // không cần travel time.
      optimizedLegTimesMinutes.push(
        0
      );

      for (
        let index = 1;
        index <
        optimizedStops.length;
        index += 1
      ) {
        const legTime =
          getTime(
            optimizedStops[
              index - 1
            ],
            optimizedStops[
              index
            ]
          );

        if (
          !Number.isFinite(
            legTime
          )
        ) {
          const error =
            new Error(
              "Unable to calculate travel time for one of the route legs"
            );

          error.statusCode =
            422;

          throw error;
        }

        optimizedLegTimesMinutes.push(
          legTime
        );
      }
    }
  }


  // =======================================
  // Objective Before / After
  // =======================================

  const objectiveBefore =
    objective ===
    "driving-time"
      ? timeBeforeMinutes
      : distanceBeforeKm;

  const objectiveAfter =
    objective ===
    "driving-time"
      ? optimizedTimeAfterMinutes
      : optimizedDistanceAfterKm;


  // =======================================
  // Improvement %
  // =======================================

  const improvementPercent =
    Number.isFinite(
      objectiveBefore
    ) &&
    objectiveBefore > 0
      ? Math.max(
          0,
          (
            (
              objectiveBefore -
              objectiveAfter
            ) /
            objectiveBefore
          ) * 100
        )
      : 0;


  // =======================================
  // Kết quả
  // =======================================

  return {
    orderedStops:
      optimizedStops,

    startLocation,

    optimization: {
      algorithm:
        useExactSearch
          ? "exact TSP"
          : "nearest-neighbor + 2-opt",

      objective,

      startPolicy:
        startLocation
          ? "custom-start-location"
          : "first-stop-fixed",

      startLocation,

      distanceModel,

      orderingProvider,

      exactSearchLimit:
        EXACT_OPTIMIZATION_LIMIT,

      // -------------------------------
      // Before optimization
      // -------------------------------

      distanceBeforeKm:
        roundMetric(
          distanceBeforeKm
        ),

      timeBeforeMinutes:
        roundMetric(
          timeBeforeMinutes,
          1
        ),

      // -------------------------------
      // After optimization
      // -------------------------------

      distanceAfterKm:
        roundMetric(
          optimizedDistanceAfterKm
        ),

      timeAfterMinutes:
        roundMetric(
          optimizedTimeAfterMinutes,
          1
        ),

      // -------------------------------
      // Saved tour
      // -------------------------------

      savedTourDistanceAfterKm:
        roundMetric(
          savedTourDistanceAfterKm
        ),

      savedTourTimeAfterMinutes:
        roundMetric(
          savedTourTimeAfterMinutes,
          1
        ),

      // -------------------------------
      // Travel time từng chặng
      // -------------------------------

      legTimesMinutes:
        optimizedLegTimesMinutes.map(
          (time) =>
            roundMetric(
              time,
              1
            )
        ),

      // -------------------------------
      // Improvement
      // -------------------------------

      improvementPercent:
        roundMetric(
          improvementPercent,
          1
        ),
    },
  };
};
///

// Tạo tour mới
const createTour = async (
  req,
  res
) => {
  try {
    const {
      name,
      description,
      restaurantIds,
      isPublic,
    } = req.body;

    if (
      !name ||
      !String(name).trim()
    ) {
      return res.status(400).json({
        message:
          "Tour name is required",
      });
    }

    if (
      !Array.isArray(
        restaurantIds
      ) ||
      restaurantIds.length === 0
    ) {
      return res.status(400).json({
        message:
          "A food tour needs at least one restaurant",
      });
    }

    // Lấy restaurant thật từ DB
    const restaurantDocs =
      await Restaurant.find({
        _id: {
          $in: restaurantIds,
        },
      });

    const restaurantMap =
      new Map(
        restaurantDocs.map(
          (restaurant) => [
            String(
              restaurant._id
            ),
            restaurant,
          ]
        )
      );

    // Kiểm tra restaurantId
    const missingRestaurants =
      restaurantIds.filter(
        (restaurantId) =>
          !restaurantMap.has(
            String(
              restaurantId
            )
          )
      );

    if (
      missingRestaurants.length
    ) {
      return res.status(400).json({
        message:
          "Some restaurants could not be found",

        restaurantIds:
          missingRestaurants,
      });
    }

    // Tạo danh sách restaurant
    // + tự tính meal time
    const restaurants =
      restaurantIds.map(
        (
          restaurantId,
          index
        ) => {
          const restaurant =
            restaurantMap.get(
              String(
                restaurantId
              )
            );

          return {
            restaurant:
              restaurantId,

            order:
              index + 1,

            estimatedTime:
              getMealTimeMinutes(
                restaurant
              ),

            estimatedCost:
              0,
          };
        }
      );

    const totalMealTime =
      getTotalMealTimeMinutes(
        restaurants
      );

    const newTour =
      new Tour({
        user:
          req.user.id,

        name:
          String(
            name
          ).trim(),

        description:
          description ||
          "",

        restaurants,

        // Lúc mới tạo chưa có
        // thời gian di chuyển.
        // totalTime = tổng thời gian ăn.
        totalTime:
          totalMealTime,

        estimatedTotalCost:
          0,

        isPublic:
          Boolean(
            isPublic
          ),
      });

    await newTour.save();

    await populateTourRestaurants(
      newTour
    );

    res.status(201).json({
      message:
        "Tour created successfully",

      tour:
        newTour,

      mealTimeMinutes:
        totalMealTime,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to create tour",
    });
  }
};

// Lấy tất cả tour của user đang đăng nhập
const getMyTours = async (
  req,
  res
) => {
  try {
    const tours =
      await Tour.find({
        user:
          req.user.id,
      })
        .populate(
          "restaurants.restaurant"
        )
        .sort({
          createdAt: -1,
        });

    res.json(
      tours
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to get tours",
    });
  }
};

// Lấy chi tiết 1 tour
const getTourById = async (
  req,
  res
) => {
  try {
    const tour =
      await Tour.findOne({
        _id:
          req.params.id,

        user:
          req.user.id,
      }).populate(
        "restaurants.restaurant"
      );

    if (!tour) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    res.json(
      tour
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to get tour",
    });
  }
};

const updateTour = async (
  req,
  res
) => {
  try {
    const {
      name,
      description,
      restaurantIds,
      isPublic,
    } = req.body;

    const tour =
      await Tour.findOne({
        _id:
          req.params.id,

        user:
          req.user.id,
      });

    if (!tour) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    if (
      name !== undefined
    ) {
      tour.name =
        name;
    }

    if (
      description !== undefined
    ) {
      tour.description =
        description;
    }

    if (
      isPublic !== undefined
    ) {
      tour.isPublic =
        Boolean(
          isPublic
        );
    }

    if (
      Array.isArray(
        restaurantIds
      )
    ) {
      if (
        restaurantIds.length ===
        0
      ) {
        return res.status(400).json({
          message:
            "A food tour needs at least one restaurant",
        });
      }

      const existingIds =
        tour.restaurants.map(
          (item) =>
            item.restaurant.toString()
        );

      const nextIds =
        restaurantIds.map(
          String
        );

      const routeHasChanged =
        existingIds.length !==
          nextIds.length ||
        existingIds.some(
          (
            restaurantId,
            index
          ) =>
            restaurantId !==
            nextIds[index]
        );

      const restaurantDocs =
        await Restaurant.find({
          _id: {
            $in:
              restaurantIds,
          },
        });

      const restaurantMap =
        new Map(
          restaurantDocs.map(
            (
              restaurant
            ) => [
              String(
                restaurant._id
              ),
              restaurant,
            ]
          )
        );

      const missingRestaurants =
        restaurantIds.filter(
          (
            restaurantId
          ) =>
            !restaurantMap.has(
              String(
                restaurantId
              )
            )
        );

      if (
        missingRestaurants.length
      ) {
        return res.status(400).json({
          message:
            "Some restaurants could not be found",

          restaurantIds:
            missingRestaurants,
        });
      }

      tour.restaurants =
        restaurantIds.map(
          (
            restaurantId,
            index
          ) => {
            const restaurant =
              restaurantMap.get(
                String(
                  restaurantId
                )
              );

            return {
              restaurant:
                restaurantId,

              order:
                index + 1,

              estimatedTime:
                getMealTimeMinutes(
                  restaurant
                ),

              estimatedCost:
                0,
            };
          }
        );

      tour.totalTime =
        getTotalMealTimeMinutes(
          tour.restaurants
        );

      if (
        routeHasChanged
      ) {
        clearRouteOptimization(
          tour
        );
      }
    }

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    res.json({
      message:
        "Tour updated successfully",

      tour,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to update tour",
    });
  }
};

const deleteTour = async (
  req,
  res
) => {
  try {
    const deleted =
      await Tour.findOneAndDelete({
        _id:
          req.params.id,

        user:
          req.user.id,
      });

    if (!deleted) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    res.json({
      message:
        "Tour deleted",
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to delete tour",
    });
  }
};

// Thêm nhà hàng vào tour
const addRestaurantToTour = async (
  req,
  res
) => {
  try {
    const {
      tourId,
      restaurantId,
      order,
    } = req.body;

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    // Kiểm tra nhà hàng có tồn tại không
    const restaurant =
      await Restaurant.findById(
        restaurantId
      );

    if (!restaurant) {
      return res.status(404).json({
        message:
          "Restaurant not found",
      });
    }

    // Thêm vào mảng restaurants
    tour.restaurants.push({
      restaurant:
        restaurantId,

      order:
        order ||
        tour.restaurants.length +
          1,

      estimatedTime:
        getMealTimeMinutes(
          restaurant
        ),

      estimatedCost:
        0,
    });

    tour.totalTime =
      getTotalMealTimeMinutes(
        tour.restaurants
      );

    clearRouteOptimization(
      tour
    );

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    res.json({
      message:
        "Restaurant added to tour",

      tour,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to add restaurant to tour",
    });
  }
};

// Sắp xếp lại thứ tự quán ăn trong tour
const optimizeTourWithFallback = async (
  req,
  res
) => {
  try {
    const tour =
      await Tour.findOne({
        _id:
          req.params.id,

        user:
          req.user.id,
      }).populate(
        "restaurants.restaurant"
      );

    if (!tour) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    if (
      tour.restaurants.length <
      1
    ) {
      return res.status(400).json({
        message:
          "A food tour needs at least one restaurant to optimize",
      });
    }

    // Recalculate meal times from the current Restaurant data
    // before optimizing a saved tour.
    await refreshTourMealTimes(
      tour
    );

    const {
      startLocation,
      optimizationObjective,
    } = req.body || {};

    const {
      orderedStops,
      optimization,
      startLocation:
        resolvedStartLocation,
    } =
      await buildOptimizedStops(
        tour.restaurants,
        {
          startLocation,
          optimizationObjective,
        }
      );

    orderedStops.forEach(
      (
        item,
        index
      ) => {
        item.order =
          index + 1;
      }
    );

    tour.restaurants =
      orderedStops;

    const startNode =
      createStartNode(
        resolvedStartLocation
      );

    const stopPoints =
      orderedStops.map(
        (item) =>
          toPoint(
            item.restaurant
          )
      );

    const canBuildGeoRoute =
      stopPoints.every(
        Boolean
      ) &&
      (
        !startNode ||
        Boolean(
          toPoint(
            startNode.restaurant
          )
        )
      );

    const waypoints =
      canBuildGeoRoute
        ? [
            ...(startNode
              ? [
                  toPoint(
                    startNode.restaurant
                  ),
                ]
              : []),

            ...stopPoints,
          ]
        : [];

    let route =
      null;

    let optimizedBy =
      "local";

    const routeEstimate =
      estimateRouteFromStops(
        orderedStops,
        startNode
      );

    const savedTourEstimate =
      estimateRouteFromStops(
        orderedStops
      );

    if (
      waypoints.length >=
      2
    ) {
      try {
        const routeData =
          await geoapify.calculateRoute(
            waypoints,
            "drive"
          );

        route =
          routeData.features?.[0] ||
          null;

        if (
          route?.properties
        ) {
          // A temporary starting point is not stored on Tour,
          // so persisted totals only cover saved stops.
          tour.totalDistance =
            resolvedStartLocation
              ? optimization.savedTourDistanceAfterKm
              : route.properties
                    .distance /
                  1000 ||
                savedTourEstimate.totalDistance;

          // totalTime is the total meal time of the stops.
          // Travel time is stored separately in optimization.routeTimeMinutes.
          tour.totalTime =
            getTotalMealTimeMinutes(
              tour.restaurants
            );

          optimizedBy =
            "geoapify";
        }
      } catch (
        routeError
      ) {
        console.warn(
          "Geoapify route failed, using local route estimate:",
          routeError.message
        );
      }
    }

    if (!route) {
      tour.totalDistance =
        resolvedStartLocation
          ? optimization.savedTourDistanceAfterKm
          : savedTourEstimate.totalDistance;

      // Keep the same meaning as create/update/clearRouteOptimization:
      // totalTime = total meal time.
      tour.totalTime =
        getTotalMealTimeMinutes(
          tour.restaurants
        );
    }

    tour.isOptimized =
      true;

    optimization.routeProvider =
      optimizedBy;

    optimization.routeDistanceKm =
      roundMetric(
        route?.properties
          ?.distance /
          1000 ||
          routeEstimate.totalDistance
      );

    optimization.routeTimeMinutes =
      roundMetric(
        route?.properties
          ?.time /
          60 ||
          routeEstimate.totalTime,
        1
      );

    tour.routeGeometry =
      route?.geometry ||
      null;

    tour.optimizationSummary =
      optimization;

    tour.routeStartLocation =
      resolvedStartLocation ||
      undefined;

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    res.json({
      message:
        "Tour optimized successfully",

      tour,

      route,

      optimizedBy,

      startLocation:
        resolvedStartLocation,

      optimization,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(
      error.statusCode ||
        500
    ).json({
      message:
        error.message ||
        "Failed to optimize tour",
    });
  }
};
const optimizeTourPreview = async (
  req,
  res
) => {
  try {
    const {
      restaurantIds,
      startLocation,
      optimizationObjective,
    } = req.body;

    if (
      !Array.isArray(
        restaurantIds
      ) ||
      restaurantIds.length <
        1
    ) {
      return res.status(400).json({
        message:
          "A food tour needs at least one restaurant to optimize",
      });
    }

    const restaurants =
      await Restaurant.find({
        _id: {
          $in:
            restaurantIds,
        },
      });

    const restaurantMap =
      new Map(
        restaurants.map(
          (
            restaurant
          ) => [
            restaurant._id.toString(),
            restaurant,
          ]
        )
      );

    const stops =
      restaurantIds
        .map(
          (
            restaurantId,
            index
          ) => {
            const restaurant =
              restaurantMap.get(
                String(
                  restaurantId
                )
              );

            if (!restaurant) {
              return null;
            }

            return {
              restaurant,
              order:
                index + 1,
            };
          }
        )
        .filter(Boolean);

    if (
      stops.length !==
      restaurantIds.length
    ) {
      return res.status(400).json({
        message:
          "Some restaurants could not be found",
      });
    }

    const {
      orderedStops,
      optimization,
      startLocation:
        resolvedStartLocation,
    } =
      await buildOptimizedStops(
        stops,
        {
          startLocation,
          optimizationObjective,
        }
      );

    const startNode =
      createStartNode(
        resolvedStartLocation
      );

    const stopPoints =
      orderedStops.map(
        (item) =>
          toPoint(
            item.restaurant
          )
      );

    const canBuildGeoRoute =
      stopPoints.every(
        Boolean
      ) &&
      (
        !startNode ||
        Boolean(
          toPoint(
            startNode.restaurant
          )
        )
      );

    const waypoints =
      canBuildGeoRoute
        ? [
            ...(startNode
              ? [
                  toPoint(
                    startNode.restaurant
                  ),
                ]
              : []),

            ...stopPoints,
          ]
        : [];

    let route =
      null;

    let optimizedBy =
      "local";

    const estimate =
      estimateRouteFromStops(
        orderedStops,
        startNode
      );

    if (
      waypoints.length >=
      2
    ) {
      try {
        const routeData =
          await geoapify.calculateRoute(
            waypoints,
            "drive"
          );

        route =
          routeData.features?.[0] ||
          null;

        if (
          route?.properties
        ) {
          optimizedBy =
            "geoapify";
        }
      } catch (
        routeError
      ) {
        console.warn(
          "Geoapify preview route failed, using local route estimate:",
          routeError.message
        );
      }
    }

    const totalDistance =
      route?.properties
        ?.distance
        ? route.properties
            .distance /
          1000
        : estimate.totalDistance;

    const totalTime =
      route?.properties
        ?.time
        ? route.properties
            .time /
          60
        : estimate.totalTime;

    optimization.routeProvider =
      optimizedBy;

    optimization.routeDistanceKm =
      roundMetric(
        totalDistance
      );

    optimization.routeTimeMinutes =
      roundMetric(
        totalTime,
        1
      );

    res.json({
      message:
        "Tour preview optimized successfully",

      restaurantIds:
        orderedStops.map(
          (item) =>
            item.restaurant._id.toString()
        ),

      totalDistance,

      totalTime,

      route,

      optimizedBy,

      startLocation:
        resolvedStartLocation,

      optimization,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(
      error.statusCode ||
        500
    ).json({
      message:
        error.message ||
        "Failed to optimize tour preview",
    });
  }
};

const geocodeStartLocation = async (
  req,
  res
) => {
  try {
    const address =
      String(
        req.body?.address ||
          ""
      ).trim();

    if (
      !address ||
      address.length >
        200
    ) {
      return res.status(400).json({
        message:
          "Please provide a valid starting address",
      });
    }

    const result =
      await geoapify.geocode(
        address
      );

    const [
      lon,
      lat,
    ] =
      result?.geometry
        ?.coordinates ||
      [];

    if (
      !Number.isFinite(
        lat
      ) ||
      !Number.isFinite(
        lon
      )
    ) {
      return res.status(404).json({
        message:
          "Starting address could not be located",
      });
    }

    res.json({
      startLocation: {
        lat,
        lon,
        label:
          result.properties
            ?.formatted ||
          address,
      },
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to locate starting address",
    });
  }
};

const reorderRestaurantsInTour = async (
  req,
  res
) => {
  try {
    const {
      tourId,
    } = req.params;

    const {
      restaurantIds,
    } = req.body;

    if (
      !Array.isArray(
        restaurantIds
      ) ||
      restaurantIds.length ===
        0
    ) {
      return res.status(400).json({
        message:
          "Danh sách restaurantIds không hợp lệ",
      });
    }

    const normalizedIds =
      restaurantIds.map(
        String
      );

    if (
      new Set(
        normalizedIds
      ).size !==
      normalizedIds.length
    ) {
      return res.status(400).json({
        message:
          "restaurantIds không được chứa phần tử trùng nhau",
      });
    }

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    if (
      normalizedIds.length !==
      tour.restaurants.length
    ) {
      return res.status(400).json({
        message:
          "Danh sách restaurantIds phải chứa đầy đủ tất cả nhà hàng trong tour",
      });
    }

    // Tạo map để tra cứu nhanh
    const restaurantMap =
      new Map();

    tour.restaurants.forEach(
      (
        item
      ) => {
        restaurantMap.set(
          item.restaurant.toString(),
          item
        );
      }
    );

    // Xây dựng lại mảng restaurants theo thứ tự mới
    const newRestaurants =
      [];

    normalizedIds.forEach(
      (
        id,
        index
      ) => {
        const existing =
          restaurantMap.get(
            id
          );

        if (
          existing
        ) {
          existing.order =
            index + 1;

          newRestaurants.push(
            existing
          );
        }
      }
    );

    // Đảm bảo request là một permutation đầy đủ của tour hiện tại.
    if (
      newRestaurants.length !==
      tour.restaurants.length
    ) {
      return res.status(400).json({
        message:
          "Một số restaurantId không tồn tại trong tour",
      });
    }

    tour.restaurants =
      newRestaurants;

    clearRouteOptimization(
      tour
    );

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    res.json({
      message:
        "Đã sắp xếp lại thứ tự quán ăn",

      tour,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to reorder restaurants",
    });
  }
};

// Xóa quán ăn khỏi tour
const removeRestaurantFromTour = async (
  req,
  res
) => {
  try {
    const {
      tourId,
      restaurantId,
    } = req.params;

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    const originalLength =
      tour.restaurants.length;

    // Xóa quán ăn khỏi mảng
    tour.restaurants =
      tour.restaurants.filter(
        (item) =>
          item.restaurant.toString() !==
          String(
            restaurantId
          )
      );

    if (
      tour.restaurants.length ===
      originalLength
    ) {
      return res.status(404).json({
        message:
          "Restaurant is not in this tour",
      });
    }

    // Cập nhật lại order
    tour.restaurants.forEach(
      (
        item,
        index
      ) => {
        item.order =
          index + 1;
      }
    );

    clearRouteOptimization(
      tour
    );

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    res.json({
      message:
        "Restaurant removed from tour",

      tour,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to remove restaurant from tour",
    });
  }
};

// Set Public / Private cho tour
const updateTourPrivacy = async (
  req,
  res
) => {
  try {
    const {
      isPublic,
    } = req.body;

    const tour =
      await Tour.findOne({
        _id:
          req.params.id,

        user:
          req.user.id,
      });

    if (!tour) {
      return res.status(404).json({
        message:
          "Tour not found",
      });
    }

    tour.isPublic =
      isPublic;

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    res.json({
      message:
        `Tour is now ${
          isPublic
            ? "Public"
            : "Private"
        }`,

      tour,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to update tour privacy",
    });
  }
};

// Lấy danh sách tour public (dành cho người khác xem)
const getPublicTours = async (
  req,
  res
) => {
  try {
    const tours =
      await Tour.find({
        isPublic:
          true,
      })
        .populate(
          "user",
          "username"
        )
        .populate(
          "restaurants.restaurant"
        )
        .sort({
          createdAt: -1,
        });

    res.json(
      tours
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    res.status(500).json({
      message:
        "Failed to get public tours",
    });
  }
};

module.exports = {
  createTour,

  getMyTours,

  getTourById,

  updateTour,

  deleteTour,

  addRestaurantToTour,

  removeRestaurantFromTour,

  updateTourPrivacy,

  getPublicTours,

  optimizeTour:
    optimizeTourWithFallback,

  optimizeTourPreview,

  geocodeStartLocation,

  reorderRestaurantsInTour,
};