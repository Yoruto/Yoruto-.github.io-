/**
 * 可复现 RNG：32 位整数混合，禁止非确定性浮点参与结算。
 */

export function ymToMonthIndex(year, month) {
  return (year - 1990) * 12 + (month - 1);
}

export function monthIndexToYm(idx) {
  const y = 1990 + Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return { year: y, month: m };
}

function rotl32(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** murmur3 风格最终化 */
function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * 将多个整数混合为 uint32（确定性）。
 * @param {number} seed 主种子
 * @param {number[]} parts 额外部分
 */
export function mixUint32(seed, parts) {
  let h = seed >>> 0;
  let k = 0;
  for (let i = 0; i < parts.length; i++) {
    k = (parts[i] | 0) >>> 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = rotl32(k, 15);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = rotl32(h, 13);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= parts.length;
  return fmix32(h);
}

/** 附录 A.1：第 t 月、当月第 i 笔新开业务、种类 */
export function businessNoiseH(gameSeed, monthIndex, orderIndexInMonth, kindTag) {
  const k = kindTag === 'stock' ? 1 : 2;
  return mixUint32(gameSeed >>> 0, [monthIndex, orderIndexInMonth, k, 0x4e4f4953]);
}

export function noiseBpFromH(H, noiseTable) {
  return noiseTable[H % 256];
}

export function macroSentimentH(gameSeed, monthIndex, lineTag) {
  const tag = lineTag === 'equity' ? 0x4551 : 0x4643;
  return mixUint32(gameSeed >>> 0, [monthIndex, tag, 0x4d4143]);
}

/** 本月实际景气 c ∈ 0..4 */
export function rollMacroC(gameSeed, monthIndex, lineTag) {
  return macroSentimentH(gameSeed, monthIndex, lineTag) % 5;
}

/** 下月预测（展示用，与结算独立） */
export function rollPredictedC(gameSeed, monthIndex, lineTag) {
  const h = mixUint32(gameSeed >>> 0, [monthIndex, lineTag === 'equity' ? 0x5031 : 0x5032, 0x5052]);
  return h % 5;
}

export function recruitStatH(gameSeed, monthIndex, slot) {
  return mixUint32(gameSeed >>> 0, [monthIndex, slot, 0x52435254]);
}

/** 能力 1~10，忠诚 1~10（均匀） */
export function rollRecruitStats(gameSeed, monthIndex, slot) {
  const h = recruitStatH(gameSeed, monthIndex, slot);
  const ability = 1 + (h % 10);
  const loyalty = 1 + ((h >>> 8) % 10);
  return { ability, loyalty };
}

export function minorEventH(gameSeed, monthIndex) {
  return mixUint32(gameSeed >>> 0, [monthIndex, 0x4d4e52, 0]);
}

export function majorEventTriggerH(gameSeed, monthIndex, slot) {
  return mixUint32(gameSeed >>> 0, [monthIndex, slot, 0x4d4a52]);
}

const EMP_FN = ['陈', '林', '王', '张', '刘', '杨', '赵', '黄', '周', '吴', '徐', '孙'];
const EMP_GN = ['伟', '芳', '娜', '强', '敏', '静', '磊', '军', '洋', '勇', '艳', '杰', '丽', '涛', '明'];

/** 可复现简称（与人才库风格一致） */
export function randomEmployeeNameForSeed(gameSeed, index) {
  const h = mixUint32((gameSeed >>> 0) || 1, [(index | 0) & 0xffff, 0x4e4d5f, 0x4e, 0x01]);
  return `${EMP_FN[h % EMP_FN.length]}${EMP_GN[(h >>> 8) % EMP_GN.length]}`;
}

function employeeIdHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 员工自动构建股票组合（2～4 支，权重之和 10000），可复现。
 * @param {{id:string}[]} stocks 全市场列表（上市限制由游戏层关闭）
 */
export function generateEmployeeStockPortfolio(gameSeed, monthIndex, rngSlot, employeeId, stocks) {
  const n = stocks.length;
  if (n === 0) return [];
  const kWant = 2 + (mixUint32(gameSeed >>> 0, [monthIndex, rngSlot, employeeIdHash(employeeId), 0x504f52]) % 3);
  const k = Math.min(kWant, n);
  const avail = stocks.map((_, i) => i);
  const indices = [];
  let x = mixUint32(gameSeed >>> 0, [monthIndex, rngSlot, employeeIdHash(employeeId), 0x504b]);
  for (let i = 0; i < k; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const pick = x % avail.length;
    indices.push(avail[pick]);
    avail.splice(pick, 1);
  }
  const weights = [];
  let rem = 10000;
  for (let i = 0; i < k - 1; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const minLeft = 500 * (k - 1 - i);
    const maxW = rem - minLeft;
    const minW = 500;
    const span = Math.max(0, maxW - minW);
    const w = minW + (span > 0 ? (x % (span + 1)) : 0);
    weights.push(w);
    rem -= w;
  }
  weights.push(rem);
  return indices.map((idx, i) => ({ stockId: stocks[idx].id, weightBp: weights[i] }));
}

/** 轻仓：仅总 AUM 的 20% 投入股票侧（与组合内 weights 合 10000 联用，见 monthEngine） */
export const STOCK_PARTIAL_SLEEVE_BP = 2000;

/**
 * 随机 1～4 支，标的间权重合计 10000。与 `STOCK_PARTIAL_SLEEVE_BP` 联用表示全账户仅 20% 买股。
 * @param {{id:string}[]} stocks 当前可买列表（通常已按上市日过滤）
 */
export function generateRandomPartialStockPortfolio(gameSeed, monthIndex, rngSlot, employeeId, stocks) {
  const n = stocks.length;
  if (n === 0) return [];
  const kW = 1 + (mixUint32(gameSeed >>> 0, [monthIndex, rngSlot, employeeIdHash(employeeId), 0x504152]) % 4);
  const k = Math.min(kW, n);
  const avail = stocks.map((_, i) => i);
  const indices = [];
  let x = mixUint32(gameSeed >>> 0, [monthIndex, rngSlot, employeeIdHash(employeeId), 0x504b32]);
  for (let i = 0; i < k; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const pick = x % avail.length;
    indices.push(avail[pick]);
    avail.splice(pick, 1);
  }
  const each = Math.floor(10000 / k);
  let rem = 10000;
  const rows = [];
  for (let i = 0; i < k - 1; i++) {
    rows.push({ stockId: stocks[indices[i]].id, weightBp: each });
    rem -= each;
  }
  rows.push({ stockId: stocks[indices[k - 1]].id, weightBp: rem });
  return rows;
}
