/**
 * TradingView Lightweight Charts — 期货 K 线 + 成交量（A 股配色：涨红跌绿）
 */
import { createChart, ColorType, CrosshairMode } from "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm";

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

  return {
    chart,
    candleSeries,
    volumeSeries,
    resizeObserver: ro,
    remove() {
      ro.disconnect();
      chart.remove();
    },
  };
}
