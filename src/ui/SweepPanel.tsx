/** Guc/tork egrileri, detay tablosu ve silindir ici izler */

import { useMemo, useState } from 'react';
import type { SweepResult, EngineConfig } from '../core/types';
import { traceOperatingPoint } from '../core/cycle';
import { Card, ChartCard, WarningList, riskColor, type Series } from './widgets';
import { t, type Lang } from './i18n';

const HP = 745.7;
const C = {
  torque: '#4a9eff', power: '#f85149', ve: '#3fb950', spark: '#d29922',
  knock: '#f85149', pressure: '#a371f7', temp: '#ff9d5c', heat: '#56d4dd',
  intake: '#3fb950', exhaust: '#f85149',
};

export function SweepPanel({ sweep, lang }: { sweep: SweepResult; lang: Lang }) {
  const pts = sweep.points;
  const st = sweep.statics;
  const [hoverRpm, setHoverRpm] = useState<number | null>(null);

  const peakPt = pts.find((p) => p.rpm === sweep.peakPower.rpm);
  const series = useMemo(() => ({
    torque: [
      { label: `${t('torque', lang)} (N·m)`, color: C.torque, points: pts.map((p) => [p.rpm, p.torque] as [number, number]) },
      { label: `${t('power', lang)} (HP)`, color: C.power, rightAxis: true, points: pts.map((p) => [p.rpm, p.power / HP] as [number, number]) },
    ] as Series[],
    ve: [
      { label: `${t('ve', lang)} (%)`, color: C.ve, fill: true, points: pts.map((p) => [p.rpm, p.volumetricEfficiency * 100] as [number, number]) },
      { label: `${t('map', lang)} (bar)`, color: C.pressure, rightAxis: true, points: pts.map((p) => [p.rpm, p.map / 1e5] as [number, number]) },
    ] as Series[],
    spark: [
      { label: `${t('spark', lang)} (°BTDC)`, color: C.spark, points: pts.map((p) => [p.rpm, p.sparkAdvance] as [number, number]) },
      { label: `MBT (°BTDC)`, color: C.spark, dashed: true, points: pts.map((p) => [p.rpm, p.mbtAdvance] as [number, number]) },
      { label: `${t('knockRisk', lang)}`, color: C.knock, rightAxis: true, points: pts.map((p) => [p.rpm, p.knockRisk] as [number, number]) },
    ] as Series[],
    pressure: [
      { label: `${t('peakPressure', lang)} (bar)`, color: C.pressure, points: pts.map((p) => [p.rpm, p.peakPressure / 1e5] as [number, number]) },
      { label: `${t('egt', lang)} (°C)`, color: C.temp, rightAxis: true, points: pts.map((p) => [p.rpm, p.egt - 273.15] as [number, number]) },
    ] as Series[],
  }), [pts, lang]);

  const hovered = hoverRpm === null ? null
    : pts.reduce((a, b) => (Math.abs(b.rpm - hoverRpm) < Math.abs(a.rpm - hoverRpm) ? b : a));

  return (
    <>
      <div className="grid3" style={{ marginBottom: 14 }}>
        <Card title={t('peakPower', lang)}>
          <div style={{ fontSize: 27, fontFamily: 'var(--mono)', fontWeight: 600, color: C.power }}>
            {(sweep.peakPower.value / HP).toFixed(0)}
            <span style={{ fontSize: 14, color: 'var(--text-dim)' }}> HP</span>
          </div>
          <div className="dim mono" style={{ fontSize: 12 }}>
            {(sweep.peakPower.value / 1000).toFixed(0)} kW @ {sweep.peakPower.rpm} rpm
          </div>
        </Card>
        <Card title={t('peakTorque', lang)}>
          <div style={{ fontSize: 27, fontFamily: 'var(--mono)', fontWeight: 600, color: C.torque }}>
            {sweep.peakTorque.value.toFixed(0)}
            <span style={{ fontSize: 14, color: 'var(--text-dim)' }}> N·m</span>
          </div>
          <div className="dim mono" style={{ fontSize: 12 }}>
            {(sweep.peakTorque.value * 0.7376).toFixed(0)} lb-ft @ {sweep.peakTorque.rpm} rpm
          </div>
        </Card>
        <Card title={t('staticsTitle', lang)}>
          <dl className="specs">
            <dt>{t('displacement', lang)}</dt>
            <dd>{(st.totalDisplacement * 1e6).toFixed(0)} cc</dd>
            <dt>{t('rodStroke', lang)}</dt><dd>{st.rodStrokeRatio.toFixed(2)}</dd>
            <dt>{t('dcr', lang)}</dt><dd>{st.dynamicCR.toFixed(2)}:1</dd>
            <dt>{t('valveFloatRpm', lang)}</dt>
            <dd>{Number.isFinite(st.valveFloatRpm) ? st.valveFloatRpm.toFixed(0) : '—'} rpm</dd>
            <dt>{t('recommendedRedline', lang)}</dt><dd>{st.recommendedRedline.toFixed(0)} rpm</dd>
            {peakPt && (<>
              <dt>{t('parasiticLoss', lang)}</dt>
              <dd>{(peakPt.frictionPower / HP).toFixed(0)} HP</dd>
            </>)}
          </dl>
        </Card>
      </div>

      <div className="grid2" style={{ marginBottom: 14 }}>
        <ChartCard title={t('torqueCurve', lang)} series={series.torque}
          xLabel="rpm" height={230} marker={hoverRpm ?? undefined} onHover={setHoverRpm} />
        <ChartCard title={t('veCurve', lang)} series={series.ve}
          xLabel="rpm" height={230} marker={hoverRpm ?? undefined} onHover={setHoverRpm} />
        <ChartCard title={t('sparkCurve', lang)} series={series.spark}
          xLabel="rpm" height={230} yZero={false} marker={hoverRpm ?? undefined} onHover={setHoverRpm} />
        <ChartCard title={t('pressureCurve', lang)} series={series.pressure}
          xLabel="rpm" height={230} marker={hoverRpm ?? undefined} onHover={setHoverRpm} />
      </div>

      {hovered && hovered.warnings.length > 0 && (
        <Card title={`${hovered.rpm} rpm`}>
          <WarningList warnings={hovered.warnings} lang={lang} />
        </Card>
      )}

      <Card title={t('detailTable', lang)}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('rpm', lang)}</th>
                <th>{t('map', lang)}<br />bar</th>
                <th>{t('airflow', lang)}<br />g/s</th>
                <th>{t('ve', lang)}<br />%</th>
                <th>{t('spark', lang)}<br />°BTDC</th>
                <th>IMEP<br />bar</th>
                <th>BMEP<br />bar</th>
                <th>{t('torque', lang)}<br />N·m</th>
                <th>{t('power', lang)}<br />HP</th>
                <th>{t('peakPressure', lang)}<br />bar</th>
                <th>{t('cylTemp', lang)}<br />°C</th>
                <th>{t('egt', lang)}<br />°C</th>
                <th>{t('knockRisk', lang)}<br />%</th>
                <th>{t('duty', lang)}<br />%</th>
                <th>{t('thermalEff', lang)}<br />%</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={p.rpm}>
                  <td><b>{p.rpm}</b></td>
                  <td>{(p.map / 1e5).toFixed(2)}</td>
                  <td>{(p.massAirFlow * 1000).toFixed(1)}</td>
                  <td>{(p.volumetricEfficiency * 100).toFixed(1)}</td>
                  <td>{p.sparkAdvance.toFixed(1)}</td>
                  <td>{(p.imep / 1e5).toFixed(2)}</td>
                  <td>{(p.bmep / 1e5).toFixed(2)}</td>
                  <td>{p.torque.toFixed(1)}</td>
                  <td>{(p.power / HP).toFixed(1)}</td>
                  <td>{(p.peakPressure / 1e5).toFixed(0)}</td>
                  <td>{(p.peakTemperature - 273.15).toFixed(0)}</td>
                  <td>{(p.egt - 273.15).toFixed(0)}</td>
                  <td style={{ color: riskColor(p.knockRisk, 0.7, 0.95) }}>
                    {(p.knockRisk * 100).toFixed(0)}
                  </td>
                  <td style={{ color: riskColor(p.injectorDutyCycle, 0.8, 0.9) }}>
                    {(p.injectorDutyCycle * 100).toFixed(0)}
                  </td>
                  <td>{(p.thermalEfficiency * 100).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ============================================================
// SILINDIR ICI IZLER
// ============================================================

export function CylinderPanel({ cfg, lang }: { cfg: EngineConfig; lang: Lang }) {
  const [rpm, setRpm] = useState(Math.round(cfg.redline * 0.7 / 250) * 250);
  const pt = useMemo(() => traceOperatingPoint(cfg, rpm), [cfg, rpm]);
  const tr = pt.trace!;

  const sample = <T,>(fn: (i: number) => T, stride = 4): T[] => {
    const out: T[] = [];
    for (let i = 0; i < tr.theta.length; i += stride) out.push(fn(i));
    return out;
  };

  const pv: Series[] = [{
    label: 'P-V', color: C.pressure,
    points: sample((i) => [tr.volume[i] * 1e6, tr.pressure[i] / 1e5] as [number, number], 2),
  }];

  const pressure: Series[] = [
    {
      label: `${t('pressure', lang)} (bar)`, color: C.pressure,
      points: sample((i) => [tr.theta[i], tr.pressure[i] / 1e5] as [number, number]),
    },
    {
      label: `${t('temperature', lang)} (K)`, color: C.temp, rightAxis: true,
      points: sample((i) => [tr.theta[i], tr.temperature[i]] as [number, number]),
    },
  ];

  const heat: Series[] = [
    {
      label: `${t('heatReleaseTrace', lang)} (J/°)`, color: C.heat, fill: true,
      points: sample((i) => [tr.theta[i], tr.heatRelease[i]] as [number, number]),
    },
    {
      label: 'xb (%)', color: C.ve, rightAxis: true,
      points: sample((i) => [tr.theta[i], tr.burnFraction[i] * 100] as [number, number]),
    },
  ];

  const lift: Series[] = [
    {
      label: `${lang === 'tr' ? 'Emme' : 'Intake'} (mm)`, color: C.intake,
      points: sample((i) => [tr.theta[i], tr.intakeLift[i] * 1000] as [number, number]),
    },
    {
      label: `${lang === 'tr' ? 'Egzoz' : 'Exhaust'} (mm)`, color: C.exhaust,
      points: sample((i) => [tr.theta[i], tr.exhaustLift[i] * 1000] as [number, number]),
    },
    {
      label: `${t('knockRisk', lang)}`, color: C.knock, rightAxis: true, dashed: true,
      points: sample((i) => [tr.theta[i], tr.knockIntegral[i]] as [number, number]),
    },
  ];

  const rpms: number[] = [];
  for (let r = Math.max(cfg.idleRpm, 1000); r <= cfg.redline; r += 250) rpms.push(r);

  return (
    <>
      <Card>
        <div className="row wrap">
          <label className="dim">{t('selectRpm', lang)}</label>
          <input
            type="range" min={rpms[0]} max={cfg.redline} step={250}
            value={rpm} style={{ flex: 1, minWidth: 200 }}
            onChange={(e) => setRpm(parseInt(e.target.value, 10))}
          />
          <b className="mono" style={{ fontSize: 17, width: 74, textAlign: 'right' }}>{rpm}</b>
          <span className="dim">rpm</span>
        </div>
        <div className="row wrap mt8" style={{ gap: 20, fontSize: 12 }}>
          <span className="dim">{t('peakPressure', lang)}: <b className="mono">{(pt.peakPressure / 1e5).toFixed(1)} bar</b></span>
          <span className="dim">@ <b className="mono">{pt.peakPressureAngle.toFixed(1)}° ATDC</b></span>
          <span className="dim">{t('spark', lang)}: <b className="mono">{pt.sparkAdvance.toFixed(1)}°BTDC</b></span>
          <span className="dim">{t('burnDuration', lang)}: <b className="mono">{pt.burnDuration.toFixed(1)}°</b></span>
          <span className="dim">{t('flameSpeed', lang)}: <b className="mono">{pt.flameSpeed.toFixed(1)} m/s</b></span>
          <span className="dim">{t('residual', lang)}: <b className="mono">{(pt.residualFraction * 100).toFixed(1)}%</b></span>
        </div>
      </Card>

      <div className="grid2">
        <ChartCard title={t('pvDiagram', lang)} series={pv} height={250}
          xLabel="cc" yLabel="bar" yZero={false} />
        <ChartCard title={t('pressureTrace', lang)} series={pressure} height={250}
          xLabel={t('crankAngle', lang)} yZero={false} />
        <ChartCard title={t('heatReleaseTrace', lang)} series={heat} height={250}
          xLabel={t('crankAngle', lang)} />
        <ChartCard title={t('valveLiftTrace', lang)} series={lift} height={250}
          xLabel={t('crankAngle', lang)} />
      </div>

      <Card title={`${rpm} rpm`}>
        <WarningList warnings={pt.warnings} lang={lang} />
      </Card>
    </>
  );
}
