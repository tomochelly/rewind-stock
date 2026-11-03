import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import { hhmm, mmdd } from './format.js';

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// Candles + volume + a shaded band for extended-hours bars. Updates incrementally so zoom/scroll survive ticks.
export default function Chart({ world, id, tf, tick, theme, height = 300, mk }) {
  const box = useRef(null);
  const s = useRef({});

  useEffect(() => {
    const chart = createChart(box.current, {
      autoSize: true,
      timeScale: { rightOffset: 3, secondsVisible: false, tickMarkFormatter: (t, type) => (type <= 2 ? mmdd(t) : hhmm(t)) },
      localization: { timeFormatter: (t) => mmdd(t) + ' ' + hhmm(t) },
      handleScale: { axisPressedMouseMove: false },
    });
    const band = chart.addHistogramSeries({ priceScaleId: 'band', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('band').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'volume' } });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    const candle = chart.addCandlestickSeries({ borderVisible: false, priceLineStyle: 2 });
    s.current = { chart, band, vol, candle, key: null };
    return () => chart.remove();
  }, []);

  useEffect(() => {
    const { chart, candle } = s.current; if (!chart) return;
    chart.applyOptions({
      layout: { background: { type: 'solid', color: css('--surface') }, textColor: css('--muted'), fontFamily: css('--font-num') },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      rightPriceScale: { borderColor: css('--line') }, timeScale: { borderColor: css('--line'), timeVisible: tf !== 'D' },
      crosshair: { vertLine: { labelBackgroundColor: css('--surface-2') }, horzLine: { labelBackgroundColor: css('--surface-2') } },
    });
    candle.applyOptions({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down'),
      priceFormat: mk === 'kr' ? { type: 'price', precision: 0, minMove: 1 } : { type: 'price', precision: 2, minMove: 0.01 } });
    s.current.key = null;
  }, [theme, tf, mk]);

  useEffect(() => {
    const st = s.current; if (!st.chart || !world || !id) return;
    const bars = tf === 'D' ? world.dailyBars(id) : world.intraday(id, tf);
    const key = id + '|' + tf;
    const up = css('--up'), down = css('--down'), bandC = css('--band-ext');
    const v = (b) => ({ time: b.time, value: b.value, color: (b.close >= b.open ? up : down) + '55' });
    const bd = (b) => ({ time: b.time, value: 1, color: b.ext ? bandC : 'rgba(0,0,0,0)' });
    const c = (b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
    if (st.key !== key || bars.length < st.len || (bars.length && bars[0].time !== st.first)) {
      st.candle.setData(bars.map(c)); st.vol.setData(bars.map(v)); st.band.setData(bars.map(bd));
      st.key = key; st.first = bars.length ? bars[0].time : null;
      st.chart.timeScale().applyOptions({ barSpacing: tf === 1 ? 3 : tf === 5 ? 6 : 8 });
      st.chart.timeScale().scrollToRealTime();
    } else {
      for (let i = Math.max(0, st.len - 1); i < bars.length; i++) { st.candle.update(c(bars[i])); st.vol.update(v(bars[i])); st.band.update(bd(bars[i])); }
    }
    st.len = bars.length;
  }, [tick, id, tf, world, theme, mk]);

  return <div ref={box} className="chart" style={{ height }} role="img" aria-label="가격 차트" />;
}
