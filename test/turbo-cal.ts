/**
 * Kompresor debi kapasitesi katsayisinin kalibrasyonu.
 *
 * NE OLCULUYOR:
 * Sabit geometrili bir turbo hedef basinci her devirde saglayamaz.
 * Devir yukseldikce motorun cektigi debi artar; kompresor tikanma
 * hattina dayandiginda basinc duser. Bu yuzden stok turbo motorlarin
 * gucu KIRMIZI CIZGIDE degil, ondan once tepe yapar ve iner.
 *
 * compressorMaxFlow = estPeakFlow × k
 *
 * k kucuk  → turbo erken tukenir, tepe guc devri asagi kayar
 * k buyuk  → turbo hic tukenmez, guc kesiciye kadar tirmanir (YANLIS)
 *
 * k'yi tahmin etmek yerine, FABRIKA TEPE GUC DEVIRLERINE karsi
 * olcuyoruz. Bu degerler ureticinin yayimladigi verilerdir.
 *
 * Calistir:  npx tsx test/turbo-cal.ts
 */
import { getPreset } from '../src/core/presets';
import { runSweep } from '../src/core/sweep';

/** Fabrika tepe guc devri (rpm) — ureticinin yayimladigi deger */
const FACTORY_PEAK_RPM: Record<string, { rpm: number; hp: number; note: string }> = {
  '2jz-gte': { rpm: 5600, hp: 320, note: 'Supra Turbo (ihracat)' },
  'ej257':   { rpm: 6000, hp: 305, note: 'Impreza STI' },
  'rb26dett': { rpm: 6800, hp: 276, note: 'Skyline GT-R (fabrika beyani)' },
  'b58':     { rpm: 6500, hp: 340, note: '5000-6500 platosunun SONU' },
  'barra':   { rpm: 5250, hp: 436, note: 'F6 Typhoon' },
  'ea888':   { rpm: 6200, hp: 220, note: '4500-6200 platosunun SONU' },
};

const IDS = Object.keys(FACTORY_PEAK_RPM);

/** Bir k degeri icin tum motorlarin tepe guc devrini olcer */
function evaluate(k: number, falloff: number) {
  const rows: { id: string; peakRpm: number; peakHp: number; target: number; err: number }[] = [];
  for (const id of IDS) {
    const cfg = getPreset(id);
    // estPeakFlow'u geri hesapla: preset onu 0.78 ile carpmisti
    const baseFlow = cfg.induction.compressorMaxFlow / 0.78;
    cfg.induction.compressorMaxFlow = baseFlow * k;
    cfg.induction.compressorFalloff = falloff;

    // Kaba adim — tepe noktasinin YERI aranıyor, mutlak deger degil
    const list: number[] = [];
    for (let r = 3000; r <= cfg.redline; r += 250) list.push(r);
    const res = runSweep(cfg, list);
    const peakRpm = res.peakPower.rpm;
    const peakHp = res.peakPower.value / 745.7;
    const t = FACTORY_PEAK_RPM[id];
    rows.push({ id, peakRpm, peakHp, target: t.rpm, err: (peakRpm - t.rpm) / t.rpm });
  }
  const rms = Math.sqrt(rows.reduce((s, r) => s + r.err * r.err, 0) / rows.length);
  return { rows, rms };
}

console.log('=== KOMPRESOR DEBI KAPASITESI KALIBRASYONU ===\n');
console.log('Tepe guc devri fabrika degerine ne kadar yakin?\n');

const kList = [0.74, 0.82, 0.90];
const fList = [1.9, 3.5, 5.5];
let best = { k: 0, f: 0, rms: Infinity };

console.log('   k    dusus   RMS hata   motor basina tepe devri');
for (const k of kList) {
  for (const f of fList) {
    const { rows, rms } = evaluate(k, f);
    const detail = rows.map((r) => `${r.id}:${r.peakRpm}`).join(' ');
    console.log(`  ${k.toFixed(2)}   ${f.toFixed(1)}   %${(rms * 100).toFixed(1).padStart(5)}    ${detail}`);
    if (rms < best.rms) best = { k, f, rms };
  }
}

console.log(`\nEN IYI  k = ${best.k}  dusus = ${best.f}  (RMS %${(best.rms * 100).toFixed(1)})\n`);

console.log('=== EN IYI DEGERLE AYRINTI ===');
const { rows } = evaluate(best.k, best.f);
console.log('motor        model tepe    fabrika    sapma     model HP  fabrika HP');
for (const r of rows) {
  const t = FACTORY_PEAK_RPM[r.id];
  console.log(
    r.id.padEnd(12) +
    `${String(r.peakRpm).padStart(5)} rpm  ${String(t.rpm).padStart(5)} rpm  ` +
    `${(r.err >= 0 ? '+' : '')}${(r.err * 100).toFixed(0).padStart(4)}%   ` +
    `${r.peakHp.toFixed(0).padStart(6)} HP  ${String(t.hp).padStart(6)} HP   ${t.note}`,
  );
}
