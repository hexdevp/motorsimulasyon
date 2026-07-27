/** Motor kurulum paneli — tum parametrelerin girisi */

import type { EngineConfig, Layout, Valvetrain, InductionType, FuelType, InjectionType } from '../core/types';
import { PRESET_LIST, getPreset } from '../core/presets';
import { makeFuel, FUEL_TYPES } from '../core/fuel';
import { computeStatics } from '../core/sweep';
import { intakeTunedRpm } from '../core/induction';
import { valveOverlap, computedLSA } from '../core/valve';
import { cylinderCount } from '../core/geometry';
import { flywheelEffects } from '../core/thermal';
import { MANIFOLDS, MANIFOLD_TYPES } from '../core/turbo';
import {
  LOCATIONS, applyLocation, pressureAtAltitude,
  densityAltitudeFactor, oxygenFactor,
} from '../core/environment';
import { Card, NumField, SelectField, CheckField, Field } from './widgets';
import { t, type Lang } from './i18n';

interface Props {
  cfg: EngineConfig;
  onChange: (c: EngineConfig) => void;
  lang: Lang;
}

/** Ic ice gecmis alanlari degistirmek icin yardimci */
function patch<K extends keyof EngineConfig>(
  cfg: EngineConfig, key: K, sub: Partial<EngineConfig[K]>,
): EngineConfig {
  return { ...cfg, [key]: { ...(cfg[key] as object), ...sub } };
}

const LAYOUTS: Layout[] = ['I3', 'I4', 'I5', 'I6', 'V6', 'V8', 'V10', 'V12', 'B4', 'B6'];
const VALVETRAINS: Valvetrain[] = ['OHV', 'SOHC', 'DOHC'];
const INDUCTIONS: InductionType[] = ['NA', 'TURBO', 'SUPERCHARGER'];
const INJECTIONS: InjectionType[] = ['PORT', 'DIRECT'];

export function SetupPanel({ cfg, onChange, lang }: Props) {
  const g = cfg.geometry, v = cfg.valvetrain, ind = cfg.induction;
  const fs = cfg.fuelSystem, ig = cfg.ignition, m = cfg.mechanical, amb = cfg.ambient;
  const st = computeStatics(cfg);
  const preset = PRESET_LIST.find((p) => p.id === cfg.id);

  // Volan etkileri — kaba bir tepe tork tahmininden (BMEP ~ 11 bar)
  const nCyl = cylinderCount(cfg.layout);
  const estPeakTorque = (11e5 * st.totalDisplacement) / (4 * Math.PI);
  const fly = flywheelEffects(
    st.totalRotatingInertia, estPeakTorque,
    estPeakTorque * 0.55, cfg.idleRpm, cfg.redline, nCyl,
  );

  const mm = (v: number) => v * 1000;
  const setMm = (v: number) => v / 1000;

  return (
    <>
      <Card title={t('engine', lang)}>
        <Field label={t('engine', lang)}>
          <select
            value={cfg.id}
            style={{ width: 250 }}
            onChange={(e) => onChange(getPreset(e.target.value))}
          >
            {PRESET_LIST.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {(p.displacement * 1000).toFixed(1)}L {p.layout}
                {p.induction !== 'NA' ? ' Turbo' : ''}
              </option>
            ))}
          </select>
        </Field>
        {preset && (
          <div className="preset-note">
            {preset.manufacturer} · {preset.years} — {lang === 'tr' ? preset.note : preset.noteEn}
          </div>
        )}
      </Card>

      <div className="grid3">
        <div>
          <Card title={t('grpLayout', lang)}>
            <SelectField
              label={t('layout', lang)} value={cfg.layout}
              options={LAYOUTS.map((l) => ({ value: l, label: l }))}
              onChange={(l) => onChange({ ...cfg, layout: l })}
            />
            <NumField label={t('bore', lang)} unit="mm" value={mm(g.bore)} step={0.5} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'geometry', { bore: setMm(x) }))} />
            <NumField label={t('stroke', lang)} unit="mm" value={mm(g.stroke)} step={0.5} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'geometry', { stroke: setMm(x) }))} />
            <NumField label={t('rodLength', lang)} unit="mm" value={mm(g.rodLength)} step={0.5} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'geometry', { rodLength: setMm(x) }))} />
            <NumField label={t('compressionRatio', lang)} unit=":1" value={g.compressionRatio} step={0.1} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'geometry', { compressionRatio: Math.max(x, 4) }))} />
            <NumField label={t('deckClearance', lang)} unit="mm" value={mm(g.deckClearance)} step={0.1} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'geometry', { deckClearance: setMm(x) }))} />
            <NumField label={t('pinOffset', lang)} unit="mm" value={mm(g.pinOffset)} step={0.1} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'geometry', { pinOffset: setMm(x) }))} />
            <NumField label={t('squishArea', lang)} value={g.squishAreaRatio} step={0.05} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'geometry', { squishAreaRatio: x }))} />
            <NumField label={t('redline', lang)} unit="rpm" value={cfg.redline} step={100} decimals={0}
              onChange={(x) => onChange({ ...cfg, redline: Math.max(x, 2000) })} />
            <NumField label={t('idleRpm', lang)} unit="rpm" value={cfg.idleRpm} step={50} decimals={0}
              onChange={(x) => onChange({ ...cfg, idleRpm: Math.max(x, 400) })} />
          </Card>

          <Card title={t('grpMechanical', lang)}>
            <NumField label={t('pistonMass', lang)} unit="g" value={m.pistonMass * 1000} step={10} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { pistonMass: x / 1000 }))} />
            <NumField label={t('rodMass', lang)} unit="g" value={m.rodMass * 1000} step={10} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { rodMass: x / 1000 }))} />
            <NumField label={t('flywheelInertia', lang)} unit="kg·m²" value={m.flywheelInertia} step={0.01} decimals={3}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { flywheelInertia: Math.max(x, 0.01) }))} />
            <NumField label={t('ringTension', lang)} value={m.ringTension} step={0.05} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { ringTension: x }))} />
            <NumField label={t('oilGrade', lang)} value={m.oilGrade} step={10} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { oilGrade: x }))} />
            <NumField label={t('oilTemp', lang)} unit="°C" value={m.oilTemp - 273.15} step={5} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { oilTemp: x + 273.15 }))} />
            <NumField label={t('coolantTemp', lang)} unit="°C" value={m.coolantTemp - 273.15} step={5} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { coolantTemp: x + 273.15 }))} />
            <NumField label={t('accessoryLoad', lang)} unit="W" value={m.accessoryLoad} step={50} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'mechanical', { accessoryLoad: x }))} />

            {/* Volan ataleti zaten simulasyonda kullaniliyordu; burada
                sonuclarini somut iki metrik olarak gosteriyoruz. */}
            <div className="hint mt8">
              <b>{t('flywheelEffects', lang)}</b><br />
              {t('revUpTime', lang)}: <b>{fly.revUpTime.toFixed(2)} s</b><br />
              {t('idleVariation', lang)}: <b>±{fly.idleVariationRpm.toFixed(0)} rpm</b>{' '}
              (<span style={{
                color: fly.idleStability === 'stable' ? 'var(--ok)'
                  : fly.idleStability === 'marginal' ? 'var(--warn)' : 'var(--danger)',
              }}>{t(fly.idleStability, lang)}</span>)
            </div>
          </Card>
        </div>

        <div>
          <Card title={t('grpValvetrain', lang)}>
            <SelectField
              label={t('valvetrainType', lang)} value={v.type}
              options={VALVETRAINS.map((x) => ({ value: x, label: x }))}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { type: x }))}
            />
            <NumField label={t('intakeValves', lang)} value={v.intakeValvesPerCyl} step={1} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { intakeValvesPerCyl: Math.max(1, Math.round(x)) }))} />
            <NumField label={t('exhaustValves', lang)} value={v.exhaustValvesPerCyl} step={1} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { exhaustValvesPerCyl: Math.max(1, Math.round(x)) }))} />
            <NumField label={t('intakeValveDia', lang)} unit="mm" value={mm(v.intakeValveDia)} step={0.5} decimals={1}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { intakeValveDia: setMm(x) }))} />
            <NumField label={t('exhaustValveDia', lang)} unit="mm" value={mm(v.exhaustValveDia)} step={0.5} decimals={1}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { exhaustValveDia: setMm(x) }))} />
            <NumField label={t('camLift', lang)} unit="mm" value={mm(v.intakeCam.lift)} step={0.2} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', {
                intakeCam: { ...v.intakeCam, lift: setMm(x) },
                exhaustCam: { ...v.exhaustCam, lift: setMm(x) },
              }))} />
            <NumField label={t('camDuration', lang)} unit="°" value={v.intakeCam.advertisedDuration} step={2} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', {
                intakeCam: { ...v.intakeCam, advertisedDuration: x, duration: x * 0.82 },
                exhaustCam: { ...v.exhaustCam, advertisedDuration: x, duration: x * 0.82 },
              }))} />
            <NumField label={t('intakeCenterline', lang)} unit="°" value={v.intakeCam.centerline} step={1} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', {
                intakeCam: { ...v.intakeCam, centerline: x },
              }))} />
            <NumField label={t('exhaustCenterline', lang)} unit="°" value={v.exhaustCam.centerline} step={1} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', {
                exhaustCam: { ...v.exhaustCam, centerline: x },
              }))} />
            <NumField label={t('springOpen', lang)} unit="N" value={v.springOpenPressure} step={20} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', {
                springOpenPressure: x, springSeatPressure: x * 0.42,
              }))} />
            <NumField label={t('portQuality', lang)} value={v.portFlowQuality} step={0.05} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { portFlowQuality: x }))} />
            <NumField label={t('swirl', lang)} value={v.swirlRatio} step={0.1} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { swirlRatio: x }))} />
            <NumField label={t('tumble', lang)} value={v.tumbleRatio} step={0.1} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'valvetrain', { tumbleRatio: x }))} />
            <div className="hint mt8">
              {t('valveOverlapLbl', lang)}: <b>{valveOverlap(v).toFixed(0)}°</b> ·{' '}
              {t('lsa', lang)}: <b>{computedLSA(v).toFixed(0)}°</b> ·{' '}
              {t('ivcAngle', lang)}: <b>{st.ivcAngle.toFixed(0)}° ABDC</b>
            </div>
          </Card>
        </div>

        <div>
          <Card title={t('grpInduction', lang)}>
            <SelectField
              label={t('inductionType', lang)} value={ind.type}
              options={INDUCTIONS.map((x) => ({
                value: x,
                label: x === 'NA' ? (lang === 'tr' ? 'Doğal emişli' : 'Naturally asp.')
                  : x === 'TURBO' ? 'Turbo' : (lang === 'tr' ? 'Mekanik körük' : 'Supercharger'),
              }))}
              onChange={(x) => onChange(patch(cfg, 'induction', { type: x }))}
            />
            {ind.type !== 'NA' && (
              <>
                <NumField label={t('boost', lang)} unit="bar" value={ind.targetBoost / 1e5} step={0.05} decimals={2}
                  onChange={(x) => onChange(patch(cfg, 'induction', {
                    targetBoost: x * 1e5,
                    boostLimit: cfg.ambient.pressure + x * 1e5 * 1.15,
                  }))} />
                <NumField label={t('fullBoostRpm', lang)} unit="rpm" value={ind.fullBoostRpm} step={100} decimals={0}
                  onChange={(x) => onChange(patch(cfg, 'induction', { fullBoostRpm: x }))} />
                <NumField label={t('compressorEff', lang)} value={ind.compressorEfficiency} step={0.02} decimals={2}
                  onChange={(x) => onChange(patch(cfg, 'induction', { compressorEfficiency: x }))} />
                <NumField label={t('intercoolerEff', lang)} value={ind.intercoolerEfficiency} step={0.05} decimals={2}
                  onChange={(x) => onChange(patch(cfg, 'induction', { intercoolerEfficiency: x }))} />
              </>
            )}
            <NumField label={t('runnerLength', lang)} unit="mm" value={mm(ind.runnerLength)} step={10} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'induction', { runnerLength: setMm(x) }))} />
            <NumField label={t('runnerDiameter', lang)} unit="mm" value={mm(ind.runnerDiameter)} step={1} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'induction', { runnerDiameter: setMm(x) }))} />
            <NumField label={t('primaryDiameter', lang)} unit="mm" value={mm(ind.primaryDiameter)} step={1} decimals={1}
              onChange={(x) => onChange(patch(cfg, 'induction', { primaryDiameter: setMm(x) }))} />
            <NumField label={t('exhaustCapacity', lang)} value={ind.exhaustFlowCapacity} step={0.05} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'induction', { exhaustFlowCapacity: Math.max(x, 0.2) }))} />
            <SelectField
              label={t('manifoldType', lang)} value={ind.manifold}
              options={MANIFOLD_TYPES.map((mt) => ({
                value: mt, label: lang === 'tr' ? MANIFOLDS[mt].name : MANIFOLDS[mt].nameEn,
              }))}
              onChange={(mt) => onChange(patch(cfg, 'induction', { manifold: mt }))}
            />
            <div className="preset-note">
              {lang === 'tr' ? MANIFOLDS[ind.manifold].note : MANIFOLDS[ind.manifold].noteEn}
            </div>
            {ind.type === 'TURBO' && (
              <>
                <NumField label={t('turbineAR', lang)} value={ind.turbineAR} step={0.05} decimals={2}
                  onChange={(x) => onChange(patch(cfg, 'induction', {
                    turbineAR: Math.max(0.3, Math.min(x, 2.0)),
                  }))} />
                <NumField label={t('compressorWheel', lang)} unit="mm" value={ind.compressorWheelDia * 1000} step={1} decimals={0}
                  onChange={(x) => onChange(patch(cfg, 'induction', {
                    compressorWheelDia: Math.max(x / 1000, 0.02),
                    // Atalet cark capinin besinci kuvvetiyle olceklenir
                    turboInertia: 2.2e-5 * Math.pow(x / 1000 / 0.065, 5),
                  }))} />
                <NumField label={t('compressorPeakEff', lang)} value={ind.compressorPeakEff} step={0.01} decimals={2}
                  onChange={(x) => onChange(patch(cfg, 'induction', {
                    compressorPeakEff: Math.max(0.5, Math.min(x, 0.86)),
                  }))} />
                <div className="hint">
                  {t('turboInertia', lang)}:{' '}
                  <b>{(ind.turboInertia * 1e6).toFixed(1)}×10⁻⁶ kg·m²</b>
                </div>
              </>
            )}
            <div className="hint mt8">
              {t('intakeTuned', lang)}:{' '}
              <b>~{Math.round(intakeTunedRpm(ind, st.displacementPerCyl, g.compressionRatio, 320))} rpm</b>
            </div>
          </Card>

          <Card title={t('grpFuel', lang)}>
            <SelectField
              label={t('fuelType', lang)} value={cfg.fuel.type}
              options={FUEL_TYPES.map((f) => ({ value: f, label: makeFuel(f).name }))}
              onChange={(f: FuelType) => onChange({ ...cfg, fuel: makeFuel(f) })}
            />
            <NumField label={t('octane', lang)} unit="RON" value={cfg.fuel.ron} step={1} decimals={0}
              onChange={(x) => onChange({ ...cfg, fuel: makeFuel(cfg.fuel.type, x) })} />
            <SelectField
              label={t('injectionType', lang)} value={fs.injection}
              options={INJECTIONS.map((x) => ({
                value: x, label: x === 'PORT' ? (lang === 'tr' ? 'Port' : 'Port') : (lang === 'tr' ? 'Direkt' : 'Direct'),
              }))}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', { injection: x }))}
            />
            <NumField label={t('injectorFlow', lang)} unit="cc" value={fs.injectorFlowCC} step={10} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', { injectorFlowCC: Math.max(x, 50) }))} />
            <NumField label={t('railPressure', lang)} unit="bar" value={fs.railPressure / 1e5} step={0.25} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', { railPressure: x * 1e5 }))} />
            <NumField label={t('targetLambda', lang)} value={fs.targetLambda} step={0.01} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', { targetLambda: Math.max(0.6, Math.min(x, 1.3)) }))} />
            <NumField label={t('targetLambdaWOT', lang)} value={fs.targetLambdaWOT} step={0.01} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', { targetLambdaWOT: Math.max(0.6, Math.min(x, 1.3)) }))} />
            <NumField label={t('fuelTemp', lang)} unit="°C" value={fs.fuelTemp - 273.15} step={5} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', { fuelTemp: x + 273.15 }))} />
            <NumField label={t('pumpFlow', lang)} unit="L/s" value={fs.pumpFlowLPH} step={10} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', { pumpFlowLPH: Math.max(x, 20) }))} />
            <NumField label={t('pumpDeadhead', lang)} unit="bar" value={fs.pumpDeadheadPressure / 1e5} step={0.5} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'fuelSystem', {
                pumpDeadheadPressure: Math.max(x * 1e5, fs.railPressure * 1.2),
              }))} />
            <CheckField label={t('autoMBT', lang)} value={ig.autoMBT}
              onChange={(x) => onChange(patch(cfg, 'ignition', { autoMBT: x }))} />
            {!ig.autoMBT && (
              <NumField label={t('fixedAdvance', lang)} unit="°" value={ig.fixedAdvance} step={1} decimals={0}
                onChange={(x) => onChange(patch(cfg, 'ignition', { fixedAdvance: x }))} />
            )}
            <NumField label={t('maxRetard', lang)} unit="°" value={ig.maxRetard} step={1} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'ignition', { maxRetard: x }))} />
            <NumField label={t('knockThreshold', lang)} value={ig.knockThreshold} step={0.05} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'ignition', { knockThreshold: Math.max(x, 0.1) }))} />
          </Card>

          <Card title={t('grpEnvironment', lang)}>
            <Field label={t('location', lang)}>
              <select
                style={{ width: 190 }}
                value={LOCATIONS.find((l) =>
                  Math.abs(l.altitude - amb.altitude) < 1 &&
                  Math.abs(l.tempC + 273.15 - amb.temperature) < 0.5)?.id ?? ''}
                onChange={(e) => {
                  const loc = LOCATIONS.find((l) => l.id === e.target.value);
                  if (loc) onChange({ ...cfg, ambient: applyLocation(amb, loc) });
                }}
              >
                <option value="">—</option>
                {LOCATIONS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {lang === 'tr' ? l.name : l.nameEn} ({l.altitude} m)
                  </option>
                ))}
              </select>
            </Field>
            <NumField label={t('altitude', lang)} unit="m" value={amb.altitude} step={50} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'ambient', {
                altitude: x,
                pressure: amb.useAltitude ? pressureAtAltitude(x) : amb.pressure,
              }))} />
            <CheckField label={t('useAltitude', lang)} value={amb.useAltitude}
              onChange={(x) => onChange(patch(cfg, 'ambient', {
                useAltitude: x,
                pressure: x ? pressureAtAltitude(amb.altitude) : amb.pressure,
              }))} />
            <NumField label={t('ambientTemp', lang)} unit="°C" value={amb.temperature - 273.15} step={1} decimals={0}
              onChange={(x) => onChange(patch(cfg, 'ambient', { temperature: x + 273.15 }))} />
            <NumField label={t('ambientPressure', lang)} unit="kPa" value={amb.pressure / 1000} step={1} decimals={1}
              onChange={(x) => onChange(patch(cfg, 'ambient', {
                pressure: x * 1000, useAltitude: false,
              }))} />
            <NumField label={t('humidity', lang)} value={amb.humidity} step={0.05} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'ambient', { humidity: Math.max(0, Math.min(x, 1)) }))} />
            <NumField label={t('throttle', lang)} value={ind.throttlePosition} step={0.05} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'induction', {
                throttlePosition: Math.max(0.02, Math.min(x, 1)),
              }))} />
            <div className="hint mt8">
              {lang === 'tr' ? 'Hava yoğunluğu' : 'Air density'}:{' '}
              <b>%{(densityAltitudeFactor({ ...amb, pressure: amb.useAltitude
                ? pressureAtAltitude(amb.altitude) : amb.pressure }) * 100).toFixed(1)}</b>
              {' · '}
              {lang === 'tr' ? 'oksijen' : 'oxygen'}:{' '}
              <b>%{(oxygenFactor(amb.pressure, amb.temperature, amb.humidity) * 100).toFixed(1)}</b>
            </div>
          </Card>

          <Card title={t('grpLubrication', lang)}>
            <NumField label={t('mainClearance', lang)} unit="mm" value={m.mainBearingClearance * 1000} step={0.005} decimals={4}
              onChange={(x) => onChange(patch(cfg, 'mechanical', {
                mainBearingClearance: Math.max(x / 1000, 5e-6),
              }))} />
            <NumField label={t('rodClearance', lang)} unit="mm" value={m.rodBearingClearance * 1000} step={0.005} decimals={4}
              onChange={(x) => onChange(patch(cfg, 'mechanical', {
                rodBearingClearance: Math.max(x / 1000, 5e-6),
              }))} />
            <NumField label={t('oilPumpCapacity', lang)} value={m.oilPumpCapacity} step={0.1} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'mechanical', {
                oilPumpCapacity: Math.max(x, 0.2),
              }))} />
            <NumField label={t('oilRelief', lang)} unit="bar" value={m.oilReliefPressure / 1e5} step={0.25} decimals={2}
              onChange={(x) => onChange(patch(cfg, 'mechanical', {
                oilReliefPressure: Math.max(x * 1e5, 1e5),
              }))} />
          </Card>
        </div>
      </div>
    </>
  );
}
