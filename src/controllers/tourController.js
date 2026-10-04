const mongoose = require("mongoose");
const Tour = require("../models/Tour");
const Restaurant = require("../models/Restaurant");

const geoapify = require("../utils/geoapify");

const populateTourRestaurants = (tour) =>
  tour.populate("restaurants.restaurant");

const makeHttpError = (
  statusCode,
  message,
  details = undefined
) => {
  const error = new Error(message);
  error.statusCode = statusCode;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
};

const parseBooleanValue = (
  value,
  fieldName = "value"
) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1") {
    return true;
  }

  if (value === 0 || value === "0") {
    return false;
  }

  if (typeof value === "string") {
    const normalized =
      value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  throw makeHttpError(
    400,
    `${fieldName} must be a boolean`
  );
};

const normalizeRestaurantIds = (
  restaurantIds,
  {
    allowEmpty = false,
    fieldName = "restaurantIds",
  } = {}
) => {
  if (!Array.isArray(restaurantIds)) {
    throw makeHttpError(
      400,
      `${fieldName} must be an array`
    );
  }

  if (
    !allowEmpty &&
    restaurantIds.length === 0
  ) {
    throw makeHttpError(
      400,
      "A food tour needs at least one restaurant"
    );
  }

  const normalizedIds =
    restaurantIds.map(
      (restaurantId) =>
        String(
          restaurantId || ""
        ).trim()
    );

  const invalidIds =
    normalizedIds.filter(
      (restaurantId) =>
        !mongoose.isValidObjectId(
          restaurantId
        )
    );

  if (invalidIds.length > 0) {
    throw makeHttpError(
      400,
      "Some restaurantIds are invalid MongoDB ObjectIds",
      {
        restaurantIds:
          invalidIds,
      }
    );
  }

  if (
    new Set(normalizedIds).size !==
    normalizedIds.length
  ) {
    throw makeHttpError(
      400,
      "restaurantIds must not contain duplicates"
    );
  }

  return normalizedIds;
};

const ensureValidObjectId = (
  value,
  fieldName
) => {
  const normalized =
    String(value || "").trim();

  if (
    !mongoose.isValidObjectId(
      normalized
    )
  ) {
    throw makeHttpError(
      400,
      `${fieldName} must be a valid MongoDB ObjectId`
    );
  }

  return normalized;
};

const sendControllerError = (
  res,
  error,
  fallbackMessage
) => {
  const statusCode =
    error?.statusCode ||
    (
      error?.name === "CastError"
        ? 400
        : 500
    );

  const payload = {
    message:
      error?.statusCode ||
      error?.name === "CastError"
        ? error.message
        : fallbackMessage,
  };

  if (
    error?.details !== undefined
  ) {
    Object.assign(
      payload,
      error.details
    );
  }

  return res
    .status(statusCode)
    .json(payload);
};


//
// =======================================
// MEAL TIME CONFIGURATION
// =======================================
//

const MAIN_DISH_CATEGORIES =
  new Set([
    "main",
    "món chính",
    "mon chinh",
  ]);

const LIGHT_DISH_CATEGORIES =
  new Set([
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

const normalizeDishCategory = (
  category
) =>
  String(category || "")
    .trim()
    .toLowerCase();


//
// =======================================
// Tính thời gian ăn tại nhà hàng
//
// Có món chính:
// -> 30 phút
//
// Chỉ có:
// - khai vị
// - tráng miệng
// - đồ uống
//
// -> 20 phút
//
// Dữ liệu cũ / không rõ category:
// -> 30 phút
// =======================================
//

const getMealTimeMinutes = (
  restaurant
) => {
  const dishes =
    Array.isArray(
      restaurant?.dishes
    )
      ? restaurant.dishes
      : [];

  const categories =
    dishes
      .map(
        (dish) =>
          normalizeDishCategory(
            dish?.category
          )
      )
      .filter(Boolean);

  if (
    categories.some(
      (category) =>
        MAIN_DISH_CATEGORIES.has(
          category
        )
    )
  ) {
    return 30;
  }

  if (
    categories.length > 0 &&
    categories.every(
      (category) =>
        LIGHT_DISH_CATEGORIES.has(
          category
        )
    )
  ) {
    return 20;
  }

  return 30;
};


//
// =======================================
// Tổng thời gian ăn
// =======================================
//

const getTotalMealTimeMinutes = (
  restaurants
) =>
  (
    Array.isArray(restaurants)
      ? restaurants
      : []
  ).reduce(
    (
      total,
      item
    ) =>
      total +
      Number(
        item?.estimatedTime || 0
      ),
    0
  );


//
// =======================================
// Refresh estimatedTime
//
// Mỗi lần tour thay đổi sẽ đọc lại
// restaurant thật trong DB để cập nhật
// meal time mới nhất.
// =======================================
//

const refreshTourMealTimes = async (
  tour
) => {
  const restaurantIds =
    tour.restaurants.map(
      (item) =>
        item.restaurant?._id ||
        item.restaurant
    );

  if (
    !restaurantIds.length
  ) {
    tour.totalTime = 0;
    return tour;
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
          String(
            restaurant._id
          ),
          restaurant,
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


//
// =======================================
// Parse HH:mm thành phút
// =======================================
//

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
    Number(match[1]) *
      60 +
    Number(match[2])
  );
};


//
// =======================================
// Phút -> HH:mm
// =======================================
//

const formatMinutesAsTime = (
  minutes
) => {
  const normalized =
    (
      (
        Number(minutes) %
        1440
      ) +
      1440
    ) %
    1440;

  const hours =
    String(
      Math.floor(
        normalized / 60
      )
    ).padStart(
      2,
      "0"
    );

  const mins =
    String(
      normalized % 60
    ).padStart(
      2,
      "0"
    );

  return `${hours}:${mins}`;
};


//
// =======================================
// Latest meal start
//
// closingTime = 22:00
// mealTime = 30
// -> 21:30
// =======================================
//

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
    closingMinutes -
      mealTime
  );
};


//
// =======================================
// Kiểm tra thời gian ăn có nằm
// trong giờ hoạt động hay không
//
// Hỗ trợ quán qua đêm:
// 18:00 -> 02:00
// =======================================
//

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

  // Không có đủ giờ hoạt động
  // thì không block tour.
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

  // Quán đóng sau nửa đêm.
  if (
    closingMinutes <=
    openingMinutes
  ) {
    closingAbs += 1440;

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


//
// =======================================
// Round metric
// =======================================
//

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


//
// =======================================
// Build schedule
// =======================================
//

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
      valid:
        false,

      message:
        "startTime must use HH:mm format, for example 18:00",

      schedule:
        [],
    };
  }

  let currentMinutes =
    startMinutes;

  const schedule = [];

  for (
    let index = 0;
    index <
      orderedStops.length;
    index += 1
  ) {
    const stop =
      orderedStops[index];

    const restaurant =
      stop.restaurant;

    const travelMinutes =
      Number(
        legTimesMinutes?.[
          index
        ] ??
          0
      );

    if (
      !Number.isFinite(
        travelMinutes
      ) ||
      travelMinutes < 0
    ) {
      return {
        valid:
          false,

        message:
          "Unable to calculate a valid travel time for one of the route legs",

        schedule,
      };
    }

    currentMinutes +=
      travelMinutes;

    const mealTime =
      Number(
        stop.estimatedTime ??
          getMealTimeMinutes(
            restaurant
          )
      );

    const mealStartMinutes =
      currentMinutes;

    const mealEndMinutes =
      currentMinutes +
      mealTime;

    const openingTime =
      restaurant?.openingTime;

    const closingTime =
      restaurant?.closingTime;

    const hasOpeningTime =
      openingTime !==
        undefined &&
      openingTime !== null &&
      String(
        openingTime
      ).trim() !== "";

    const hasClosingTime =
      closingTime !==
        undefined &&
      closingTime !== null &&
      String(
        closingTime
      ).trim() !== "";

    if (
      hasOpeningTime &&
      parseTimeToMinutes(
        openingTime
      ) === null
    ) {
      return {
        valid:
          false,

        message:
          `Restaurant "${
            restaurant?.name ||
            "Unknown"
          }" has an invalid openingTime`,

        failedRestaurant: {
          restaurantId:
            restaurant?._id,

          restaurantName:
            restaurant?.name,

          openingTime,

          closingTime:
            closingTime ||
            null,
        },

        schedule,
      };
    }

    if (
      hasClosingTime &&
      parseTimeToMinutes(
        closingTime
      ) === null
    ) {
      return {
        valid:
          false,

        message:
          `Restaurant "${
            restaurant?.name ||
            "Unknown"
          }" has an invalid closingTime`,

        failedRestaurant: {
          restaurantId:
            restaurant?._id,

          restaurantName:
            restaurant?.name,

          openingTime:
            openingTime ||
            null,

          closingTime,
        },

        schedule,
      };
    }

    const valid =
      isMealWithinOpeningHours({
        mealStartMinutes,

        openingTime,

        closingTime,

        mealTime,
      });

    const latestMealStartTime =
      getLatestMealStartTime(
        closingTime,
        mealTime
      );

    const scheduleItem = {
      restaurantId:
        restaurant?._id,

      restaurantName:
        restaurant?.name,

      order:
        index + 1,

      travelTimeMinutes:
        roundMetric(
          travelMinutes,
          1
        ),

      mealTimeMinutes:
        mealTime,

      openingTime:
        openingTime ||
        null,

      closingTime:
        closingTime ||
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
    };

    schedule.push(
      scheduleItem
    );

    if (!valid) {
      return {
        valid:
          false,

        message:
          `Restaurant "${
            restaurant?.name ||
            "Unknown"
          }" cannot be completed within its opening hours`,

        failedRestaurant:
          scheduleItem,

        schedule,
      };
    }

    currentMinutes =
      mealEndMinutes;
  }

  return {
    valid:
      true,

    startTime:
      formatMinutesAsTime(
        startMinutes
      ),

    endTime:
      formatMinutesAsTime(
        currentMinutes
      ),

    schedule,

    totalElapsedMinutes:
      currentMinutes -
      startMinutes,
  };
};


//
// =======================================
// Clear route optimization
// =======================================
//

const clearRouteOptimization = (
  tour
) => {
  tour.isOptimized =
    false;

  tour.totalDistance =
    0;

  // totalTime luôn là
  // tổng thời gian ăn.
  tour.totalTime =
    getTotalMealTimeMinutes(
      tour.restaurants
    );

  tour.routeGeometry =
    null;

  tour.optimizationSummary =
    null;

  tour.routeStartLocation =
    undefined;
};


//
// =======================================
// Restaurant -> point
// =======================================
//

const toPoint = (
  restaurant
) => {
  if (
    !restaurant ||
    restaurant.lat == null ||
    restaurant.lng == null
  ) {
    return null;
  }

  const lat =
    Number(
      restaurant.lat
    );

  const lon =
    Number(
      restaurant.lng
    );

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


//
// =======================================
// Haversine distance
// =======================================
//

const distanceKm = (
  from,
  to
) => {
  const radiusKm =
    6371;

  const dLat =
    (
      (
        to.lat -
        from.lat
      ) *
      Math.PI
    ) /
    180;

  const dLon =
    (
      (
        to.lon -
        from.lon
      ) *
      Math.PI
    ) /
    180;

  const lat1 =
    (
      from.lat *
      Math.PI
    ) /
    180;

  const lat2 =
    (
      to.lat *
      Math.PI
    ) /
    180;

  const a =
    Math.sin(
      dLat / 2
    ) *
      Math.sin(
        dLat / 2
      ) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(
        dLon / 2
      ) *
      Math.sin(
        dLon / 2
      );

  return (
    radiusKm *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(
        1 - a
      )
    )
  );
};


//
// =======================================
// Objective
// =======================================
//

const normalizeOptimizationObjective =
  (
    objective
  ) =>
    objective ===
    "driving-time"
      ? "driving-time"
      : "driving-distance";


//
// =======================================
// Start location
// =======================================
//

const normalizeStartLocation = (
  startLocation
) => {
  if (!startLocation) {
    return null;
  }

  const lat =
    Number(
      startLocation.lat
    );

  const lon =
    Number(
      startLocation.lon ??
        startLocation.lng
    );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    throw makeHttpError(
      400,
      "Start location must include valid latitude and longitude"
    );
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
        .slice(
          0,
          120
        ) ||
      "Custom start",
  };
};

const createStartNode = (
  startLocation
) =>
  startLocation
    ? {
        restaurant: {
          lat:
            startLocation.lat,

          lng:
            startLocation.lon,
        },

        isStartLocation:
          true,
      }
    : null;


//
// =======================================
// Fallback metrics
// =======================================
//

const getFallbackDistanceKm = (
  fromStop,
  toStop
) => {
  const from =
    toPoint(
      fromStop.restaurant
    );

  const to =
    toPoint(
      toStop.restaurant
    );

  return (
    from &&
    to
  )
    ? distanceKm(
        from,
        to
      )
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

  return Number.isFinite(
    distance
  )
    ? (
        distance /
        25
      ) *
        60
    : Number.POSITIVE_INFINITY;
};


//
// =======================================
// Geoapify matrix metric
// =======================================
//

const getMatrixMetric = (
  matrix,
  fromIndex,
  toIndex,
  metric
) => {
  const value =
    matrix?.[
      fromIndex
    ]?.[
      toIndex
    ]?.[
      metric
    ];

  if (
    !Number.isFinite(
      value
    )
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    metric ===
    "distance"
  )
    ? value / 1000
    : value / 60;
};


//
// =======================================
// Tính tổng cost
// =======================================
//

const calculateStopCost = (
  stops,
  getCost,
  startNode = null
) => {
  if (
    stops.length === 0
  ) {
    return 0;
  }

  let total =
    0;

  let previous =
    startNode ||
    stops[0];

  const candidates =
    startNode
      ? stops
      : stops.slice(1);

  for (
    const stop of
    candidates
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

    total +=
      legCost;

    previous =
      stop;
  }

  return total;
};


//
// =======================================
// Nearest neighbor
// =======================================
//

const orderByNearestStop = (
  stops,
  getCost,
  startNode = null
) => {
  if (
    stops.length <= 1
  ) {
    return [
      ...stops,
    ];
  }

  const remaining =
    [
      ...stops,
    ];

  const ordered =
    [];

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
    let bestIndex =
      0;

    let bestCost =
      Number.POSITIVE_INFINITY;

    remaining.forEach(
      (
        item,
        index
      ) => {
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


//
// =======================================
// Local route estimate
// =======================================
//

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


//
// =======================================
// Optimization limits
// =======================================
//

const EXACT_OPTIMIZATION_LIMIT =
  8;

const MAX_ROUTE_MATRIX_NODES =
  31;


//
// =======================================
// Exact TSP
// =======================================
//

const findExactBestStopOrder = (
  stops,
  getCost,
  startNode = null
) => {
  if (
    stops.length <= 1
  ) {
    return [
      ...stops,
    ];
  }

  const hasCustomStart =
    Boolean(
      startNode
    );

  const fixedFirstStop =
    hasCustomStart
      ? null
      : stops[0];

  const remainingStops =
    hasCustomStart
      ? [
          ...stops,
        ]
      : stops.slice(1);

  let bestOrder =
    [
      ...stops,
    ];

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
      remaining.length ===
      0
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
      (
        stop,
        index
      ) => {
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


//
// =======================================
// 2-opt
// =======================================
//

const twoOptImprove = (
  stops,
  getCost,
  startNode = null
) => {
  if (
    stops.length <= 2
  ) {
    return [
      ...stops,
    ];
  }

  let best =
    [
      ...stops,
    ];

  let bestCost =
    calculateStopCost(
      best,
      getCost,
      startNode
    );

  let improved =
    true;

  let passes =
    0;

  const maxPasses =
    50;

  const firstMutableIndex =
    startNode
      ? 0
      : 1;

  while (
    improved &&
    passes <
      maxPasses
  ) {
    improved =
      false;

    passes +=
      1;

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


//
// =======================================
// Geoapify matrix
// =======================================
//

const buildRoadCostMatrix = async (
  nodes
) => {
  if (
    !Array.isArray(
      nodes
    ) ||
    nodes.length <=
      1
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
      (point) =>
        !point
    )
  ) {
    return null;
  }

  const matrixResponse =
    await geoapify
      .calculateRouteMatrix(
        points,
        "drive"
      );

  const matrix =
    matrixResponse
      ?.sources_to_targets;

  const hasEveryRoadLeg =
    Array.isArray(
      matrix
    ) &&
    matrix.length ===
      nodes.length &&
    matrix.every(
      (
        row,
        fromIndex
      ) =>
        Array.isArray(
          row
        ) &&
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


//
// =======================================
// Build optimized stop order
// =======================================
//

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
      options
        .optimizationObjective
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
    throw makeHttpError(
      400,
      "All restaurants in the route must have valid latitude and longitude"
    );
  }

  if (
    matrixNodes.length >
    MAX_ROUTE_MATRIX_NODES
  ) {
    throw makeHttpError(
      400,
      `Route optimization supports up to ${
        MAX_ROUTE_MATRIX_NODES -
        (
          startNode
            ? 1
            : 0
        )
      } stops for the selected starting point`
    );
  }

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

  const getObjectiveCost =
    objective ===
    "driving-time"
      ? getTime
      : getDistance;

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

  const optimizedLegTimesMinutes =
    [];

  if (
    optimizedStops.length >
    0
  ) {
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
          throw makeHttpError(
            422,
            "Unable to calculate travel time for one of the route legs"
          );
        }

        optimizedLegTimesMinutes.push(
          legTime
        );

        previous =
          stop;
      }
    } else {
      // Không có start location:
      // quán đầu tiên là điểm xuất phát.
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
          throw makeHttpError(
            422,
            "Unable to calculate travel time for one of the route legs"
          );
        }

        optimizedLegTimesMinutes.push(
          legTime
        );
      }
    }
  }

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
          ) *
            100
        )
      : 0;

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

      distanceBeforeKm:
        roundMetric(
          distanceBeforeKm
        ),

      timeBeforeMinutes:
        roundMetric(
          timeBeforeMinutes,
          1
        ),

      distanceAfterKm:
        roundMetric(
          optimizedDistanceAfterKm
        ),

      timeAfterMinutes:
        roundMetric(
          optimizedTimeAfterMinutes,
          1
        ),

      savedTourDistanceAfterKm:
        roundMetric(
          savedTourDistanceAfterKm
        ),

      savedTourTimeAfterMinutes:
        roundMetric(
          savedTourTimeAfterMinutes,
          1
        ),

      legTimesMinutes:
        optimizedLegTimesMinutes.map(
          (time) =>
            roundMetric(
              time,
              1
            )
        ),

      improvementPercent:
        roundMetric(
          improvementPercent,
          1
        ),
    },
  };
};


//
// =======================================
// CREATE TOUR
// =======================================
//

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
    } =
      req.body || {};

    if (
      !name ||
      !String(
        name
      ).trim()
    ) {
      return res
        .status(400)
        .json({
          message:
            "Tour name is required",
        });
    }

    const normalizedIds =
      normalizeRestaurantIds(
        restaurantIds
      );

    const restaurantDocs =
      await Restaurant.find({
        _id: {
          $in:
            normalizedIds,
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
      normalizedIds.filter(
        (
          restaurantId
        ) =>
          !restaurantMap.has(
            restaurantId
          )
      );

    if (
      missingRestaurants.length >
      0
    ) {
      return res
        .status(400)
        .json({
          message:
            "Some restaurants could not be found",

          restaurantIds:
            missingRestaurants,
        });
    }

    const restaurants =
      normalizedIds.map(
        (
          restaurantId,
          index
        ) => {
          const restaurant =
            restaurantMap.get(
              restaurantId
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

    const resolvedIsPublic =
      isPublic ===
      undefined
        ? false
        : parseBooleanValue(
            isPublic,
            "isPublic"
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
          description ===
            undefined ||
          description ===
            null
            ? ""
            : String(
                description
              ).trim(),

        restaurants,

        // totalTime =
        // tổng thời gian ăn.
        totalTime:
          totalMealTime,

        estimatedTotalCost:
          0,

        isPublic:
          resolvedIsPublic,
      });

    await newTour.save();

    await populateTourRestaurants(
      newTour
    );

    return res
      .status(201)
      .json({
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

    return sendControllerError(
      res,
      error,
      "Failed to create tour"
    );
  }
};


//
// =======================================
// GET MY TOURS
// =======================================
//

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
          createdAt:
            -1,
        });

    return res.json(
      tours
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    return res
      .status(500)
      .json({
        message:
          "Failed to get tours",
      });
  }
};


//
// =======================================
// GET TOUR BY ID
// =======================================
//

const getTourById = async (
  req,
  res
) => {
  try {
    const tourId =
      ensureValidObjectId(
        req.params.id,
        "tourId"
      );

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      }).populate(
        "restaurants.restaurant"
      );

    if (!tour) {
      return res
        .status(404)
        .json({
          message:
            "Tour not found",
        });
    }

    return res.json(
      tour
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to get tour"
    );
  }
};


//
// =======================================
// UPDATE TOUR
// =======================================
//

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
    } =
      req.body || {};

    const tourId =
      ensureValidObjectId(
        req.params.id,
        "tourId"
      );

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res
        .status(404)
        .json({
          message:
            "Tour not found",
        });
    }

    if (
      name !== undefined
    ) {
      const normalizedName =
        String(
          name
        ).trim();

      if (!normalizedName) {
        return res
          .status(400)
          .json({
            message:
              "Tour name is required",
          });
      }

      tour.name =
        normalizedName;
    }

    if (
      description !==
      undefined
    ) {
      tour.description =
        description === null
          ? ""
          : String(
              description
            ).trim();
    }

    if (
      isPublic !==
      undefined
    ) {
      tour.isPublic =
        parseBooleanValue(
          isPublic,
          "isPublic"
        );
    }

    const previousMealTimes =
      tour.restaurants.map(
        (item) =>
          Number(
            item.estimatedTime ||
              0
          )
      );

    let routeHasChanged =
      false;

    if (
      restaurantIds !==
      undefined
    ) {
      const normalizedIds =
        normalizeRestaurantIds(
          restaurantIds
        );

      const existingIds =
        tour.restaurants.map(
          (item) =>
            String(
              item.restaurant
            )
        );

      routeHasChanged =
        existingIds.length !==
          normalizedIds.length ||
        existingIds.some(
          (
            restaurantId,
            index
          ) =>
            restaurantId !==
            normalizedIds[index]
        );

      const restaurantDocs =
        await Restaurant.find({
          _id: {
            $in:
              normalizedIds,
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
        normalizedIds.filter(
          (
            restaurantId
          ) =>
            !restaurantMap.has(
              restaurantId
            )
        );

      if (
        missingRestaurants.length >
        0
      ) {
        return res
          .status(400)
          .json({
            message:
              "Some restaurants could not be found",

            restaurantIds:
              missingRestaurants,
          });
      }

      tour.restaurants =
        normalizedIds.map(
          (
            restaurantId,
            index
          ) => {
            const restaurant =
              restaurantMap.get(
                restaurantId
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
    }

    await refreshTourMealTimes(
      tour
    );

    const mealTimesChanged =
      previousMealTimes.length !==
        tour.restaurants.length ||
      previousMealTimes.some(
        (
          previousTime,
          index
        ) =>
          previousTime !==
          Number(
            tour
              .restaurants[
                index
              ]
              ?.estimatedTime ||
              0
          )
      );

    if (
      routeHasChanged ||
      mealTimesChanged
    ) {
      clearRouteOptimization(
        tour
      );
    }

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    return res.json({
      message:
        "Tour updated successfully",

      tour,

      mealTimeMinutes:
        tour.totalTime,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to update tour"
    );
  }
};


//
// =======================================
// DELETE TOUR
// =======================================
//

const deleteTour = async (
  req,
  res
) => {
  try {
    const tourId =
      ensureValidObjectId(
        req.params.id,
        "tourId"
      );

    const deleted =
      await Tour.findOneAndDelete({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!deleted) {
      return res
        .status(404)
        .json({
          message:
            "Tour not found",
        });
    }

    return res.json({
      message:
        "Tour deleted",
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to delete tour"
    );
  }
};


//
// =======================================
// ADD RESTAURANT TO TOUR
// =======================================
//

const addRestaurantToTour = async (
  req,
  res
) => {
  try {
    const {
      tourId,
      restaurantId,
      order,
    } =
      req.body || {};

    const normalizedTourId =
      ensureValidObjectId(
        tourId,
        "tourId"
      );

    const normalizedRestaurantId =
      ensureValidObjectId(
        restaurantId,
        "restaurantId"
      );

    const tour =
      await Tour.findOne({
        _id:
          normalizedTourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res
        .status(404)
        .json({
          message:
            "Tour not found",
        });
    }

    const alreadyExists =
      tour.restaurants.some(
        (item) =>
          String(
            item.restaurant
          ) ===
          normalizedRestaurantId
      );

    if (
      alreadyExists
    ) {
      return res
        .status(409)
        .json({
          message:
            "Restaurant is already in this tour",
        });
    }

    const restaurant =
      await Restaurant.findById(
        normalizedRestaurantId
      );

    if (!restaurant) {
      return res
        .status(404)
        .json({
          message:
            "Restaurant not found",
        });
    }

    let insertIndex =
      tour.restaurants.length;

    if (
      order !== undefined &&
      order !== null &&
      String(
        order
      ).trim() !== ""
    ) {
      const requestedOrder =
        Number(order);

      if (
        !Number.isInteger(
          requestedOrder
        ) ||
        requestedOrder < 1 ||
        requestedOrder >
          tour.restaurants
            .length +
            1
      ) {
        return res
          .status(400)
          .json({
            message:
              `order must be an integer from 1 to ${
                tour.restaurants
                  .length +
                1
              }`,
          });
      }

      insertIndex =
        requestedOrder -
        1;
    }

    tour.restaurants.splice(
      insertIndex,
      0,
      {
        restaurant:
          normalizedRestaurantId,

        order:
          insertIndex + 1,

        estimatedTime:
          getMealTimeMinutes(
            restaurant
          ),

        estimatedCost:
          0,
      }
    );

    tour.restaurants.forEach(
      (
        item,
        index
      ) => {
        item.order =
          index + 1;
      }
    );

    await refreshTourMealTimes(
      tour
    );

    clearRouteOptimization(
      tour
    );

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    return res.json({
      message:
        "Restaurant added to tour",

      tour,

      mealTimeMinutes:
        tour.totalTime,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to add restaurant to tour"
    );
  }
};


//
// =======================================
// OPTIMIZE SAVED TOUR
// =======================================
//

const optimizeTourWithFallback = async (
  req,
  res
) => {
  try {
    const tourId =
      ensureValidObjectId(
        req.params.id,
        "tourId"
      );

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      }).populate(
        "restaurants.restaurant"
      );

    if (!tour) {
      return res
        .status(404)
        .json({
          message:
            "Tour not found",
        });
    }

    if (
      tour.restaurants.length <
      1
    ) {
      return res
        .status(400)
        .json({
          message:
            "A food tour needs at least one restaurant to optimize",
        });
    }

    await refreshTourMealTimes(
      tour
    );

    const {
      startLocation,
      optimizationObjective,
      startTime,
    } =
      req.body || {};

    const hasStartTime =
      startTime !==
        undefined &&
      startTime !== null &&
      String(
        startTime
      ).trim() !== "";

    const normalizedStartTime =
      hasStartTime
        ? String(
            startTime
          ).trim()
        : null;

    if (
      hasStartTime &&
      parseTimeToMinutes(
        normalizedStartTime
      ) === null
    ) {
      return res
        .status(400)
        .json({
          message:
            "startTime must use HH:mm format, for example 18:00",
        });
    }

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

    let scheduleResult =
      null;

    if (
      normalizedStartTime
    ) {
      scheduleResult =
        buildMealSchedule({
          orderedStops,

          legTimesMinutes:
            optimization
              .legTimesMinutes,

          startTime:
            normalizedStartTime,
        });

      if (
        !scheduleResult.valid
      ) {
        return res
          .status(422)
          .json({
            message:
              scheduleResult.message,

            failedRestaurant:
              scheduleResult
                .failedRestaurant ||
              null,

            schedule:
              scheduleResult
                .schedule ||
              [],

            optimization,
          });
      }
    }

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
            ...(
              startNode
                ? [
                    toPoint(
                      startNode
                        .restaurant
                    ),
                  ]
                : []
            ),

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

    if (
      waypoints.length >=
      2
    ) {
      try {
        const routeData =
          await geoapify
            .calculateRoute(
              waypoints,
              "drive"
            );

        route =
          routeData
            .features?.[0] ||
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
          "Geoapify route failed, using local route estimate:",
          routeError.message
        );
      }
    }

    const routeDistanceKm =
      route?.properties
        ?.distance != null
        ? Number(
            route.properties
              .distance
          ) /
          1000
        : routeEstimate
            .totalDistance;

    const routeTimeMinutes =
      route?.properties
        ?.time != null
        ? Number(
            route.properties
              .time
          ) /
          60
        : routeEstimate
            .totalTime;

    const mealTimeMinutes =
      getTotalMealTimeMinutes(
        tour.restaurants
      );

    //
    // IMPORTANT:
    //
    // totalDistance phải khớp
    // routeGeometry.
    //
    // Nếu user truyền startLocation
    // thì totalDistance bao gồm:
    //
    // startLocation -> restaurant 1
    // -> restaurant 2 -> ...
    //
    tour.totalDistance =
      roundMetric(
        routeDistanceKm
      );

    //
    // totalTime trong Tour model
    // vẫn giữ semantics cũ:
    //
    // = tổng thời gian ăn.
    //
    // Travel time được lưu riêng
    // trong optimizationSummary.
    //
    tour.totalTime =
      mealTimeMinutes;

    tour.isOptimized =
      true;

    optimization.routeProvider =
      optimizedBy;

    optimization.routeDistanceKm =
      roundMetric(
        routeDistanceKm
      );

    optimization.routeTimeMinutes =
      roundMetric(
        routeTimeMinutes,
        1
      );

    optimization.mealTimeMinutes =
      roundMetric(
        mealTimeMinutes,
        1
      );

    optimization.totalElapsedMinutes =
      roundMetric(
        routeTimeMinutes +
          mealTimeMinutes,
        1
      );

    optimization.startTime =
      normalizedStartTime;

    optimization.schedule =
      scheduleResult?.schedule ||
      null;

    optimization.scheduleEndTime =
      scheduleResult?.endTime ||
      null;

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

    return res.json({
      message:
        "Tour optimized successfully",

      tour,

      route,

      optimizedBy,

      startLocation:
        resolvedStartLocation,

      startTime:
        normalizedStartTime,

      mealTimeMinutes:
        roundMetric(
          mealTimeMinutes,
          1
        ),

      routeTimeMinutes:
        roundMetric(
          routeTimeMinutes,
          1
        ),

      totalElapsedMinutes:
        roundMetric(
          routeTimeMinutes +
            mealTimeMinutes,
          1
        ),

      schedule:
        scheduleResult?.schedule ||
        null,

      scheduleEndTime:
        scheduleResult?.endTime ||
        null,

      optimization,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to optimize tour"
    );
  }
};


//
// =======================================
// OPTIMIZE PREVIEW
// =======================================
//

const optimizeTourPreview = async (
  req,
  res
) => {
  try {
    const {
      restaurantIds,
      startLocation,
      optimizationObjective,
      startTime,
    } =
      req.body || {};

    const normalizedIds =
      normalizeRestaurantIds(
        restaurantIds
      );

    const hasStartTime =
      startTime !==
        undefined &&
      startTime !== null &&
      String(
        startTime
      ).trim() !== "";

    const normalizedStartTime =
      hasStartTime
        ? String(
            startTime
          ).trim()
        : null;

    if (
      hasStartTime &&
      parseTimeToMinutes(
        normalizedStartTime
      ) === null
    ) {
      return res
        .status(400)
        .json({
          message:
            "startTime must use HH:mm format, for example 18:00",
        });
    }

    const restaurants =
      await Restaurant.find({
        _id: {
          $in:
            normalizedIds,
        },
      });

    const restaurantMap =
      new Map(
        restaurants.map(
          (
            restaurant
          ) => [
            restaurant
              ._id
              .toString(),

            restaurant,
          ]
        )
      );

    const missingRestaurants =
      normalizedIds.filter(
        (
          restaurantId
        ) =>
          !restaurantMap.has(
            restaurantId
          )
      );

    if (
      missingRestaurants.length >
      0
    ) {
      return res
        .status(400)
        .json({
          message:
            "Some restaurants could not be found",

          restaurantIds:
            missingRestaurants,
        });
    }

    const stops =
      normalizedIds.map(
        (
          restaurantId,
          index
        ) => {
          const restaurant =
            restaurantMap.get(
              restaurantId
            );

          return {
            restaurant,

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

    let scheduleResult =
      null;

    if (
      normalizedStartTime
    ) {
      scheduleResult =
        buildMealSchedule({
          orderedStops,

          legTimesMinutes:
            optimization
              .legTimesMinutes,

          startTime:
            normalizedStartTime,
        });

      if (
        !scheduleResult.valid
      ) {
        return res
          .status(422)
          .json({
            message:
              scheduleResult.message,

            failedRestaurant:
              scheduleResult
                .failedRestaurant ||
              null,

            schedule:
              scheduleResult
                .schedule ||
              [],

            optimization,
          });
      }
    }

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
            ...(
              startNode
                ? [
                    toPoint(
                      startNode
                        .restaurant
                    ),
                  ]
                : []
            ),

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
          await geoapify
            .calculateRoute(
              waypoints,
              "drive"
            );

        route =
          routeData
            .features?.[0] ||
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

    const routeDistanceKm =
      route?.properties
        ?.distance != null
        ? Number(
            route.properties
              .distance
          ) /
          1000
        : estimate
            .totalDistance;

    const routeTimeMinutes =
      route?.properties
        ?.time != null
        ? Number(
            route.properties
              .time
          ) /
          60
        : estimate
            .totalTime;

    const mealTimeMinutes =
      getTotalMealTimeMinutes(
        orderedStops
      );

    const totalElapsedMinutes =
      routeTimeMinutes +
      mealTimeMinutes;

    optimization.routeProvider =
      optimizedBy;

    optimization.routeDistanceKm =
      roundMetric(
        routeDistanceKm
      );

    optimization.routeTimeMinutes =
      roundMetric(
        routeTimeMinutes,
        1
      );

    optimization.mealTimeMinutes =
      roundMetric(
        mealTimeMinutes,
        1
      );

    optimization.totalElapsedMinutes =
      roundMetric(
        totalElapsedMinutes,
        1
      );

    optimization.startTime =
      normalizedStartTime;

    optimization.schedule =
      scheduleResult?.schedule ||
      null;

    optimization.scheduleEndTime =
      scheduleResult?.endTime ||
      null;

    return res.json({
      message:
        "Tour preview optimized successfully",

      restaurantIds:
        orderedStops.map(
          (item) =>
            item
              .restaurant
              ._id
              .toString()
        ),

      //
      // Giữ backward compatibility:
      //
      // Preview totalDistance
      // = route distance
      //
      // Preview totalTime
      // = travel time
      //
      totalDistance:
        roundMetric(
          routeDistanceKm
        ),

      totalTime:
        roundMetric(
          routeTimeMinutes,
          1
        ),

      mealTimeMinutes:
        roundMetric(
          mealTimeMinutes,
          1
        ),

      routeTimeMinutes:
        roundMetric(
          routeTimeMinutes,
          1
        ),

      totalElapsedMinutes:
        roundMetric(
          totalElapsedMinutes,
          1
        ),

      route,

      optimizedBy,

      startLocation:
        resolvedStartLocation,

      startTime:
        normalizedStartTime,

      schedule:
        scheduleResult?.schedule ||
        null,

      scheduleEndTime:
        scheduleResult?.endTime ||
        null,

      optimization,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to optimize tour preview"
    );
  }
};


//
// =======================================
// GEOCODE START LOCATION
// =======================================
//

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
      return res
        .status(400)
        .json({
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
      return res
        .status(404)
        .json({
          message:
            "Starting address could not be located",
        });
    }

    return res.json({
      startLocation: {
        lat,

        lon,

        label:
          result
            .properties
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

    return res
      .status(500)
      .json({
        message:
          "Failed to locate starting address",
      });
  }
};


//
// =======================================
// REORDER RESTAURANTS
// =======================================
//

const reorderRestaurantsInTour = async (
  req,
  res
) => {
  try {
    const tourId =
      ensureValidObjectId(
        req.params.tourId,
        "tourId"
      );

    const normalizedIds =
      normalizeRestaurantIds(
        req.body
          ?.restaurantIds
      );

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res
        .status(404)
        .json({
          message:
            "Tour not found",
        });
    }

    if (
      normalizedIds.length !==
      tour.restaurants.length
    ) {
      return res
        .status(400)
        .json({
          message:
            "restaurantIds must contain every restaurant in the tour exactly once",
        });
    }

    const restaurantMap =
      new Map();

    tour.restaurants.forEach(
      (item) => {
        restaurantMap.set(
          String(
            item.restaurant
          ),

          item
        );
      }
    );

    const newRestaurants =
      normalizedIds.map(
        (
          id,
          index
        ) => {
          const existing =
            restaurantMap.get(
              id
            );

          if (!existing) {
            throw makeHttpError(
              400,
              "Some restaurantIds are not part of this tour"
            );
          }

          existing.order =
            index + 1;

          return existing;
        }
      );

    tour.restaurants =
      newRestaurants;

    await refreshTourMealTimes(
      tour
    );

    clearRouteOptimization(
      tour
    );

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    return res.json({
      message:
        "Restaurants reordered successfully",

      tour,

      mealTimeMinutes:
        tour.totalTime,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to reorder restaurants"
    );
  }
};


//
// =======================================
// REMOVE RESTAURANT
// =======================================
//

const removeRestaurantFromTour = async (
  req,
  res
) => {
  try {
    const tourId =
      ensureValidObjectId(
        req.params.tourId,
        "tourId"
      );

    const restaurantId =
      ensureValidObjectId(
        req.params
          .restaurantId,
        "restaurantId"
      );

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res
        .status(404)
        .json({
          message:
            "Tour not found",
        });
    }

    const removeIndex =
      tour.restaurants
        .findIndex(
          (item) =>
            String(
              item.restaurant
            ) ===
            restaurantId
        );

    if (
      removeIndex ===
      -1
    ) {
      return res
        .status(404)
        .json({
          message:
            "Restaurant is not in this tour",
        });
    }

    if (
      tour.restaurants
        .length <= 1
    ) {
      return res
        .status(400)
        .json({
          message:
            "A food tour must keep at least one restaurant",
        });
    }

    tour.restaurants.splice(
      removeIndex,
      1
    );

    tour.restaurants.forEach(
      (
        item,
        index
      ) => {
        item.order =
          index + 1;
      }
    );

    await refreshTourMealTimes(
      tour
    );

    clearRouteOptimization(
      tour
    );

    await tour.save();

    await populateTourRestaurants(
      tour
    );

    return res.json({
      message:
        "Restaurant removed from tour",

      tour,

      mealTimeMinutes:
        tour.totalTime,
    });
  } catch (
    error
  ) {
    console.error(
      error
    );

    return sendControllerError(
      res,
      error,
      "Failed to remove restaurant from tour"
    );
  }
};


//
// =======================================
// UPDATE PRIVACY
// =======================================
//

const updateTourPrivacy = async (
  req,
  res
) => {
  try {
    const tourId =
      ensureValidObjectId(
        req.params.id,
        "tourId"
      );

    if (
      req.body
        ?.isPublic ===
      undefined
    ) {
      return res
        .status(400)
        .json({
          message:
            "isPublic is required",
        });
    }

    const isPublic =
      parseBooleanValue(
        req.body.isPublic,
        "isPublic"
      );

    const tour =
      await Tour.findOne({
        _id:
          tourId,

        user:
          req.user.id,
      });

    if (!tour) {
      return res
        .status(404)
        .json({
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

    return res.json({
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

    return sendControllerError(
      res,
      error,
      "Failed to update tour privacy"
    );
  }
};


//
// =======================================
// GET PUBLIC TOURS
// =======================================
//

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
          createdAt:
            -1,
        });

    return res.json(
      tours
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    return res
      .status(500)
      .json({
        message:
          "Failed to get public tours",
      });
  }
};


//
// =======================================
// EXPORTS
// =======================================
//

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