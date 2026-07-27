/**
 * Animasyon paneli — canli 2D kesit + cok silindirli gorunum
 *
 * Cevrim izi bir kez cozulur, sonra animasyon o izden okunur. Yani
 * ekranda gorulen piston konumu, supap kalkisi, alev cephesi ve gaz
 * rengi uydurma degil; cozucunun hesapladigi degerlerdir.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineConfig, CycleTrace } from '../core/types';
import { solveOperatingPoint } from '../core/cycle';
import { makeKinematics } from '../core/geometry';
import { firingSpec, phasedAngle, strokeAt, STROKE_LABEL, STROKE_COLOR } from '../core/firing';
import {
  makeDrawGeometry, drawCylinder, drawMultiCylinder, tempColor,
  type FrameState, type Layers,
} from './engineDraw';
import { Card, ChartCard, Gauge, riskColor, type Series } from './widgets';
import { t, type Lang } from './i18n';

/** tempColor'in rgba ciktisini 6 haneli hex'e cevirir (alfa eklenebilsin diye) */
function tempHex(T: number): string {
  const m = tempColor(T, 1).match(/[\d.]+/g);
  if (!m) return '#4a5568';
  const [r, g, b] = m.slice(0, 3).map((x) => Math.round(parseFloat(x)));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Iz uzerinde dogrusal interpolasyonla ornekleme */
function sampler(tr: CycleTrace) {
  const n = tr.theta.length;
  const t0 = tr.theta[0];
  const step = tr.theta[1] - tr.theta[0];
  return (theta: number) => {
    let th = theta;
    while (th < t0) th += 720;
    while (th > tr.theta[n - 1]) th -= 720;
    const f = (th - t0) / step;
    const i = Math.max(0, Math.min(Math.floor(f), n - 2));
    const u = f - i;
    const lerp = (arr: Float64Array) => arr[i] + (arr[i + 1] - arr[i]) * u;
    return {
      theta: th,
      pressure: lerp(tr.pressure),
      temperature: lerp(tr.temperature),
      burnFraction: lerp(tr.burnFraction),
      intakeLift: lerp(tr.intakeLift),
      exhaustLift: lerp(tr.exhaustLift),
      intakeFlow: lerp(tr.intakeFlow),
      exhaustFlow: lerp(tr.exhaustFlow),
      knockIntegral: lerp(tr.knockIntegral),
      sideForce: lerp(tr.sideForce),
      volume: lerp(tr.volume),
    };
  };
}

export function AnimationPanel({ cfg, lang }: { cfg: EngineConfig; lang: Lang }) {
  const [rpm, setRpm] = useState(() => Math.round((cfg.redline * 0.6) / 250) * 250);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(0.35);
  const [theta, setTheta] = useState(-360);
  const [layers, setLayers] = useState<Layers>({
    combustion: true, valves: true, forces: true, thermo: true,
  });
  const [computing, setComputing] = useState(true);
  const [point, setPoint] = useState<ReturnType<typeof solveOperatingPoint> | null>(null);

  const cylCanvas = useRef<HTMLCanvasElement>(null);
  const multiCanvas = useRef<HTMLCanvasElement>(null);
  const thetaRef = useRef(theta);
  const raf = useRef(0);
  const last = useRef(0);

  const k = useMemo(() => makeKinematics(cfg.geometry), [cfg]);
  const drawGeo = useMemo(() => makeDrawGeometry(cfg, k), [cfg, k]);
  const firing = useMemo(() => firingSpec(cfg.layout), [cfg.layout]);

  // Cevrim izini coz (agir islem — rpm veya motor degisince)
  useEffect(() => {
    setComputing(true);
    setPoint(null);
    const id = window.setTimeout(() => {
      setPoint(solveOperatingPoint(cfg, rpm, { keepTrace: true, step: 0.5 }));
      setComputing(false);
    }, 30);
    return () => window.clearTimeout(id);
  }, [cfg, rpm]);

  const trace = point?.trace ?? null;
  const sample = useMemo(() => (trace ? sampler(trace) : null), [trace]);

  const norms = useMemo(() => {
    if (!trace) return { maxPressure: 1, maxFlow: 1, maxSideForce: 1 };
    let mp = 0, mf = 0, ms = 0;
    for (let i = 0; i < trace.pressure.length; i++) {
      mp = Math.max(mp, trace.pressure[i]);
      mf = Math.max(mf, Math.abs(trace.intakeFlow[i]), Math.abs(trace.exhaustFlow[i]));
      ms = Math.max(ms, Math.abs(trace.sideForce[i]));
    }
    return { maxPressure: mp, maxFlow: mf, maxSideForce: ms };
  }, [trace]);

  // Animasyon dongusu
  useEffect(() => {
    if (!playing || !sample) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last.current) / 1000, 0.1);
      last.current = now;
      thetaRef.current += speed * 720 * dt;
      while (thetaRef.current > 360) thetaRef.current -= 720;
      setTheta(thetaRef.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, sample]);

  // Cizim
  useEffect(() => {
    if (!sample || !point) return;
    const s = sample(theta);
    const frame: FrameState = { ...s, ...norms };

    const cv = cylCanvas.current;
    if (cv) {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr; cv.height = h * dpr;
      }
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawCylinder(ctx, w, h, drawGeo, frame, layers, lang, point.sparkAdvance);
      }
    }

    const mc = multiCanvas.current;
    if (mc) {
      const dpr = window.devicePixelRatio || 1;
      const w = mc.clientWidth, h = mc.clientHeight;
      if (mc.width !== w * dpr || mc.height !== h * dpr) {
        mc.width = w * dpr; mc.height = h * dpr;
      }
      const ctx = mc.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cyls = firing.phases.map((p) => {
          const th = phasedAngle(theta, p.phase);
          const st = strokeAt(th);
          const ss = sample(th);
          return {
            index: p.index,
            theta: th,
            axisAngle: p.axisAngle,
            // Termal katman acikken gaz sicakligi, kapaliyken zaman rengi.
            // Alfa eklenebilmesi icin 6 haneli hex'e cevriliyor.
            color: layers.thermo ? tempHex(ss.temperature) : STROKE_COLOR[st],
            firing: st === 'POWER' && th < 60,
            intakeLift: layers.valves ? ss.intakeLift : 0,
            exhaustLift: layers.valves ? ss.exhaustLift : 0,
            burnFraction: layers.combustion ? ss.burnFraction : 0,
          };
        });
        drawMultiCylinder(ctx, w, h, drawGeo, cyls, firing.bankAngle);
      }
    }
  }, [theta, sample, point, drawGeo, layers, lang, norms, firing]);

  const cur = sample ? sample(theta) : null;
  const stroke = strokeAt(theta);

  const rpmList = useMemo(() => {
    const out: number[] = [];
    for (let r = Math.max(cfg.idleRpm, 1000); r <= cfg.redline; r += 250) out.push(r);
    return out;
  }, [cfg]);

  // Senkron grafikler
  const charts = useMemo(() => {
    if (!trace) return null;
    const stride = 4;
    const take = <T,>(fn: (i: number) => T): T[] => {
      const o: T[] = [];
      for (let i = 0; i < trace.theta.length; i += stride) o.push(fn(i));
      return o;
    };
    return {
      pv: [{
        label: 'P-V', color: '#a371f7',
        points: take((i) => [trace.volume[i] * 1e6, trace.pressure[i] / 1e5] as [number, number]),
      }] as Series[],
      press: [
        {
          label: `${t('pressure', lang)} (bar)`, color: '#a371f7',
          points: take((i) => [trace.theta[i], trace.pressure[i] / 1e5] as [number, number]),
        },
        {
          label: `${t('temperature', lang)} (K)`, color: '#ff9d5c', rightAxis: true,
          points: take((i) => [trace.theta[i], trace.temperature[i]] as [number, number]),
        },
      ] as Series[],
      lift: [
        {
          label: `${lang === 'tr' ? 'Emme' : 'Intake'} (mm)`, color: '#3fb950',
          points: take((i) => [trace.theta[i], trace.intakeLift[i] * 1000] as [number, number]),
        },
        {
          label: `${lang === 'tr' ? 'Egzoz' : 'Exhaust'} (mm)`, color: '#f85149',
          points: take((i) => [trace.theta[i], trace.exhaustLift[i] * 1000] as [number, number]),
        },
        {
          label: 'xb (%)', color: '#d29922', rightAxis: true,
          points: take((i) => [trace.theta[i], trace.burnFraction[i] * 100] as [number, number]),
        },
      ] as Series[],
    };
  }, [trace, lang]);

  return (
    <>
      <Card>
        <div className="row wrap">
          <button className="primary" onClick={() => setPlaying((p) => !p)} disabled={computing}>
            {playing ? '❚❚ ' + t('stop', lang) : '▶ ' + t('start', lang)}
          </button>
          <label className="dim">{t('selectRpm', lang)}</label>
          <select
            value={rpm}
            onChange={(e) => setRpm(parseInt(e.target.value, 10))}
            style={{ width: 100 }}
          >
            {rpmList.map((r) => <option key={r} value={r}>{r} rpm</option>)}
          </select>
          <label className="dim">{t('animSpeed', lang)}</label>
          <input type="range" min={0.05} max={1.5} step={0.05} value={speed}
            style={{ width: 110 }}
            onChange={(e) => setSpeed(parseFloat(e.target.value))} />
          <span className="mono" style={{ width: 46 }}>{speed.toFixed(2)}×</span>
          <div className="sep" style={{ width: 10 }} />
          <label className="dim">{t('crankAngle', lang)}</label>
          <input type="range" min={-360} max={360} step={0.5} value={theta}
            style={{ flex: 1, minWidth: 160 }}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              thetaRef.current = v; setTheta(v); setPlaying(false);
            }} />
          <b className="mono" style={{ width: 62, textAlign: 'right' }}>{theta.toFixed(0)}°</b>
        </div>
        <div className="row wrap mt8">
          <span className="dim">{t('layers', lang)}:</span>
          {([
            ['combustion', 'layerCombustion'],
            ['valves', 'layerValves'],
            ['forces', 'layerForces'],
            ['thermo', 'layerThermo'],
          ] as const).map(([id, key]) => (
            <button
              key={id}
              className={`sm ${layers[id] ? 'primary' : ''}`}
              onClick={() => setLayers((l) => ({ ...l, [id]: !l[id] }))}
            >
              {t(key, lang)}
            </button>
          ))}
          <div className="sep" style={{ width: 10 }} />
          <span className="pill" style={{
            background: STROKE_COLOR[stroke] + '28', color: STROKE_COLOR[stroke],
          }}>
            {STROKE_LABEL[stroke][lang === 'tr' ? 0 : 1]}
          </span>
        </div>
      </Card>

      {computing ? (
        <Card>
          <div className="center dim" style={{ padding: 30 }}>{t('calculating', lang)}</div>
          <div className="progress"><i style={{ width: '55%' }} /></div>
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="chartcard" style={{ padding: 0, overflow: 'hidden' }}>
              <canvas
                ref={cylCanvas}
                style={{ width: '100%', height: 460, display: 'block' }}
              />
            </div>
            <div>
              <div className="gauges" style={{ marginBottom: 12 }}>
                <Gauge label={t('pressure', lang)} value={(cur?.pressure ?? 0) / 1e5}
                  unit="bar" decimals={1}
                  frac={(cur?.pressure ?? 0) / norms.maxPressure} color="#a371f7" />
                <Gauge label={t('temperature', lang)} value={(cur?.temperature ?? 0) - 273.15}
                  unit="°C" frac={((cur?.temperature ?? 0) - 300) / 2700} color="#ff9d5c" />
                <Gauge label={t('burnFraction', lang)} value={(cur?.burnFraction ?? 0) * 100}
                  unit="%" frac={cur?.burnFraction ?? 0} color="#d29922" />
                <Gauge label={t('knockRisk', lang)} value={(cur?.knockIntegral ?? 0) * 100}
                  unit="%" frac={cur?.knockIntegral ?? 0}
                  color={riskColor(cur?.knockIntegral ?? 0, 0.7, 0.95)} />
                <Gauge label={t('sideForce', lang)} value={Math.abs(cur?.sideForce ?? 0) / 1000}
                  unit="kN" decimals={2}
                  frac={Math.abs(cur?.sideForce ?? 0) / norms.maxSideForce} color="#f0a03a" />
                <Gauge label={t('valveLiftTrace', lang)}
                  value={Math.max(cur?.intakeLift ?? 0, cur?.exhaustLift ?? 0) * 1000}
                  unit="mm" decimals={2} color="#3fb950" />
              </div>
              {charts && (
                <ChartCard
                  title={t('pvDiagram', lang)} series={charts.pv} height={186}
                  xLabel="cc" yLabel="bar" yZero={false}
                  markerPoint={cur ? [cur.volume * 1e6, cur.pressure / 1e5] : null}
                />
              )}
            </div>
          </div>

          <div className="grid2" style={{ marginBottom: 14 }}>
            {charts && (
              <ChartCard title={t('pressureTrace', lang)} series={charts.press} height={190}
                xLabel={t('crankAngle', lang)} yZero={false} marker={theta} />
            )}
            {charts && (
              <ChartCard title={t('valveLiftTrace', lang)} series={charts.lift} height={190}
                xLabel={t('crankAngle', lang)} marker={theta} />
            )}
          </div>

          <Card title={`${t('multiCylinder', lang)} — ${cfg.layout} · ${
            lang === 'tr' ? firing.crankType : firing.crankTypeEn
          }`}>
            <div className="row wrap" style={{ marginBottom: 8, fontSize: 12 }}>
              <span className="dim">{t('firingOrder', lang)}:</span>
              <b className="mono">{firing.order.join('–')}</b>
              <span className="dim">· {t('firingInterval', lang)}:</span>
              <b className="mono">{firing.interval}°</b>
              {firing.bankAngle > 0 && (
                <>
                  <span className="dim">· {t('bankAngle', lang)}:</span>
                  <b className="mono">{firing.bankAngle}°</b>
                </>
              )}
            </div>
            <canvas
              ref={multiCanvas}
              style={{ width: '100%', height: firing.bankAngle > 0 ? 250 : 180, display: 'block' }}
            />
            <div className="legend">
              {(['INTAKE', 'COMPRESSION', 'POWER', 'EXHAUST'] as const).map((s) => (
                <span key={s}>
                  <i style={{ background: STROKE_COLOR[s] }} />
                  {STROKE_LABEL[s][lang === 'tr' ? 0 : 1]}
                </span>
              ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
