/** Yeniden kullanilabilir arayuz bilesenleri */

import { useEffect, useRef, type ReactNode } from 'react';
import type { SimWarning } from '../core/types';
import { t, warningKey, type Lang } from './i18n';

// ============================================================
// FORM ALANLARI
// ============================================================

export function Field({ label, children, unit }: {
  label: string; children: ReactNode; unit?: string;
}) {
  return (
    <div className="field">
      <label title={label}>{label}</label>
      <div className="ctrl">
        {children}
        {unit !== undefined && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

export function NumField({ label, value, onChange, unit, step = 1, min, max, decimals = 2 }: {
  label: string; value: number; onChange: (v: number) => void;
  unit?: string; step?: number; min?: number; max?: number; decimals?: number;
}) {
  return (
    <Field label={label} unit={unit}>
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0}
        step={step} min={min} max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string; value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function CheckField({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <Field label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Field>
  );
}

export function Card({ title, children, className = '' }: {
  title?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {title && <h3>{title}</h3>}
      <div className="card-body">{children}</div>
    </div>
  );
}

// ============================================================
// GRAFIK (canvas)
// ============================================================

export interface Series {
  label: string;
  color: string;
  points: [number, number][];
  /** Sag eksende ciz */
  rightAxis?: boolean;
  dashed?: boolean;
  /** Alan doldur */
  fill?: boolean;
}

export interface ChartProps {
  series: Series[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  yRightLabel?: string;
  /** Y eksenini sifirdan baslat */
  yZero?: boolean;
  /** Dikey imlec konumu (x degeri) */
  marker?: number;
  /** Egri uzerinde koşan nokta imleci [x, y] — animasyonla senkron icin */
  markerPoint?: [number, number] | null;
  onHover?: (x: number | null) => void;
}

export function Chart({
  series, height = 210, xLabel, yLabel, yRightLabel, yZero = true,
  marker, markerPoint, onHover,
}: ChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = ref.current, wrap = box.current;
    if (!cv || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    cv.width = w * dpr; cv.height = height * dpr;
    cv.style.width = `${w}px`; cv.style.height = `${height}px`;
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);

    const hasRight = series.some((s) => s.rightAxis);
    const padL = 46, padR = hasRight ? 46 : 12, padT = 8, padB = 24;
    const pw = w - padL - padR, ph = height - padT - padB;
    if (pw <= 0 || ph <= 0) return;

    const all = series.flatMap((s) => s.points);
    if (all.length === 0) return;
    const xMin = Math.min(...all.map((p) => p[0]));
    const xMax = Math.max(...all.map((p) => p[0]));

    const range = (right: boolean) => {
      const pts = series.filter((s) => !!s.rightAxis === right).flatMap((s) => s.points);
      if (pts.length === 0) return [0, 1];
      let lo = Math.min(...pts.map((p) => p[1]));
      let hi = Math.max(...pts.map((p) => p[1]));
      if (yZero && lo > 0) lo = 0;
      if (lo === hi) hi = lo + 1;
      const pad = (hi - lo) * 0.08;
      return [lo - (yZero && lo === 0 ? 0 : pad), hi + pad];
    };
    const [lMin, lMax] = range(false);
    const [rMin, rMax] = range(true);

    const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * pw;
    const sy = (y: number, right: boolean) => {
      const [lo, hi] = right ? [rMin, rMax] : [lMin, lMax];
      return padT + ph - ((y - lo) / (hi - lo || 1)) * ph;
    };

    // Izgara
    g.strokeStyle = '#1f2732'; g.lineWidth = 1;
    g.fillStyle = '#5d6875'; g.font = '10px Consolas, monospace';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ph * i) / 4;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke();
      const v = lMax - ((lMax - lMin) * i) / 4;
      g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(fmtAxis(v), padL - 5, y);
      if (hasRight) {
        const rv = rMax - ((rMax - rMin) * i) / 4;
        g.textAlign = 'left';
        g.fillText(fmtAxis(rv), padL + pw + 5, y);
      }
    }
    const xTicks = 6;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) {
      const x = padL + (pw * i) / xTicks;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke();
      g.fillText(fmtAxis(xMin + ((xMax - xMin) * i) / xTicks), x, padT + ph + 5);
    }

    // Imlec
    if (marker !== undefined && marker >= xMin && marker <= xMax) {
      g.strokeStyle = '#4a9eff'; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(sx(marker), padT); g.lineTo(sx(marker), padT + ph); g.stroke();
      g.setLineDash([]);
    }

    // Seriler
    for (const s of series) {
      if (s.points.length < 2) continue;
      const right = !!s.rightAxis;
      if (s.fill) {
        g.beginPath();
        g.moveTo(sx(s.points[0][0]), sy(right ? rMin : lMin, right));
        for (const [x, y] of s.points) g.lineTo(sx(x), sy(y, right));
        g.lineTo(sx(s.points[s.points.length - 1][0]), sy(right ? rMin : lMin, right));
        g.closePath();
        g.fillStyle = s.color + '22'; g.fill();
      }
      g.beginPath();
      g.strokeStyle = s.color; g.lineWidth = 1.8;
      g.setLineDash(s.dashed ? [5, 3] : []);
      s.points.forEach(([x, y], i) => {
        const px = sx(x), py = sy(y, right);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.stroke();
      g.setLineDash([]);
    }

    // Egri uzerinde koşan nokta
    if (markerPoint) {
      const [mx, my] = markerPoint;
      const px = sx(mx), py = sy(my, false);
      g.beginPath();
      g.arc(px, py, 4.5, 0, Math.PI * 2);
      g.fillStyle = '#ffffff'; g.fill();
      g.strokeStyle = '#f85149'; g.lineWidth = 2; g.stroke();
    }

    // Eksen etiketleri
    g.fillStyle = '#5d6875'; g.font = '10px sans-serif';
    if (xLabel) { g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(xLabel, w - padR, height - 1); }
    if (yLabel) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(yLabel, 3, 1); }
    if (yRightLabel) { g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(yRightLabel, w - 3, 1); }
  }, [series, height, xLabel, yLabel, yRightLabel, yZero, marker, markerPoint]);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <canvas
        ref={ref}
        className="chart"
        onMouseMove={(e) => {
          if (!onHover) return;
          const r = e.currentTarget.getBoundingClientRect();
          const all = series.flatMap((s) => s.points);
          if (!all.length) return;
          const xMin = Math.min(...all.map((p) => p[0]));
          const xMax = Math.max(...all.map((p) => p[0]));
          const padL = 46, padR = series.some((s) => s.rightAxis) ? 46 : 12;
          const frac = (e.clientX - r.left - padL) / (r.width - padL - padR);
          onHover(xMin + frac * (xMax - xMin));
        }}
        onMouseLeave={() => onHover?.(null)}
      />
    </div>
  );
}

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return '0';
  return v.toFixed(3);
}

export function ChartCard({ title, ...props }: ChartProps & { title: string }) {
  return (
    <div className="chartcard">
      <h4>{title}</h4>
      <Chart {...props} />
      <div className="legend">
        {props.series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// GOSTERGE
// ============================================================

export function Gauge({ label, value, unit, decimals = 0, frac, color = 'var(--accent)' }: {
  label: string; value: number; unit?: string; decimals?: number;
  frac?: number; color?: string;
}) {
  return (
    <div className="gauge">
      <div className="lbl">{label}</div>
      <div className="val" style={{ color }}>
        {Number.isFinite(value) ? value.toFixed(decimals) : '—'}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {frac !== undefined && (
        <div className="bar">
          <i style={{ width: `${Math.max(0, Math.min(frac, 1)) * 100}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// UYARILAR
// ============================================================

export function WarningList({ warnings, lang }: { warnings: SimWarning[]; lang: Lang }) {
  if (warnings.length === 0) {
    return <div className="hint">{t('noWarnings', lang)}</div>;
  }
  const order = { danger: 0, caution: 1, info: 2 };
  const sorted = [...warnings].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="warn-list">
      {sorted.map((w, i) => (
        <div key={i} className={`warn-item ${w.severity}`}>
          <span>{w.severity === 'danger' ? '⛔' : w.severity === 'caution' ? '⚠' : 'ℹ'}</span>
          <span>{t(warningKey(w.key), lang, w.params)}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// RENK YARDIMCILARI
// ============================================================

/**
 * Fuel map hucre rengi — dusuk yesil, orta sari, yuksek mavi.
 * Ekran goruntusundeki tuning yazilimi paletiyle ayni mantik:
 * renk gecisleri degerin nerede oldugunu bir bakista gosterir.
 */
export function heatColor(v: number, min: number, max: number): string {
  const t = Math.max(0, Math.min((v - min) / (max - min || 1), 1));
  // yesil (100,200,90) → sari (235,215,80) → turuncu (240,160,70) → mavi (95,165,225)
  const stops: [number, [number, number, number]][] = [
    [0.00, [104, 196, 92]],
    [0.38, [222, 214, 88]],
    [0.62, [240, 176, 72]],
    [0.80, [126, 176, 226]],
    [1.00, [86, 146, 214]],
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[i + 1];
  const f = (t - t0) / (t1 - t0 || 1);
  const c = c0.map((v0, j) => Math.round(v0 + (c1[j] - v0) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Risk seviyesine gore renk */
export function riskColor(v: number, warnAt: number, dangerAt: number): string {
  if (v >= dangerAt) return 'var(--danger)';
  if (v >= warnAt) return 'var(--warn)';
  return 'var(--ok)';
}
