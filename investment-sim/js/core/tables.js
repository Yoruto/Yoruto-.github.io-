/**
 * 表驱动常量 — 与《投资公司发展物语 V2.0 设计文档》附录 A 一致。
 * NOISE 为固定 256 项（单位：0.01 百分点）。
 */

// 大环境因子: -5% 到 +5% (万分比: -500 到 500)
// 对应情绪: 繁荣(🔥,+5%), 向好(📈,+2.5%), 平稳(➡️,0%), 低迷(📉,-2.5%), 冰点(💀,-5%)
export const B_STOCK_BP_BY_C = [500, 250, 0, -250, -500];

// 期货大环境因子同步调整: -6% 到 +6%
export const B_FUT_BP_BY_C = [600, 300, 0, -300, -600];

// 行情数值转可读的百分比
export function formatReturnBp(bp) {
  return `${(bp / 100).toFixed(2)}%`;
}

/** 能力 a=1..10 的加算（万分比）；索引 0 = 能力 1 */
export const A_BP_BY_ABILITY = [-200, -150, -100, -50, 0, 50, 100, 150, 200, 250];

/** 股票指导 mode: 0 保守 1 平衡 2 激进 — 期望加算（万分比） */
export const G_STOCK_EXPECT_ADD_BP = [-200, 0, 400];

export const STOCK_GUIDE_LABELS = ['保守', '平衡', '激进'];

export const SENTIMENT_LABELS = ['繁荣', '向好', '平稳', '低迷', '冰点'];

export const SENTIMENT_ICONS = ['🔥', '📈', '➡️', '📉', '💀'];

/** 固化噪声表（由固定 PRNG 种子生成一次后写入源码） */
export const NOISE_BP = Object.freeze([
  -133, 33, -74, 173, 250, 142, -167, -163, -122, 246, -181, -43, 215, 41, -97, -174,
  66, -228, -133, -29, 170, -61, -191, -60, -118, 55, 191, -59, 192, 124, 136, -29,
  -15, 145, 97, -155, 226, 26, -138, 148, 152, -16, -85, 77, -141, 75, 188, 28,
  224, 123, 102, -243, 170, 4, 142, 7, 80, -203, 107, -223, 64, -2, 3, 17,
  121, -17, 60, -99, 186, -181, -29, -103, -178, -229, 198, 65, -163, -211, 130, -128,
  -221, 223, 123, -135, -82, 187, 180, 222, -180, 91, -237, 164, -66, 55, -32, 106,
  103, -52, 207, -182, 3, -57, -177, 36, -184, -249, 245, 186, -111, 6, 96, -22,
  -176, -221, 248, 124, 104, 22, 45, 199, -88, -15, -223, -207, -1, -144, 3, 141,
  31, -220, 6, 17, -65, -208, -220, 55, 71, 162, -63, -150, -93, -234, -104, -228,
  200, -166, -150, -231, -208, 19, 78, 73, 175, 173, 62, 56, 79, 192, 3, -209,
  235, 89, 5, -183, 110, 237, -120, 7, 27, -146, -5, 138, -107, -160, -201, -51,
  4, -197, -124, -54, -52, 168, -198, 34, -76, -95, -125, -20, 132, 57, -165, 36,
  -165, -178, -200, -53, 60, 126, -107, -49, 137, -225, -59, -199, 8, 232, -3, 3,
  94, -71, -159, 233, -102, -75, -60, -209, -12, 70, -221, -224, 240, 204, -203, 133,
  192, -216, 67, 55, 175, -216, 246, 8, -144, -28, 130, 235, 22, 172, 146, 210,
  97, -185, -161, 101, -139, 230, -97, 117, 205, 134, 154, -205, 122, 90, 138, 142,
]);

/** 招聘费（万元） */
export const RECRUIT_COST_WAN = { junior: 5, mid: 8, senior: 15 };

/** 0.2：员工作单最大管理规模（万），股票/期货共用该上限，另受业务类型上界（股票100/期货50） */
export const EMPLOYEE_TIER_MAX_AUM_WAN = {
  junior: 50,
  mid: 500,
  senior: 1000,
};

export function getEmployeeMaxAumWan(emp) {
  const t = emp?.tier;
  return EMPLOYEE_TIER_MAX_AUM_WAN[t] ?? 50;
}

/** 写字楼等级：租赁（P1）；购买价/物业税（P2） */
export const OFFICE_GRADES = {
  small: {
    id: 'small',
    name: '小型办公室',
    capacity: 5,
    monthlyRentWan: 0.8,
    unlockYear: 1990,
    purchasePriceWan: null,
    propertyTaxRate: 0,
  },
  standard: {
    id: 'standard',
    name: '标准写字楼',
    capacity: 20,
    monthlyRentWan: 3,
    unlockYear: 1995,
    purchasePriceWan: 300,
    propertyTaxRate: 0.01,
  },
  business: {
    id: 'business',
    name: '商务中心',
    capacity: 50,
    monthlyRentWan: 8,
    unlockYear: 2005,
    purchasePriceWan: 800,
    propertyTaxRate: 0.01,
  },
  hq: {
    id: 'hq',
    name: '企业总部',
    capacity: 100,
    monthlyRentWan: 20,
    unlockYear: 2010,
    purchasePriceWan: 2000,
    propertyTaxRate: 0.01,
  },
};

/** 遣散费 = 月薪 × 倍数（文档未给具体数，PRD 开放项） */
export const SEVERANCE_MONTHS_PAY = 3;

/** 退租返还：月租比例（占位） */
export const LEASE_DEPOSIT_RETURN_RATIO = 0.5;
