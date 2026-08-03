/**
 * Vurunti denetimi — stok motorlar fabrika ayarinda ne gosteriyor?
 *
 * Tani amaclidir, gecti/kaldi uretmez. Amac: her hazir motorun devir
 * boyunca bildirdigi vurunti riskini, uygulanan avans rotarini ve MBT'den
 * ne kadar uzakta calistigini yan yana gormek.
 */
import { getPreset, PRESET_LIST } from '../src/core/presets';
import { runSweep } from '../src/core/sweep';

const PRESET_IDS = PRESET_LIST.map((p) => p.id);

const bar = (v: number) => {
  const n = Math.round(Math.max(0, Math.min(v, 1.2)) * 20);
  return '#'.repeat(n).padEnd(24, '.');
};

console.log('=== STOK MOTORLAR — FABRIKA AYARINDA VURUNTU ===\n');
console.log('risk = knockIntegral / knockThreshold   (1.0 = tam sinirda)\n');

let worstOverall = 0;
const summary: { id: string; peak: number; retardMax: number; limited: number; total: number }[] = [];

for (const id of PRESET_IDS) {
  const cfg = getPreset(id);
  const pts = runSweep(cfg).points;
  let peak = 0, retardMax = 0, limited = 0;
  console.log(`--- ${cfg.name}  (${cfg.fuel.octaneRON} RON, CR ${cfg.geometry.compressionRatio}) ---`);
  for (const p of pts) {
    peak = Math.max(peak, p.knockRisk);
    retardMax = Math.max(retardMax, p.knockRetard);
    if (p.knockRetard > 0.05) limited++;
    const flag = p.knockRisk > 0.95 ? ' <-- UYARI' : p.knockRisk > 0.7 ? ' <-- dikkat' : '';
    console.log(
      `  ${String(p.rpm).padStart(5)} rpm  risk ${p.knockRisk.toFixed(2).padStart(5)}  ` +
      `${bar(p.knockRisk)}  avans ${p.sparkAdvance.toFixed(1).padStart(5)}° ` +
      `(MBT ${p.mbtAdvance.toFixed(1)}°, rotar ${p.knockRetard.toFixed(1)}°)${flag}`,
    );
  }
  worstOverall = Math.max(worstOverall, peak);
  summary.push({ id: cfg.name, peak, retardMax, limited, total: pts.length });
  console.log('');
}

console.log('=== OZET ===');
console.log('motor'.padEnd(34) + 'tepe risk   max rotar   sinirlanan nokta');
for (const s of summary) {
  const warn = s.peak > 0.95 ? '  <-- UYARI VERIYOR' : '';
  console.log(
    s.id.padEnd(34) +
    s.peak.toFixed(2).padStart(6) + '   ' +
    (s.retardMax.toFixed(1) + '°').padStart(8) + '   ' +
    `${s.limited}/${s.total}`.padStart(8) + warn,
  );
}
console.log(`\nEn yuksek risk: ${worstOverall.toFixed(2)}`);
const warnCount = summary.filter((s) => s.peak > 0.95).length;
console.log(`UYARI veren motor sayisi: ${warnCount}/${summary.length}`);
