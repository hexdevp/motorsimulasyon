/**
 * Canli (gercek zamanli) simulasyon paneli
 *
 * Motor devri, gercek atalet denklemiyle entegre edilir:
 *   I · dω/dt = T_motor(devir, gaz) − T_yuk
 *
 * Tork degeri, onceden hesaplanmis tork haritasindan interpolasyonla
 * gelir; her karede tam cevrim cozmek mumkun degildir (bir nokta ~150 ms
 * surer, 60 fps icin 16 ms vardir). Dinamometre yazilimlarinin ve
 * ECU'larin yaptigi da tam olarak budur.
 */

import { useEffect, useRef, useState } from 'react';
import type { EngineConfig } from '../core/types';
import { buildTorqueMap, lookupTorque, lookupPoint, type TorqueMap } from '../core/sweep';
import { Card, Gauge, ChartCard, riskColor, type Series } from './widgets';
import { t, type Lang } from './i18n';

const HP = 745.7;

interface LiveState {
  rpm: number;
  throttle: number;
  limiterActive: boolean;
}

export function LivePanel({ cfg, lang }: { cfg: EngineConfig; lang: Lang }) {
  const [map, setMap] = useState<TorqueMap | null>(null);
  const [running, setRunning] = useState(false);
  const [load, setLoad] = useState(0.12);
  const [, forceRender] = useState(0);

  const state = useRef<LiveState>({ rpm: cfg.idleRpm, throttle: 0, limiterActive: false });
  const history = useRef<{ t: number; rpm: number; throttle: number }[]>([]);
  const raf = useRef<number>(0);
  const lastTime = useRef<number>(0);
  const clock = useRef<number>(0);

  // Tork haritasini hazirla (agir islem — bir kez)
  useEffect(() => {
    setMap(null);
    setRunning(false);
    const id = window.setTimeout(() => {
      setMap(buildTorqueMap(cfg));
      state.current = { rpm: cfg.idleRpm, throttle: 0, limiterActive: false };
      history.current = [];
      clock.current = 0;
    }, 30);
    return () => window.clearTimeout(id);
  }, [cfg]);

  // Klavye kontrolu
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); state.current.throttle = 1; }
      if (e.key === 'ArrowUp') { e.preventDefault(); state.current.throttle = Math.min(1, state.current.throttle + 0.12); }
      if (e.key === 'ArrowDown') { e.preventDefault(); state.current.throttle = Math.max(0, state.current.throttle - 0.12); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') state.current.throttle = 0; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Ana dongu
  useEffect(() => {
    if (!running || !map) return;
    lastTime.current = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime.current) / 1000, 0.05);
      lastTime.current = now;
      clock.current += dt;
      const s = state.current;

      // Rev limiter: kirmizi cizgide yakit kesilir, %2 asagida geri gelir
      if (s.rpm >= map.redline) s.limiterActive = true;
      if (s.rpm < map.redline * 0.975) s.limiterActive = false;

      const effThrottle = s.limiterActive ? 0 : s.throttle;
      const engineTorque = lookupTorque(map, s.rpm, effThrottle);

      // Yuk momenti: sabit bir bilesen + devirle artan (aerodinamik benzeri)
      const loadTorque =
        load * map.wot[Math.floor(map.wot.length / 2)] *
        (0.35 + 0.65 * Math.pow(s.rpm / map.redline, 1.6));

      const netTorque = engineTorque - loadTorque;
      const omega = (s.rpm * 2 * Math.PI) / 60;
      const newOmega = Math.max(omega + (netTorque / map.inertia) * dt, 0);
      s.rpm = (newOmega * 60) / (2 * Math.PI);

      // Rolanti altina dusmesin (rolanti kontrolu varmis gibi davran)
      if (s.rpm < map.idleRpm) s.rpm = map.idleRpm;
      if (s.rpm > map.redline * 1.02) s.rpm = map.redline * 1.02;

      history.current.push({ t: clock.current, rpm: s.rpm, throttle: s.throttle });
      const cutoff = clock.current - 12;
      while (history.current.length && history.current[0].t < cutoff) history.current.shift();

      forceRender((n) => n + 1);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running, map, load]);

  if (!map) {
    return (
      <Card>
        <div className="center dim" style={{ padding: 28 }}>{t('buildingMap', lang)}</div>
        <div className="progress"><i style={{ width: '60%' }} /></div>
      </Card>
    );
  }

  const s = state.current;
  const pt = lookupPoint(map, s.rpm);
  const torque = lookupTorque(map, s.rpm, s.limiterActive ? 0 : s.throttle);
  const power = (torque * s.rpm * 2 * Math.PI) / 60;
  const rpmFrac = s.rpm / map.redline;

  const traceSeries: Series[] = [
    {
      label: t('rpm', lang), color: '#4a9eff',
      points: history.current.map((h) => [h.t, h.rpm] as [number, number]),
    },
    {
      label: `${t('throttlePedal', lang)} (%)`, color: '#3fb950', rightAxis: true,
      points: history.current.map((h) => [h.t, h.throttle * 100] as [number, number]),
    },
  ];

  return (
    <>
      <Card>
        <div className="row wrap">
          <button className="primary" onClick={() => setRunning((r) => !r)}>
            {running ? t('stop', lang) : t('start', lang)}
          </button>
          <button onClick={() => {
            state.current = { rpm: cfg.idleRpm, throttle: 0, limiterActive: false };
            history.current = []; clock.current = 0;
          }}>{t('reset', lang)}</button>
          <div className="sep" style={{ width: 12 }} />
          <label className="dim">{t('load', lang)}</label>
          <input type="range" min={0} max={1} step={0.02} value={load}
            style={{ width: 160 }}
            onChange={(e) => setLoad(parseFloat(e.target.value))} />
          <span className="mono">{(load * 100).toFixed(0)}%</span>
          {s.limiterActive && <span className="pill danger">{t('revLimiter', lang)}</span>}
        </div>
        <div className="hint mt8">{t('liveHint', lang)}</div>
      </Card>

      <div className="row" style={{ alignItems: 'stretch', gap: 14, marginBottom: 14 }}>
        <div
          className="pedal"
          onMouseDown={(e) => {
            const setFromEvent = (ev: { clientY: number }) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              state.current.throttle = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
            };
            setFromEvent(e);
            const move = (ev: MouseEvent) => setFromEvent(ev);
            const up = () => {
              state.current.throttle = 0;
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}
        >
          <i style={{ height: `${s.throttle * 100}%` }} />
        </div>

        <div className="gauges" style={{ flex: 1 }}>
          <Gauge label={t('rpm', lang)} value={s.rpm} frac={rpmFrac}
            color={rpmFrac > 0.97 ? 'var(--danger)' : rpmFrac > 0.88 ? 'var(--warn)' : 'var(--accent)'} />
          <Gauge label={t('torque', lang)} value={torque} unit="N·m" />
          <Gauge label={t('power', lang)} value={power / HP} unit="HP" />
          <Gauge label={t('throttlePedal', lang)} value={s.throttle * 100} unit="%" frac={s.throttle} color="var(--ok)" />
          <Gauge label={t('map', lang)} value={pt.map / 1e5} unit="bar" decimals={2} />
          <Gauge label={t('ve', lang)} value={pt.volumetricEfficiency * 100} unit="%" decimals={0} />
          <Gauge label={t('spark', lang)} value={pt.sparkAdvance} unit="°" decimals={1} color="var(--warn)" />
          <Gauge label={t('egt', lang)} value={pt.egt - 273.15} unit="°C"
            color={riskColor(pt.egt - 273.15, 870, 950)} />
          <Gauge label={t('knockRisk', lang)} value={pt.knockRisk * 100} unit="%" frac={pt.knockRisk}
            color={riskColor(pt.knockRisk, 0.7, 0.95)} />
          <Gauge label={t('duty', lang)} value={pt.injectorDutyCycle * 100} unit="%" frac={pt.injectorDutyCycle}
            color={riskColor(pt.injectorDutyCycle, 0.8, 0.9)} />
          <Gauge label={t('lambda', lang)} value={pt.lambda} decimals={2} />
          <Gauge label={t('meanPistonSpeed', lang)} value={pt.meanPistonSpeed} unit="m/s" decimals={1}
            color={riskColor(pt.meanPistonSpeed, 21, 25)} />
        </div>
      </div>

      <ChartCard title={t('rpm', lang)} series={traceSeries} height={200}
        xLabel="s" yZero={false} />
    </>
  );
}
