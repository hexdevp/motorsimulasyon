/**
 * Analiz raporu — arkadasinin istedigi cikti bicimi
 *
 * BOLUM 1: statik ozellikler ve hesaplanan geometri
 * BOLUM 2: devir bazli simulasyon tablosu + degerlendirme
 */

import { useMemo, useState } from 'react';
import type { SweepResult, OperatingPoint } from '../core/types';
import { valveOverlap, computedLSA } from '../core/valve';
import { Card, WarningList, riskColor } from './widgets';
import { t, warningKey, type Lang } from './i18n';

const HP = 745.7;

export function ReportPanel({ sweep, lang }: { sweep: SweepResult; lang: Lang }) {
  const [copied, setCopied] = useState(false);
  const cfg = sweep.engine;
  const st = sweep.statics;
  const pts = sweep.points;
  const peak = pts.find((p) => p.rpm === sweep.peakPower.rpm) ?? pts[pts.length - 1];

  // Raporda 1000'er devir gosterelim (tabloyu okunur tutmak icin)
  const reportPts = useMemo(() => {
    const out: OperatingPoint[] = [];
    let next = Math.ceil(pts[0].rpm / 1000) * 1000;
    for (const p of pts) {
      if (p.rpm >= next) { out.push(p); next += 1000; }
    }
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }, [pts]);

  const markdown = useMemo(() => buildMarkdown(sweep, reportPts, lang), [sweep, reportPts, lang]);

  const L = lang === 'tr';

  return (
    <>
      <Card>
        <div className="row">
          <button className="primary" onClick={() => {
            navigator.clipboard?.writeText(markdown);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}>
            {copied ? t('copied', lang) : t('exportReport', lang)}
          </button>
          <span className="hint">
            {L ? 'Rapor Markdown olarak panoya kopyalanır.' : 'The report is copied as Markdown.'}
          </span>
        </div>
      </Card>

      <Card title={t('reportPart1', lang)}>
        <div className="grid3">
          <dl className="specs">
            <dt>{t('displacement', lang)}</dt>
            <dd>{(st.totalDisplacement * 1e6).toFixed(0)} cc / {(st.totalDisplacement * 1000).toFixed(2)} L</dd>
            <dt>{t('displacementPerCyl', lang)}</dt>
            <dd>{(st.displacementPerCyl * 1e6).toFixed(1)} cc</dd>
            <dt>{t('clearanceVol', lang)}</dt>
            <dd>{(st.clearanceVolume * 1e6).toFixed(2)} cc</dd>
            <dt>{t('boreStroke', lang)}</dt><dd>{st.boreStrokeRatio.toFixed(3)}</dd>
            <dt>{t('rodStroke', lang)}</dt><dd>{st.rodStrokeRatio.toFixed(3)}</dd>
          </dl>
          <dl className="specs">
            <dt>{t('compressionRatio', lang)}</dt><dd>{cfg.geometry.compressionRatio.toFixed(2)}:1</dd>
            <dt>{t('dcr', lang)}</dt><dd>{st.dynamicCR.toFixed(2)}:1</dd>
            <dt>{t('ivcAngle', lang)}</dt><dd>{st.ivcAngle.toFixed(0)}° ABDC</dd>
            <dt>{t('valveOverlapLbl', lang)}</dt><dd>{valveOverlap(cfg.valvetrain).toFixed(0)}°</dd>
            <dt>{t('lsa', lang)}</dt><dd>{computedLSA(cfg.valvetrain).toFixed(0)}°</dd>
          </dl>
          <dl className="specs">
            <dt>{t('meanPistonSpeed', lang)} @ {cfg.redline}</dt>
            <dd>{((2 * cfg.geometry.stroke * cfg.redline) / 60).toFixed(1)} m/s</dd>
            <dt>{t('valveFloatRpm', lang)}</dt>
            <dd>{Number.isFinite(st.valveFloatRpm) ? st.valveFloatRpm.toFixed(0) : '—'} rpm</dd>
            <dt>{t('recommendedRedline', lang)}</dt><dd>{st.recommendedRedline.toFixed(0)} rpm</dd>
            <dt>{t('valveToPiston', lang)}</dt><dd>{st.valveToPistonAreaRatio.toFixed(3)}</dd>
            <dt>{t('rotatingInertia', lang)}</dt><dd>{st.totalRotatingInertia.toFixed(3)} kg·m²</dd>
          </dl>
        </div>

        <h4 style={{ margin: '16px 0 8px', fontSize: 12, color: 'var(--text-dim)' }}>
          {t('parasiticLoss', lang)} — {peak.rpm} rpm
        </h4>
        <div className="grid3">
          <dl className="specs">
            <dt>{t('frRingTension', lang)}</dt><dd>{fmepHP(peak.friction.ringTension, peak, sweep)} HP</dd>
            <dt>{t('frRingGas', lang)}</dt><dd>{fmepHP(peak.friction.ringGasLoaded, peak, sweep)} HP</dd>
          </dl>
          <dl className="specs">
            <dt>{t('frSkirt', lang)}</dt><dd>{fmepHP(peak.friction.pistonSkirt, peak, sweep)} HP</dd>
            <dt>{t('frBearings', lang)}</dt><dd>{fmepHP(peak.friction.bearings, peak, sweep)} HP</dd>
          </dl>
          <dl className="specs">
            <dt>{t('frValvetrain', lang)}</dt><dd>{fmepHP(peak.friction.valvetrain, peak, sweep)} HP</dd>
            <dt>{t('frWindage', lang)}</dt><dd>{fmepHP(peak.friction.windage, peak, sweep)} HP</dd>
          </dl>
          <dl className="specs">
            <dt>{t('frOilPump', lang)}</dt><dd>{fmepHP(peak.friction.oilPump, peak, sweep)} HP</dd>
            <dt>{t('frWaterPump', lang)}</dt><dd>{fmepHP(peak.friction.waterPump, peak, sweep)} HP</dd>
          </dl>
          <dl className="specs">
            <dt>{t('frAlternator', lang)}</dt><dd>{fmepHP(peak.friction.alternator, peak, sweep)} HP</dd>
            {peak.friction.superchargerDrive > 0 && (<>
              <dt>{t('frSupercharger', lang)}</dt>
              <dd>{fmepHP(peak.friction.superchargerDrive, peak, sweep)} HP</dd>
            </>)}
          </dl>
        </div>
        <div className="hint mt8">
          {L ? 'Toplam sürtünme kaybı' : 'Total friction loss'}:{' '}
          <b>{(peak.frictionPower / HP).toFixed(1)} HP</b> ·{' '}
          {t('mechEff', lang)}: <b>{(peak.mechanicalEfficiency * 100).toFixed(1)}%</b>
        </div>
      </Card>

      <Card title={t('reportPart2', lang)}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>RPM</th><th>MAP<br />bar</th><th>{t('airflow', lang)}<br />g/s</th>
                <th>VE<br />%</th><th>{t('spark', lang)}<br />°BTDC</th>
                <th>IMEP / BMEP<br />bar</th><th>{t('torque', lang)}<br />N·m</th>
                <th>{t('power', lang)}<br />HP</th><th>{t('cylTemp', lang)}<br />°C</th>
                <th>{t('knockRisk', lang)}<br />%</th>
              </tr>
            </thead>
            <tbody>
              {reportPts.map((p) => (
                <tr key={p.rpm}>
                  <td><b>{p.rpm}</b></td>
                  <td>{(p.map / 1e5).toFixed(2)}</td>
                  <td>{(p.massAirFlow * 1000).toFixed(1)}</td>
                  <td>{(p.volumetricEfficiency * 100).toFixed(1)}</td>
                  <td>{p.sparkAdvance.toFixed(1)}</td>
                  <td>{(p.imep / 1e5).toFixed(2)} / {(p.bmep / 1e5).toFixed(2)}</td>
                  <td>{p.torque.toFixed(1)}</td>
                  <td>{(p.power / HP).toFixed(1)}</td>
                  <td>{(p.peakTemperature - 273.15).toFixed(0)}</td>
                  <td style={{ color: riskColor(p.knockRisk, 0.7, 0.95) }}>
                    {(p.knockRisk * 100).toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid2">
        <Card title={`1. ${t('anInCylinder', lang)}`}>
          <Analysis lines={inCylinderNotes(sweep, peak, lang)} />
        </Card>
        <Card title={`2. ${t('anMechanical', lang)}`}>
          <Analysis lines={mechanicalNotes(sweep, peak, lang)} />
        </Card>
        <Card title={`3. ${t('anAirFuel', lang)}`}>
          <Analysis lines={airFuelNotes(sweep, peak, lang)} />
        </Card>
        <Card title={`4. ${t('anThermal', lang)}`}>
          <WarningList warnings={collectWarnings(pts)} lang={lang} />
        </Card>
      </div>
    </>
  );
}

function Analysis({ lines }: { lines: string[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65 }}>
      {lines.map((l, i) => <li key={i} dangerouslySetInnerHTML={{ __html: l }} />)}
    </ul>
  );
}

function fmepHP(fmep: number, pt: OperatingPoint, sweep: SweepResult): string {
  const power = (fmep * sweep.statics.totalDisplacement * pt.rpm) / (2 * 60);
  return (power / HP).toFixed(1);
}

/** Tum devirlerdeki uyarilari benzersizlestirerek toplar */
function collectWarnings(pts: OperatingPoint[]) {
  const seen = new Map<string, OperatingPoint['warnings'][number]>();
  for (const p of pts) {
    for (const w of p.warnings) {
      const key = w.key + w.severity;
      if (!seen.has(key)) seen.set(key, w);
    }
  }
  return [...seen.values()];
}

// ============================================================
// DEGERLENDIRME METINLERI
// ============================================================

function inCylinderNotes(sweep: SweepResult, peak: OperatingPoint, lang: Lang): string[] {
  const L = lang === 'tr';
  const pts = sweep.points;
  const avgPPA = pts.reduce((s, p) => s + p.peakPressureAngle, 0) / pts.length;
  const maxP = Math.max(...pts.map((p) => p.peakPressure)) / 1e5;
  const maxT = Math.max(...pts.map((p) => p.peakTemperature));
  const bestEff = Math.max(...pts.map((p) => p.thermalEfficiency)) * 100;

  const ppaVerdict = avgPPA >= 12 && avgPPA <= 17
    ? (L ? 'ideal aralıkta (12-16°)' : 'in the ideal band (12-16°)')
    : avgPPA < 12
      ? (L ? 'ideal aralığın altında — yanma erken tamamlanıyor, sıkıştırmaya karşı iş yapılıyor'
           : 'below ideal — combustion completes early, working against compression')
      : (L ? 'ideal aralığın üstünde — genişleme işinin bir kısmı kaçırılıyor'
           : 'above ideal — some expansion work is being lost');

  return [
    L ? `Ortalama tepe basınç açısı <b>${avgPPA.toFixed(1)}° ATDC</b> — ${ppaVerdict}.`
      : `Mean peak-pressure angle <b>${avgPPA.toFixed(1)}° ATDC</b> — ${ppaVerdict}.`,
    L ? `En yüksek silindir basıncı <b>${maxP.toFixed(0)} bar</b>, en yüksek gaz sıcaklığı <b>${(maxT - 273.15).toFixed(0)}°C</b>.`
      : `Peak cylinder pressure <b>${maxP.toFixed(0)} bar</b>, peak gas temperature <b>${(maxT - 273.15).toFixed(0)}°C</b>.`,
    L ? `Türbülanslı alev hızı tepe güçte <b>${peak.flameSpeed.toFixed(1)} m/s</b>; yanma süresi <b>${peak.burnDuration.toFixed(0)}°</b> krank, ateşleme gecikmesi <b>${peak.ignitionDelay.toFixed(0)}°</b>.`
      : `Turbulent flame speed at peak power <b>${peak.flameSpeed.toFixed(1)} m/s</b>; burn duration <b>${peak.burnDuration.toFixed(0)}°</b> crank, ignition delay <b>${peak.ignitionDelay.toFixed(0)}°</b>.`,
    L ? `En iyi termal verim <b>%${bestEff.toFixed(1)}</b>. Artık gaz oranı tepe güçte <b>%${(peak.residualFraction * 100).toFixed(1)}</b> — alev hızını doğrudan etkiler.`
      : `Best thermal efficiency <b>${bestEff.toFixed(1)}%</b>. Residual gas fraction at peak power <b>${(peak.residualFraction * 100).toFixed(1)}%</b>, which directly affects flame speed.`,
  ];
}

function mechanicalNotes(sweep: SweepResult, peak: OperatingPoint, lang: Lang): string[] {
  const L = lang === 'tr';
  const st = sweep.statics;
  const bearingMPa = peak.peakBearingLoad / (0.28 * sweep.engine.mechanical.rodBearingDia ** 2) / 1e6;
  const dominant = Object.entries({
    [L ? 'segman' : 'rings']: peak.friction.ringTension + peak.friction.ringGasLoaded,
    [L ? 'etek' : 'skirt']: peak.friction.pistonSkirt,
    [L ? 'yataklar' : 'bearings']: peak.friction.bearings,
    [L ? 'supap mekanizması' : 'valvetrain']: peak.friction.valvetrain,
    [L ? 'aksesuarlar' : 'accessories']:
      peak.friction.oilPump + peak.friction.waterPump + peak.friction.alternator,
    [L ? 'yağ çalkalama' : 'windage']: peak.friction.windage,
  }).sort((a, b) => b[1] - a[1])[0];

  return [
    L ? `Tepe güçte ortalama piston hızı <b>${peak.meanPistonSpeed.toFixed(1)} m/s</b>, tepe piston hızı <b>${peak.peakPistonSpeed.toFixed(1)} m/s</b>. Biyel/strok oranı ${st.rodStrokeRatio.toFixed(2)}.`
      : `At peak power, mean piston speed <b>${peak.meanPistonSpeed.toFixed(1)} m/s</b>, peak piston speed <b>${peak.peakPistonSpeed.toFixed(1)} m/s</b>. Rod/stroke ratio ${st.rodStrokeRatio.toFixed(2)}.`,
    L ? `Maksimum biyel yatağı yükü <b>${(peak.peakBearingLoad / 1000).toFixed(1)} kN</b> (~${bearingMPa.toFixed(0)} MPa projeksiyon basıncı). Trimetal yataklar tipik olarak 55-70 MPa'ya dayanır.`
      : `Maximum rod bearing load <b>${(peak.peakBearingLoad / 1000).toFixed(1)} kN</b> (~${bearingMPa.toFixed(0)} MPa projected pressure). Trimetal bearings typically tolerate 55-70 MPa.`,
    L ? `Etek yan kuvveti tepe <b>${(peak.peakSideForce / 1000).toFixed(2)} kN</b>. Bu kuvvet etek aşınmasını ve sürtünme kaybını belirler; biyel oranı büyüdükçe azalır.`
      : `Peak skirt side force <b>${(peak.peakSideForce / 1000).toFixed(2)} kN</b>. This drives skirt wear and friction loss, and falls as rod ratio increases.`,
    L ? `Sürtünmenin en büyük payı <b>${dominant[0]}</b> (${(dominant[1] / 1e5).toFixed(2)} bar FMEP). Toplam FMEP ${(peak.fmep / 1e5).toFixed(2)} bar, mekanik verim <b>%${(peak.mechanicalEfficiency * 100).toFixed(1)}</b>.`
      : `Largest friction contributor is <b>${dominant[0]}</b> (${(dominant[1] / 1e5).toFixed(2)} bar FMEP). Total FMEP ${(peak.fmep / 1e5).toFixed(2)} bar, mechanical efficiency <b>${(peak.mechanicalEfficiency * 100).toFixed(1)}%</b>.`,
  ];
}

function airFuelNotes(sweep: SweepResult, peak: OperatingPoint, lang: Lang): string[] {
  const L = lang === 'tr';
  const pts = sweep.points;
  const bestVE = pts.reduce((a, b) => (b.volumetricEfficiency > a.volumetricEfficiency ? b : a));
  const maxDuty = Math.max(...pts.map((p) => p.injectorDutyCycle));
  const cfg = sweep.engine;

  const dutyVerdict = maxDuty > 0.9
    ? (L ? 'yetersiz — daha büyük enjektör gerekir' : 'insufficient — larger injectors required')
    : maxDuty > 0.8
      ? (L ? 'sınıra yakın' : 'close to the limit')
      : (L ? 'yeterli' : 'adequate');

  return [
    L ? `En yüksek hacimsel verim <b>%${(bestVE.volumetricEfficiency * 100).toFixed(1)}</b> @ ${bestVE.rpm} rpm. Emme sistemi Helmholtz ayar devri <b>~${peak.intakeTunedRpm.toFixed(0)} rpm</b> — runner uzunluğunu değiştirmek bu tepeyi kaydırır.`
      : `Best volumetric efficiency <b>${(bestVE.volumetricEfficiency * 100).toFixed(1)}%</b> @ ${bestVE.rpm} rpm. Intake Helmholtz tuned speed <b>~${peak.intakeTunedRpm.toFixed(0)} rpm</b> — changing runner length shifts this peak.`,
    L ? `Süpürme (taze dolgu) verimi tepe güçte <b>%${(peak.scavengingEfficiency * 100).toFixed(1)}</b>. Egzoz karşı basıncı <b>${(peak.exhaustBackpressure / 1e5).toFixed(2)} bar</b> — bu basınç arttıkça artık gaz oranı yükselir.`
      : `Trapping (fresh charge) efficiency at peak power <b>${(peak.scavengingEfficiency * 100).toFixed(1)}%</b>. Exhaust backpressure <b>${(peak.exhaustBackpressure / 1e5).toFixed(2)} bar</b> — higher backpressure raises residual fraction.`,
    L ? `Maksimum enjektör doluluğu <b>%${(maxDuty * 100).toFixed(0)}</b> (${cfg.fuelSystem.injectorFlowCC} cc/dk) — ${dutyVerdict}. Darbe genişliği tepe güçte ${(peak.injectorPulseWidth * 1000).toFixed(2)} ms.`
      : `Maximum injector duty <b>${(maxDuty * 100).toFixed(0)}%</b> (${cfg.fuelSystem.injectorFlowCC} cc/min) — ${dutyVerdict}. Pulse width at peak power ${(peak.injectorPulseWidth * 1000).toFixed(2)} ms.`,
    L ? `Hava debisi tepe güçte <b>${(peak.massAirFlow * 1000).toFixed(0)} g/s</b>, yakıt debisi <b>${(peak.fuelFlow * 3600).toFixed(1)} kg/h</b>, lambda ${peak.lambda.toFixed(2)} (AFR ${peak.afr.toFixed(1)}).`
      : `Airflow at peak power <b>${(peak.massAirFlow * 1000).toFixed(0)} g/s</b>, fuel flow <b>${(peak.fuelFlow * 3600).toFixed(1)} kg/h</b>, lambda ${peak.lambda.toFixed(2)} (AFR ${peak.afr.toFixed(1)}).`,
  ];
}

// ============================================================
// MARKDOWN CIKTISI
// ============================================================

function buildMarkdown(sweep: SweepResult, pts: OperatingPoint[], lang: Lang): string {
  const L = lang === 'tr';
  const cfg = sweep.engine;
  const st = sweep.statics;
  const peak = pts[pts.length - 1];
  const strip = (s: string) => s.replace(/<\/?b>/g, '**');

  const out: string[] = [];
  out.push(`# ${cfg.name} — ${L ? 'Motor Analiz Raporu' : 'Engine Analysis Report'}`);
  out.push('');
  out.push(`## ${t('reportPart1', lang)}`);
  out.push('');
  out.push(`| ${L ? 'Özellik' : 'Property'} | ${L ? 'Değer' : 'Value'} |`);
  out.push('|---|---|');
  const row = (k: string, v: string) => out.push(`| ${k} | ${v} |`);
  row(t('layout', lang), cfg.layout);
  row(t('bore', lang) + ' × ' + t('stroke', lang),
    `${(cfg.geometry.bore * 1000).toFixed(1)} × ${(cfg.geometry.stroke * 1000).toFixed(1)} mm`);
  row(t('displacement', lang), `${(st.totalDisplacement * 1e6).toFixed(0)} cc (${(st.totalDisplacement * 1000).toFixed(2)} L)`);
  row(t('rodStroke', lang), st.rodStrokeRatio.toFixed(3));
  row(t('compressionRatio', lang), `${cfg.geometry.compressionRatio.toFixed(2)}:1`);
  row(t('dcr', lang), `${st.dynamicCR.toFixed(2)}:1`);
  row(t('ivcAngle', lang), `${st.ivcAngle.toFixed(0)}° ABDC`);
  row(t('valveOverlapLbl', lang), `${valveOverlap(cfg.valvetrain).toFixed(0)}°`);
  row(t('lsa', lang), `${computedLSA(cfg.valvetrain).toFixed(0)}°`);
  row(`${t('meanPistonSpeed', lang)} @ ${cfg.redline} rpm`,
    `${((2 * cfg.geometry.stroke * cfg.redline) / 60).toFixed(1)} m/s`);
  row(t('valveFloatRpm', lang), Number.isFinite(st.valveFloatRpm) ? `${st.valveFloatRpm.toFixed(0)} rpm` : '—');
  row(t('recommendedRedline', lang), `${st.recommendedRedline.toFixed(0)} rpm`);
  row(t('parasiticLoss', lang), `${(peak.frictionPower / HP).toFixed(1)} HP @ ${peak.rpm} rpm`);
  row(t('peakPower', lang), `${(sweep.peakPower.value / HP).toFixed(0)} HP @ ${sweep.peakPower.rpm} rpm`);
  row(t('peakTorque', lang), `${sweep.peakTorque.value.toFixed(0)} N·m @ ${sweep.peakTorque.rpm} rpm`);
  out.push('');

  out.push(`## ${t('reportPart2', lang)}`);
  out.push('');
  out.push('| RPM | MAP (bar) | Airflow (g/s) | VE (%) | Spark (°BTDC) | IMEP/BMEP (bar) | Torque (N·m) | Power (HP) | Cyl Temp (°C) | Knock (%) |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const p of pts) {
    out.push(`| ${p.rpm} | ${(p.map / 1e5).toFixed(2)} | ${(p.massAirFlow * 1000).toFixed(1)} | ` +
      `${(p.volumetricEfficiency * 100).toFixed(1)} | ${p.sparkAdvance.toFixed(1)} | ` +
      `${(p.imep / 1e5).toFixed(2)} / ${(p.bmep / 1e5).toFixed(2)} | ${p.torque.toFixed(1)} | ` +
      `${(p.power / HP).toFixed(1)} | ${(p.peakTemperature - 273.15).toFixed(0)} | ` +
      `${(p.knockRisk * 100).toFixed(0)} |`);
  }
  out.push('');

  out.push(`## ${t('analysisBreakdown', lang)}`);
  out.push('');
  const sections: [string, string[]][] = [
    [`1. ${t('anInCylinder', lang)}`, inCylinderNotes(sweep, peak, lang)],
    [`2. ${t('anMechanical', lang)}`, mechanicalNotes(sweep, peak, lang)],
    [`3. ${t('anAirFuel', lang)}`, airFuelNotes(sweep, peak, lang)],
  ];
  for (const [title, lines] of sections) {
    out.push(`### ${title}`);
    for (const l of lines) out.push(`- ${strip(l)}`);
    out.push('');
  }

  out.push(`### 4. ${t('anThermal', lang)}`);
  const warns = collectWarnings(sweep.points);
  if (warns.length === 0) out.push(`- ${t('noWarnings', lang)}`);
  for (const w of warns) {
    const icon = w.severity === 'danger' ? '⛔' : w.severity === 'caution' ? '⚠️' : 'ℹ️';
    out.push(`- ${icon} ${t(warningKey(w.key), lang, w.params)}`);
  }
  out.push('');
  out.push('---');
  out.push(L
    ? '*Krank-açısı çözünürlüklü 0D simülasyondan üretilmiştir. NASA polinom termodinamiği, ' +
      'Wiebe yanma, Woschni ısı transferi, Douaud-Eyzat vuruntu modeli.*'
    : '*Generated from a crank-angle resolved 0D simulation. NASA polynomial thermodynamics, ' +
      'Wiebe combustion, Woschni heat transfer, Douaud-Eyzat knock model.*');
  return out.join('\n');
}
