/**
 * TradingView Lightweight Charts — 期货 K 线 + 成交量（A 股配色：涨红跌绿）
 */
import { createChart, ColorType, CrosshairMode } from "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm";

/** 与多日数据时相近的柱心间距（像素），少天数时避免单根 K 线撑满 */
const TARGET_TIME_BAR_SPACING_PX = 10;

/** @param {number} globalDay */
function globalDayToBusinessDay(globalDay) {
  const d = new Date(Date.UTC(2026, 0, globalDay));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * @param {import('../core/state.js').ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 * @param {string} commodityId
 */
export function buildFuturesLwcSeriesData(state, config, commodityId) {
  const closes = state.futuresPriceHistory[commodityId] ?? [];
  const opens = state.futuresOpenHistory?.[commodityId] ?? [];
  const volumes = state.futuresVolumeHistory?.[commodityId] ?? [];
  const days = state.futuresChartGlobalDays?.[commodityId] ?? [];
  const n = Math.min(closes.length, opens.length, volumes.length, days.length);
  /** @type {object[]} */
  const candles = [];
  /** @type {object[]} */
  const volumesOut = [];
  const upColor = "rgba(229, 57, 53, 0.75)";
  const downColor = "rgba(67, 160, 71, 0.75)";
  for (let i = 0; i < n; i++) {
    const o = opens[i];
    const c = closes[i];
    const v = volumes[i];
    const time = globalDayToBusinessDay(days[i]);
    let high = Math.max(o, c);
    let low = Math.min(o, c);
    if (high === low) {
      high *= 1.0005;
      low *= 0.9995;
    }
    candles.push({ time, open: o, high, low, close: c });
    const up = c >= o;
    volumesOut.push({ time, value: v, color: up ? upColor : downColor });
  }
  return { candles, volumes: volumesOut };
}

/**
 * 少天数时 fitContent 会把 barSpacing 拉大；在保持「看全数据」的前提下扩逻辑区间，使柱宽接近多日观感。
 * @param {ReturnType<typeof createChart>} chart
 * @param {number} barCount
 */
export function applyFuturesChartViewport(chart, barCount) {
  if (barCount < 1) return;
  chart.timeScale().fitContent();
  requestAnimationFrame(() => {
    const ts = chart.timeScale();
    const vr = ts.getVisibleLogicalRange();
    if (!vr) return;
    const bs = ts.options().barSpacing;
    if (bs <= TARGET_TIME_BAR_SPACING_PX) return;
    const mid = (vr.from + vr.to) / 2;
    const half = ((vr.to - vr.from) / 2) * (bs / TARGET_TIME_BAR_SPACING_PX);
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  });
}

/**
 * @param {HTMLElement} mountEl
 * @param {object} opts
 * @param {(w: number, h: number) => void} [opts.onResize]
 */
export function createFuturesLwcChart(mountEl, opts = {}) {
  const { onResize } = opts;
  const chart = createChart(mountEl, {
    width: mountEl.clientWidth || 400,
    height: 300,
    layout: {
      background: { type: ColorType.Solid, color: "#1a1510" },
      textColor: "#e9dcc3",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "rgba(219, 184, 124, 0.12)" },
      horzLines: { color: "rgba(219, 184, 124, 0.12)" },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: {
      borderColor: "rgba(219, 184, 124, 0.25)",
      scaleMargins: { top: 0.1, bottom: 0.22 },
    },
    timeScale: {
      borderColor: "rgba(219, 184, 124, 0.25)",
      timeVisible: true,
      secondsVisible: false,
    },
  });

  const candleSeries = chart.addCandlestickSeries({
    upColor: "#e53935",
    downColor: "#43a047",
    borderVisible: true,
    borderUpColor: "#e53935",
    borderDownColor: "#43a047",
    wickUpColor: "#e53935",
    wickDownColor: "#43a047",
  });

  const volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    priceLineVisible: false,
  });

  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
    borderVisible: false,
  });

  const ro = new ResizeObserver(() => {
    const w = mountEl.clientWidth;
    const h = mountEl.clientHeight || 300;
    chart.applyOptions({ width: w, height: h });
    onResize?.(w, h);
  });
  ro.observe(mountEl);

  const tooltip = document.createElement("div");
  tooltip.className = "futures-lwc-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  const onCrosshairMove = (param) => {
    if (!param.point || param.time === undefined) {
      tooltip.style.display = "none";
      tooltip.setAttribute("aria-hidden", "true");
      return;
    }
    const cndl = param.seriesData.get(candleSeries);
    const vol = param.seriesData.get(volumeSeries);
    const o = cndl && "open" in cndl ? cndl.open : null;
    const c = cndl && "close" in cndl ? cndl.close : null;
    const v = vol && "value" in vol ? vol.value : null;
    if (o == null || c == null) {
      tooltip.style.display = "none";
      return;
    }
    let pctText = "—";
    if (o > 0) {
      const pct = ((c - o) / o) * 100;
      const sign = pct > 0 ? "+" : "";
      pctText = `${sign}${pct.toFixed(2)}%`;
    }
    const volText = v != null ? volumeSeries.priceFormatter().format(v) : "—";
    tooltip.innerHTML = `<div class="futures-lwc-tooltip-row">成交量 <span class="futures-lwc-tooltip-val">${volText}</span></div><div class="futures-lwc-tooltip-row">当日涨跌 <span class="futures-lwc-tooltip-val">${pctText}</span></div>`;
    tooltip.style.display = "block";
    tooltip.setAttribute("aria-hidden", "false");
    const chartEl = chart.chartElement();
    const rect = chartEl.getBoundingClientRect();
    const pad = 12;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let left = rect.left + param.point.x + pad;
    let top = rect.top + param.point.y + pad;
    if (left + tw > window.innerWidth - 8) left = rect.left + param.point.x - tw - pad;
    if (top + th > window.innerHeight - 8) top = rect.top + param.point.y - th - pad;
    left = Math.max(8, left);
    top = Math.max(8, top);
    tooltip.style.position = "fixed";
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.zIndex = "12000";
  };

  chart.subscribeCrosshairMove(onCrosshairMove);

  return {
    chart,
    candleSeries,
    volumeSeries,
    resizeObserver: ro,
    remove() {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      tooltip.remove();
      ro.disconnect();
      chart.remove();
    },
  };
}
