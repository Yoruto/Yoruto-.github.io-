/**
 * 配置层：常量、初始值、规则参数（不随单局游戏变化）
 */
export const GAME_CONFIG = {
  commodities: [
    { id: "pumpkin_seed", name: "🎃 南瓜种子", type: "seed", yieldsCropId: "pumpkin" },
    { id: "apple_seed", name: "🍎 苹果种子", type: "seed", yieldsCropId: "apple" },
    { id: "pumpkin", name: "🎃 南瓜", type: "crop", initialSpot: 500 },
    { id: "apple", name: "🍎 苹果", type: "crop", initialSpot: 500 },
  ],
  initial: {
    cash: 100000.0,
    day: 1,
    prices: {
      pumpkin_seed: 120.0,
      apple_seed: 110.0,
      pumpkin: 380.0,
      apple: 350.0,
    },
    nextOrderId: 100,
  },
  rules: {
    cycleDays: 7,
    /** 总游戏天数（含每周期第 7 天交割）；达到后强制卖出背包作物并按现金结算排名 */
    totalGameDays: 28,
    maxLogEntries: 30,
    riskMinEquity: -5000,
    minPrice: 0.5,
    /** 日涨跌幅 |(多-空)/总量| 低于此值则次日价格不变（0.1%） */
    minMoveRatio: 0.001,
    /** 涨跌停：次日变动比例绝对值封顶 ±20% */
    limitMoveRatio: 0.2,
    /** 开仓保证金：按成交价 × 手数 × 比例从现金中冻结；平仓时按比例释放 */
    marginRate: 0.1,
  },
  /** 功能开关（限价单/挂单簿可在此恢复） */
  features: {
    limitOrders: false,
  },
};
