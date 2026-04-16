/**
 * 配置层：《期货星露谷》常量与规则（参见仓库根目录 游戏设计.md）
 */

/**
 * @param {typeof GAME_CONFIG} [config]
 */
export function futuresTradableCommodities(config = GAME_CONFIG) {
  return config.commodities.filter((c) => c.type === "crop" && c.futuresTradable !== false);
}

/** @param {typeof GAME_CONFIG} [config] */
export function cropCommodities(config = GAME_CONFIG) {
  return config.commodities.filter((c) => c.type === "crop");
}

/**
 * @param {typeof GAME_CONFIG} [config]
 */
export function shopCropIds(config = GAME_CONFIG) {
  return cropCommodities(config).map((c) => c.id);
}

export const GAME_CONFIG = {
  commodities: [
    // 种子：growDays=成熟天数；yield 为收获区间
    { id: "corn_seed", name: "玉米种子", type: "seed", yieldsCropId: "corn", growDays: 2, seedPrice: 1, yieldMin: 8, yieldMax: 15 },
    { id: "apple_seed", name: "苹果种子", type: "seed", yieldsCropId: "apple", growDays: 3, seedPrice: 2, yieldMin: 12, yieldMax: 25 },
    { id: "pumpkin_seed", name: "南瓜种子", type: "seed", yieldsCropId: "pumpkin", growDays: 2, seedPrice: 20, yieldMin: 1, yieldMax: 4, requiresGemBoard: true },
    { id: "strawberry_seed", name: "草莓种子", type: "seed", yieldsCropId: "strawberry", growDays: 3, seedPrice: 50, yieldMin: 1, yieldMax: 4, requiresGemBoard: true },
    { id: "watermelon_seed", name: "西瓜种子", type: "seed", yieldsCropId: "watermelon", growDays: 4, seedPrice: 150, yieldMin: 2, yieldMax: 5, requiresGemBoard: true },
    // 作物：contractMultiplier 为文档期货「刻度」；initialSpot 现货池初始量
    { id: "corn", name: "玉米", type: "crop", initialSpot: 1000, futuresTradable: true, contractMultiplier: 10, requiresGemBoard: false },
    { id: "apple", name: "苹果", type: "crop", initialSpot: 1000, futuresTradable: true, contractMultiplier: 20, requiresGemBoard: false },
    { id: "pumpkin", name: "南瓜", type: "crop", initialSpot: 500, futuresTradable: true, contractMultiplier: 100, requiresGemBoard: true },
    { id: "strawberry", name: "草莓", type: "crop", initialSpot: 400, futuresTradable: true, contractMultiplier: 300, requiresGemBoard: true },
    { id: "watermelon", name: "西瓜", type: "crop", initialSpot: 300, futuresTradable: true, contractMultiplier: 500, requiresGemBoard: true },
    { id: "golden_apple", name: "金苹果", type: "crop", initialSpot: 0, futuresTradable: true, contractMultiplier: 1000, requiresGemBoard: false, rareFromHarvest: "apple" },
    { id: "golden_strawberry", name: "金草莓", type: "crop", initialSpot: 0, futuresTradable: true, contractMultiplier: 5000, requiresGemBoard: false, rareFromHarvest: "strawberry" },
    { id: "truffle", name: "松露", type: "crop", initialSpot: 0, futuresTradable: true, contractMultiplier: 10000, requiresGemBoard: false },
  ],
  initial: {
    cash: 100000,
    day: 1,
    /** 初始债务（目标偿还 200 万） */
    debt: 2000000,
    /** 初始现货价（与期货可略有不同，首局对齐） */
    spotPrices: {
      corn: 12,
      apple: 25,
      pumpkin: 95,
      strawberry: 280,
      watermelon: 480,
      golden_apple: 1000,
      golden_strawberry: 5000,
      truffle: 10000,
    },
    futuresPrices: {
      corn: 12,
      apple: 25,
      pumpkin: 95,
      strawberry: 280,
      watermelon: 480,
      golden_apple: 1000,
      golden_strawberry: 5000,
      truffle: 10000,
    },
    backpack: {
      corn_seed: 3,
      apple_seed: 3,
    },
    nextOrderId: 100,
  },
  economy: {
    totalWeeks: 52,
    cycleDays: 7,
    weeklyInterest: 3000,
    gemBoardCost: 200000,
    landUpgradeCost: 10000,
    /** 商店相对现货基准 */
    shopBuyRatio: 0.95,
    shopSellRatio: 1.05,
    /** 商人现货购买上限 = floor(池 × ratio) */
    merchantSpotBuyRatio: 0.1,
    /** 净需求分母平滑 */
    volumeSmoothing: 100,
    /** 现货池变动 → 价格因子系数 */
    spotPoolPriceFactor: 0.1,
  },
  rules: {
    maxLogEntries: 80,
    riskMinEquity: -5000,
    minPrice: 0.5,
    minMoveRatio: 0.001,
    limitMoveRatio: 0.2,
    /** 期货临时变动率涨跌停 ±10%（设计文档） */
    futuresTempLimit: 0.1,
    /** 事件因子范围（设计） */
    eventFactorRange: 0.05,
    /** 净需求因子缩放 */
    netDemandScale: 0.2,
    /** 收盘向现货收敛：期货部分权重 */
    futuresBlend: 0.8,
    /** 收敛现货权重 */
    spotBlend: 0.2,
    marginRate: 0.1,
    /** 期货手续费：比例与上下限 */
    futuresFeeRate: 0.005,
    futuresFeeMin: 1,
    futuresFeeMax: 500,
    /** 做空上限：maxShortQty 相关（现金+库存货值）× 系数（创业板后） */
    shortNotionalCapRatio: 0.5,
  },
  features: {
    limitOrders: false,
    roomAndOnline: false,
  },
};
