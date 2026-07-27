/**
 * Vurunti modeli kalibrasyonu
 *
 * Douaud-Eyzat otomatik tutusma korelasyonu ham haliyle "mutlak" bir esik
 * vermez; her uygulamada olceklenmesi gerekir. Burada olcegi TAHMIN
 * ETMIYORUZ: bilinen motorlarin FABRIKA tam gaz avans degerlerinde
 * integralin ne cikitigina bakiyoruz.
 *
 * Mantik: bu motorlarin fabrika avansi zaten vurunti sinirinda belirlenmis
 * degerlerdir. Dolayisiyla integralin o noktalarda aldigi deger, "sinirda
 * vurunti" demektir ve esik olarak tam da o kullanilmalidir.
 *
 * Calistir: npx tsx test/knock-cal.ts
 */
import { integrateCycle, DEFAULT_OPTIONS } from '../src/core/cycle';
import { getPreset } from '../src/core/presets';
import { makeKinematics } from '../src/core/geometry';
import { solveOperatingPoint } from '../src/core/cycle';

// Fabrika tam gaz avansi (yaklasik, uretici haritalarindan)
const REFERENCE_POINTS: { id: string; rpm: number; realAdvance: number; note: string }[] = [
  { id: 'ls3', rpm: 3500, realAdvance: 25, note: '10.7:1 NA, 95 RON' },
  { id: 'ls3', rpm: 5500, realAdvance: 28, note: 'ust devir' },
  { id: 'k20a', rpm: 6000, realAdvance: 30, note: '11.5:1 NA yuksek devir' },
  { id: 'k20a', rpm: 3000, realAdvance: 26, note: 'orta devir' },
  { id: '2jz-gte', rpm: 4500, realAdvance: 16, note: 'tam boost, 98 RON' },
  { id: 'ej257', rpm: 4000, realAdvance: 14, note: 'turbo boxer' },
  { id: 'coyote', rpm: 5000, realAdvance: 27, note: '11.0:1 NA DOHC' },
  { id: 'viper-v10', rpm: 4000, realAdvance: 24, note: 'buyuk hacim OHV' },
];

console.log('Motor        RPM   Gercek  ModelMBT  Integral@gercek   Not');
console.log('-'.repeat(76));

const integrals: number[] = [];

for (const ref of REFERENCE_POINTS) {
  const cfg = getPreset(ref.id);
  const k = makeKinematics(cfg.geometry);

  // Once o noktayi normal cozup sinir kosullarini ve MBT'yi al
  const cfgNoKnock = structuredClone(cfg);
  cfgNoKnock.ignition.knockThreshold = 1e9; // vurunti sinirlamasini kapat
  const pt = solveOperatingPoint(cfgNoKnock, ref.rpm);

  // Gercek avansta cevrimi coz, vurunti integralini oku
  const cfgFixed = structuredClone(cfg);
  cfgFixed.ignition.autoMBT = false;
  cfgFixed.ignition.fixedAdvance = ref.realAdvance;
  cfgFixed.ignition.knockThreshold = 1e9;
  cfgFixed.ignition.maxRetard = 0;
  const ptFixed = solveOperatingPoint(cfgFixed, ref.rpm);

  integrals.push(ptFixed.knockRisk * 1e9);
  console.log(
    `${ref.id.padEnd(11)} ${String(ref.rpm).padStart(5)}  ${String(ref.realAdvance).padStart(5)}   ` +
    `${pt.mbtAdvance.toFixed(1).padStart(7)}   ${(ptFixed.knockRisk * 1e9).toFixed(2).padStart(13)}   ${ref.note}`,
  );
}

integrals.sort((a, b) => a - b);
const median = integrals[Math.floor(integrals.length / 2)];
const geo = Math.exp(integrals.reduce((s, v) => s + Math.log(Math.max(v, 1e-9)), 0) / integrals.length);
console.log('-'.repeat(76));
console.log(`Medyan integral : ${median.toFixed(2)}`);
console.log(`Geometrik ort.  : ${geo.toFixed(2)}`);
console.log(`En dusuk / yuksek: ${integrals[0].toFixed(2)} / ${integrals[integrals.length - 1].toFixed(2)}`);
console.log(`\n-> Onerilen KNOCK_SCALE = ${geo.toFixed(2)}  (integral bununla bolunecek)`);
