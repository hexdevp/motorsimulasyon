/**
 * Teshis paneli — durum kontrolu, kok neden analizi, enerji dengesi
 */

import { useMemo, useState } from 'react';
import type { EngineConfig, OperatingPoint } from '../core/types';
import { solveOperatingPoint } from '../core/cycle';
import {
  statusChecks, knockCauses, powerLossCauses, energyBalance,
  type StatusItem, type CauseItem, type Severity,
} from '../core/diagnostics';
import { makeKinematics, cylinderCount } from '../core/geometry';
import { Card } from './widgets';
import { t, type Lang } from './i18n';

const HP = 745.7;

const SEV_COLOR: Record<Severity, string> = {
  ok: 'var(--ok)', caution: 'var(--warn)', danger: 'var(--danger)', info: 'var(--accent)',
};
const SEV_ICON: Record<Severity, string> = {
  ok: '✓', caution: '⚠', danger: '⛔', info: 'ℹ',
};

export function DiagnosticsPanel({ cfg, lang }: { cfg: EngineConfig; lang: Lang }) {
  const [rpm, setRpm] = useState(() => Math.round((cfg.redline * 0.75) / 250) * 250);

  const point: OperatingPoint = useMemo(
    () => solveOperatingPoint(cfg, rpm), [cfg, rpm],
  );

  const totalDisp = useMemo(() => {
    const k = makeKinematics(cfg.geometry);
    return k.sweptVolume * cylinderCount(cfg.layout);
  }, [cfg]);

  const status = useMemo(() => statusChecks(cfg, point), [cfg, point]);
  const knock = useMemo(() => knockCauses(cfg, point), [cfg, point]);
  const losses = useMemo(() => powerLossCauses(cfg, point), [cfg, point]);
  const balance = useMemo(() => energyBalance(point, totalDisp), [point, totalDisp]);

  const rpmList = useMemo(() => {
    const out: number[] = [];
    for (let r = Math.max(cfg.idleRpm, 750); r <= cfg.redline; r += 250) out.push(r);
    return out;
  }, [cfg]);

  const fr = point.friction;
  const frItems: [string, number][] = [
    ['frRingTension', fr.ringTension],
    ['frRingGas', fr.ringGasLoaded],
    ['frSkirt', fr.pistonSkirt],
    ['frBearings', fr.bearings],
    ['frValvetrain', fr.valvetrain],
    ['frWindage', fr.windage],
    ['frOilPump', fr.oilPump],
    ['frWaterPump', fr.waterPump],
    ['frAlternator', fr.alternator],
    ...(fr.superchargerDrive > 0
      ? ([['frSupercharger', fr.superchargerDrive]] as [string, number][])
      : []),
  ];
  const fmepToHP = (fmep: number) => (fmep * totalDisp * rpm) / (2 * 60) / HP;
  const maxFr = Math.max(...frItems.map(([, v]) => v), 1);

  const ebItems: [string, number, string][] = [
    ['ebBrake', balance.brakePower, 'var(--ok)'],
    ['ebExhaust', balance.exhaustLoss, 'var(--danger)'],
    ['ebHeat', balance.heatLoss, 'var(--warn)'],
    ['ebFriction', balance.friction, 'var(--purple)'],
    ['ebPumping', balance.pumping, 'var(--accent)'],
    ['ebIncomplete', balance.incompleteCombustion, 'var(--text-faint)'],
  ];

  return (
    <>
      <Card>
        <div className="row wrap">
          <label className="dim">{t('selectRpm', lang)}</label>
          <input
            type="range" min={rpmList[0]} max={cfg.redline} step={250} value={rpm}
            style={{ flex: 1, minWidth: 200 }}
            onChange={(e) => setRpm(parseInt(e.target.value, 10))}
          />
          <b className="mono" style={{ fontSize: 17, width: 74, textAlign: 'right' }}>{rpm}</b>
          <span className="dim">rpm</span>
        </div>
        <div className="row wrap mt8" style={{ gap: 18, fontSize: 12 }}>
          <span className="dim">{t('power', lang)}: <b className="mono">{(point.power / HP).toFixed(0)} HP</b></span>
          <span className="dim">{t('torque', lang)}: <b className="mono">{point.torque.toFixed(0)} N·m</b></span>
          <span className="dim">{t('ve', lang)}: <b className="mono">{(point.volumetricEfficiency * 100).toFixed(0)}%</b></span>
          <span className="dim">{t('spark', lang)}: <b className="mono">{point.sparkAdvance.toFixed(1)}°</b></span>
          <span className="dim">{t('oilPressureLbl', lang)}: <b className="mono">{(point.oilPressure / 1e5).toFixed(2)} bar</b></span>
          {cfg.induction.type === 'TURBO' && (
            <span className="dim">{t('turboRpmLbl', lang)}: <b className="mono">{(point.turboRpm / 1000).toFixed(0)}k rpm</b></span>
          )}
        </div>
      </Card>

      <Card title={t('statusPanel', lang)}>
        <div style={{ display: 'grid', gap: 4 }}>
          {status.map((s) => <StatusRow key={s.key} item={s} lang={lang} />)}
        </div>
      </Card>

      <div className="grid2">
        <Card title={t('knockCausesTitle', lang)}>
          {knock.length === 0 ? (
            <div className="hint">{t('noKnockRisk', lang)}</div>
          ) : (
            <>
              <div className="hint" style={{ marginBottom: 9 }}>
                {lang === 'tr'
                  ? `Bu noktada vuruntu riski %${(point.knockRisk * 100).toFixed(0)}. Her etkenin payı, otomatik tutuşma gecikmesini ne kadar kısalttığından hesaplanır.`
                  : `Knock risk here is ${(point.knockRisk * 100).toFixed(0)}%. Each share is computed from how much that factor shortens the autoignition delay.`}
              </div>
              {knock.map((c) => <CauseRow key={c.key} c={c} lang={lang} color="var(--danger)" />)}
            </>
          )}
        </Card>

        <Card title={t('powerLossTitle', lang)}>
          {losses.map((c) => <CauseRow key={c.key} c={c} lang={lang} color="var(--warn)" />)}
        </Card>
      </div>

      <Card title={t('energyBalanceTitle', lang)}>
        <div className="hint" style={{ marginBottom: 10 }}>
          {t('ebFuel', lang)}: <b className="mono">{(balance.fuelPower / 1000).toFixed(1)} kW</b>
          {' '}({(balance.fuelPower / HP).toFixed(0)} HP)
        </div>
        <div style={{ display: 'flex', height: 26, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
          {ebItems.map(([key, val, color]) => {
            const frac = val / Math.max(balance.fuelPower, 1);
            if (frac <= 0.004) return null;
            return (
              <div key={key} title={`${t(key, lang)} ${(frac * 100).toFixed(1)}%`}
                style={{
                  width: `${frac * 100}%`, background: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: '#0d1117', fontWeight: 600,
                }}>
                {frac > 0.07 ? `${(frac * 100).toFixed(0)}%` : ''}
              </div>
            );
          })}
        </div>
        <div className="legend">
          {ebItems.map(([key, val, color]) => (
            <span key={key}>
              <i style={{ background: color }} />
              {t(key, lang)} — {(val / HP).toFixed(1)} HP
              {' '}(%{((val / Math.max(balance.fuelPower, 1)) * 100).toFixed(1)})
            </span>
          ))}
        </div>
      </Card>

      <Card title={`${t('frictionBreakdown', lang)} — ${rpm} rpm`}>
        <div style={{ display: 'grid', gap: 5 }}>
          {frItems.sort((a, b) => b[1] - a[1]).map(([key, val]) => (
            <div key={key} className="row" style={{ fontSize: 12 }}>
              <span className="dim" style={{ width: 148, flexShrink: 0 }}>{t(key, lang)}</span>
              <div style={{ flex: 1, height: 13, background: 'var(--bg-input)', borderRadius: 3 }}>
                <div style={{
                  width: `${(val / maxFr) * 100}%`, height: '100%',
                  background: 'var(--purple)', borderRadius: 3,
                }} />
              </div>
              <b className="mono" style={{ width: 62, textAlign: 'right' }}>
                {fmepToHP(val).toFixed(1)} HP
              </b>
            </div>
          ))}
        </div>
        <div className="hint mt8">
          {lang === 'tr' ? 'Toplam' : 'Total'}:{' '}
          <b>{(point.frictionPower / HP).toFixed(1)} HP</b> ·{' '}
          FMEP <b>{(point.fmep / 1e5).toFixed(2)} bar</b> ·{' '}
          {t('mechEff', lang)} <b>%{(point.mechanicalEfficiency * 100).toFixed(1)}</b>
        </div>
      </Card>
    </>
  );
}

function StatusRow({ item, lang }: { item: StatusItem; lang: Lang }) {
  return (
    <div className="row" style={{
      fontSize: 12.5, padding: '5px 9px', borderRadius: 4,
      borderLeft: `3px solid ${SEV_COLOR[item.severity]}`,
      background: 'var(--bg-raised)',
    }}>
      <span style={{ color: SEV_COLOR[item.severity], width: 16 }}>
        {SEV_ICON[item.severity]}
      </span>
      <span style={{ flex: 1 }}>{t(item.key, lang)}</span>
      {item.fraction !== undefined && (
        <div style={{ width: 78, height: 5, background: 'var(--bg-input)', borderRadius: 3 }}>
          <div style={{
            width: `${Math.max(0, Math.min(item.fraction, 1)) * 100}%`, height: '100%',
            background: SEV_COLOR[item.severity], borderRadius: 3,
          }} />
        </div>
      )}
      <b className="mono" style={{ width: 96, textAlign: 'right' }}>{item.value}</b>
      {item.limit && (
        <span className="dim mono" style={{ width: 132, textAlign: 'right', fontSize: 11 }}>
          {item.limit}
        </span>
      )}
    </div>
  );
}

function CauseRow({ c, lang, color }: { c: CauseItem; lang: Lang; color: string }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div className="row" style={{ fontSize: 12.5 }}>
        <span style={{ flex: 1 }}>{t(c.key, lang)}</span>
        <b className="mono">{(c.share * 100).toFixed(0)}%</b>
      </div>
      <div style={{ height: 6, background: 'var(--bg-input)', borderRadius: 3, margin: '3px 0' }}>
        <div style={{ width: `${c.share * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <div className="hint mono" style={{ fontSize: 11 }}>{c.detail}</div>
    </div>
  );
}
