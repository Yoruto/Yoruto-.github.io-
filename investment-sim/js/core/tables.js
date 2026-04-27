/**
 * 表驱动常量 — 与《投资公司发展物语 V2.0 设计文档》附录 A 一致。
 * NOISE 为固定 256 项（单位：0.01 百分点）。
 */

// 大环境因子: -15% 到 +15% (万分比: -1500 到 1500)
// 对应情绪: 繁荣(🔥,+15%), 向好(📈,+6%), 平稳(➡️,0%), 低迷(📉,-6%), 冰点(💀,-15%)
export const B_STOCK_BP_BY_C = [1500, 600, 0, -600, -1500];

// 期货大环境因子同步调整: -18% 到 +18%
export const B_FUT_BP_BY_C = [1800, 720, 0, -720, -1800];

// 行情数值转可读的百分比
export function formatReturnBp(bp) {
  return `${(bp / 100).toFixed(2)}%`;
}

/** 能力 a=1..10 的加算（万分比）；索引 0 = 能力 1 */
export const A_BP_BY_ABILITY = [-200, -150, -100, -50, 0, 50, 100, 150, 200, 250];

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

/** 0.2：员工作单最大管理规模（万），股票/期货共用该上限 */
export const EMPLOYEE_TIER_MAX_AUM_WAN = {
  junior: 500,
  mid: 5000,
  senior: 50000,
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

/** 公司发展阶段解锁表（用于 UI 过滤与解锁显示） */
export const PHASE_UNLOCKS = {
  startup: {
    businesses: ['stock', 'fut', 'consulting', 'fundraising'],
    employeeTiers: ['junior'],
    officeTypes: ['small'],
    features: ['basic_hr', 'basic_training'],
  },
  expansion: {
    businesses: ['stock', 'fut', 'consulting', 'fundraising', 'realestate', 'startup_invest', 'ma_local', 'rnd', 'business_group'],
    employeeTiers: ['junior', 'mid'],
    officeTypes: ['small', 'standard', 'business'],
    features: ['advanced_hr', 'advanced_training', 'loans'],
  },
  mature: {
    businesses: ['stock', 'fut', 'consulting', 'fundraising', 'realestate', 'startup_invest', 'ma_local', 'rnd', 'business_group', 'overseas', 'ma_global', 'ipo'],
    employeeTiers: ['junior', 'mid', 'senior'],
    officeTypes: ['small', 'standard', 'business', 'hq'],
    features: ['advanced_hr', 'advanced_training', 'loans', 'global_operations', 'challenge_mode'],
  },
};

/** 8 个行业定义（显示名与图标） */
export const INDUSTRIES = {
  finance: { name: '金融', icon: '💰' },
  realestate: { name: '地产', icon: '🏘️' },
  tech: { name: '科技/互联网', icon: '💻' },
  semiconductor: { name: '半导体', icon: '🔌' },
  consumer: { name: '消费电子', icon: '📱' },
  medical: { name: '医疗', icon: '🏥' },
  energy: { name: '能源', icon: '⚡' },
  aerospace: { name: '航天/汽车', icon: '🚀' },
};

/** 业务能力权重（用于不同业务按不同维度加权） */
export const BUSINESS_ABILITY_WEIGHTS = {
  stock: { leadership: 0.5, execution: 0.5, innovation: 0 },
  fut: { leadership: 0.3, execution: 0.7, innovation: 0 },
  consulting: { leadership: 0.8, execution: 0.2, innovation: 0 },
  fundraising: { leadership: 1.0, execution: 0, innovation: 0 },
  realestate: { leadership: 0.4, execution: 0.6, innovation: 0 },
  startup_invest: { leadership: 0.2, execution: 0.2, innovation: 0.6 },
  rnd: { leadership: 0.2, execution: 0.3, innovation: 0.5 },
  ma: { leadership: 0.9, execution: 0.1, innovation: 0 },
};

/** 行业技术对业务的加成率（每点技术给出的万分比加成比例，可在结算中使用） */
export const BUSINESS_INDUSTRY_BOOST = {
  stock: 0.3,
  fut: 0.2,
  consulting: 0.5,
  fundraising: 0,
  realestate: 0.4,
  startup_invest: 0.4,
  rnd: 0.6,
  ma: 0.3,
};

/** 晋升规则示例 */
export const PROMOTION_RULES = {
  junior_to_mid: { expMonths: 24, abilitySum: 12 },
  mid_to_senior: { expMonths: 60, abilitySum: 20, techRequirement: { minValue: 50, count: 1 } },
};

