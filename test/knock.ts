/**
 * Vurunti modeli — davranis ve kalibrasyon testleri.
 *
 * NEDEN BU TEST VAR:
 * Model daha once fabrika ayarindaki 12 motorun 12'sinde de "vuruntu
 * tehlikesi" uyarisi veriyordu. Iki ayri sebep vardi ve ikisi de burada
 * kilitleniyor:
 *
 *   1. RAPORLAMA: knockRisk = integral/esik idi, cozucu de avansi ikili
 *      aramayla TAM esige oturtuyordu — yani dogru sekilde rotarlanmis
 *      saglikli bir motor tanimi geregi 1.00 gosteriyordu.
 *   2. FIZIK: tam yuk zenginlestirmesi cevrime hic ulasmiyordu ve
 *      kompresor adasi motorun calisma cizgisiyle uyusmadigi icin
 *      verim %28'e cakilip emme havasini 85 °C'ye isitiyordu.
 *
 * Ayrica modelin YONLERI dogru vermesi gerekir: dusuk oktan vuruntuyu
 * artirmali, zengin karisim azaltmali, iyi intercooler azaltmali.
 * Mutlak deger kalibrasyona bagli olsa da bu yonler fizigin kendisidir.
 */
import { getPreset, PRESET_LIST } from '../src/core/presets';
import { runSweep } from '../src/core/sweep';
import { solveOperatingPoint } from '../src/core/cycle';
import { autoignitionDelay, DEFAULT_KNOCK_CAL } from '../src/core/combustion';
import { commandedLambda } from '../src/core/fuel';
import type { EngineConfig } from '../src/core/types';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// ============================================================
console.log('=== STOK MOTORLAR FABRIKA AYARINDA UYARI VERMEMELI ===');
// ============================================================
{
  const peaks: { name: string; peak: number; retard: number }[] = [];
  for (const info of PRESET_LIST) {
    const cfg = getPreset(info.id);
    let peak = 0, retard = 0;
    for (const p of runSweep(cfg).points) {
      peak = Math.max(peak, p.knockRisk);
      retard = Math.max(retard, p.knockRetard);
    }
    peaks.push({ name: info.name, peak, retard });
  }

  for (const e of peaks) {
    ok(`${e.name} — uyari yok`, e.peak <= 0.95,
      `tepe risk ${e.peak.toFixed(2)} (rotar ${e.retard.toFixed(1)}°)`);
  }

  // Risk tavana yapismamali: yapisiyorsa cozucu vuruntuyu kontrol
  // edemiyor demektir ve deger anlamini yitirir.
  const pinned = peaks.filter((e) => e.peak >= 1.49);
  ok('Hicbir motorda risk tavana yapismiyor', pinned.length === 0,
    pinned.map((e) => e.name).join(', '));
}

// ============================================================
console.log('\n=== SAGLIKLI MOTOR "SINIRDA" GOSTERILMEMELI ===');
// ============================================================
{
  // Onceki hatanin ozu: sinirlanmis her motor tam 1.00 gosteriyordu.
  // Artik 0.50 "kalibrasyon sinirinda calisiyor" demek ve normaldir.
  const cfg = getPreset('ls3');
  const pts = runSweep(cfg).points;
  const limited = pts.filter((p) => p.knockRetard > 0.05);
  ok('LS3 bazi noktalarda gercekten sinirlaniyor', limited.length > 0,
    `${limited.length} nokta`);
  const allExactlyOne = limited.every((p) => Math.abs(p.knockRisk - 1) < 0.01);
  ok('Sinirlanan noktalar 1.00 degerine yapismiyor', !allExactlyOne);
  ok('Sinirlanan noktalarin riski makul', limited.every((p) => p.knockRisk < 0.95),
    `en yuksek ${Math.max(...limited.map((p) => p.knockRisk)).toFixed(2)}`);
}

// ============================================================
console.log('\n=== YONLER: NE VURUNTUYU ARTIRIR, NE AZALTIR ===');
// ============================================================
/** Bir motoru degistirip 2500 rpm'deki vurunti bagimliligini olcer */
function knockAt(mut: (c: EngineConfig) => void, id = '2jz-gte', rpm = 2500) {
  const cfg = getPreset(id);
  mut(cfg);
  const p = solveOperatingPoint(cfg, rpm);
  // Rotar + basinc kesme birlikte "vuruntuyu bastirmak icin odenen bedel"
  return { cost: p.knockRetard + p.knockBoostCut * 30, p };
}

{
  const base = knockAt(() => {});

  // Dusuk oktan → daha fazla vurunti
  const lowOctane = knockAt((c) => { c.fuel.ron = 87; });
  ok('Düşük oktan vuruntuyu artırır', lowOctane.cost > base.cost + 0.5,
    `95 RON: ${base.cost.toFixed(1)} → 87 RON: ${lowOctane.cost.toFixed(1)}`);

  // Yuksek oktan → daha az
  const highOctane = knockAt((c) => { c.fuel.ron = 110; });
  ok('Yüksek oktan vuruntuyu azaltır', highOctane.cost < base.cost - 0.5,
    `${base.cost.toFixed(1)} → ${highOctane.cost.toFixed(1)}`);

  // Daha fazla basinc → daha fazla vurunti
  const moreBoost = knockAt((c) => {
    c.induction.targetBoost *= 1.6;
    c.induction.boostLimit = c.ambient.pressure + (c.induction.boostLimit - c.ambient.pressure) * 1.6;
  });
  ok('Yüksek basınç vuruntuyu artırır', moreBoost.cost > base.cost + 0.5,
    `${base.cost.toFixed(1)} → ${moreBoost.cost.toFixed(1)}`);

  // Zengin karisim → daha az vurunti (dolgu sogutmasi + kimyasal direnc)
  const richer = knockAt((c) => {
    c.fuelSystem.targetLambdaWOT = 0.72;
    c.fuelSystem.targetLambda = 0.78;
  });
  ok('Zengin karışım vuruntuyu azaltır', richer.cost < base.cost - 0.3,
    `λ0.82: ${base.cost.toFixed(1)} → λ0.72: ${richer.cost.toFixed(1)}`);

  // Fakir karisim → daha fazla
  const leaner = knockAt((c) => {
    c.fuelSystem.targetLambdaWOT = 1.0;
    c.fuelSystem.targetLambda = 1.0;
  });
  ok('Fakir karışım vuruntuyu artırır', leaner.cost > base.cost + 0.3,
    `${base.cost.toFixed(1)} → ${leaner.cost.toFixed(1)}`);

  // Iyi intercooler → daha az vurunti
  const goodIC = knockAt((c) => { c.induction.intercoolerEfficiency = 0.92; });
  const badIC = knockAt((c) => { c.induction.intercoolerEfficiency = 0.35; });
  ok('İyi intercooler vuruntuyu azaltır', goodIC.cost < badIC.cost - 0.5,
    `%92: ${goodIC.cost.toFixed(1)} < %35: ${badIC.cost.toFixed(1)}`);

  // Yuksek sikistirma orani → daha fazla
  const highCR = knockAt((c) => { c.geometry.compressionRatio = 11.5; });
  ok('Yüksek sıkıştırma oranı vuruntuyu artırır', highCR.cost > base.cost + 0.5,
    `8.5:1 → 11.5:1  ${base.cost.toFixed(1)} → ${highCR.cost.toFixed(1)}`);

  // Sicak emme havasi → daha fazla
  const hotAir = knockAt((c) => { c.ambient.temperature = 318.15; });
  ok('Sıcak ortam havası vuruntuyu artırır', hotAir.cost > base.cost + 0.2,
    `20°C: ${base.cost.toFixed(1)} → 45°C: ${hotAir.cost.toFixed(1)}`);
}

// ============================================================
console.log('\n=== TELAFI EDICI SISTEMLER ===');
// ============================================================
{
  // Rotar yetkisi tukendiginde ECU basinci kesmeli.
  // Cok dusuk oktan + yuksek basinc = rotarla cozulemez.
  const cfg = getPreset('2jz-gte');
  cfg.fuel.ron = 80;
  cfg.induction.targetBoost *= 1.8;
  cfg.induction.boostLimit = cfg.ambient.pressure +
    (cfg.induction.boostLimit - cfg.ambient.pressure) * 1.8;
  const p = solveOperatingPoint(cfg, 3000);
  ok('Kontrol edilemeyen vuruntuda basınç kesilir', p.knockBoostCut > 0.05,
    `kesilen ${p.knockBoostCut.toFixed(2)} bar, rotar ${p.knockRetard.toFixed(1)}°`);
  ok('Basınç kesince vuruntu kontrol altına alınır', p.knockRisk <= 1.2,
    `risk ${p.knockRisk.toFixed(2)}`);

  // Atmosferik motorda basinc kesme diye bir sey yok
  const na = solveOperatingPoint(getPreset('k20a'), 3000);
  ok('Atmosferik motorda basınç kesme olmaz', na.knockBoostCut === 0);
}

// ============================================================
console.log('\n=== AVANS FIZIKSEL TABANI ===');
// ============================================================
{
  // Avans hicbir kosulda TDC sonrasina gecmemeli. Onceki kodda son
  // duzeltme dongusu tabani tanimadigi icin −3.8°'ye kadar iniyordu.
  const cfg = getPreset('b58');
  cfg.fuel.ron = 80;      // vuruntuyu zorla
  let minSpark = 999;
  for (const p of runSweep(cfg).points) minSpark = Math.min(minSpark, p.sparkAdvance);
  ok('Avans TDC sonrasına geçmiyor', minSpark >= 0.99,
    `en dusuk avans ${minSpark.toFixed(1)}°`);
}

// ============================================================
console.log('\n=== KALIBRASYON CARPANLARI ETKI EDIYOR MU ===');
// ============================================================
{
  const T = 850, P = 3e6;
  const base = autoignitionDelay(95, P, T, 1.0, DEFAULT_KNOCK_CAL);

  const hotter = autoignitionDelay(95, P, T + 60, 1.0, DEFAULT_KNOCK_CAL);
  ok('Sıcaklık artınca tutuşma gecikmesi kısalır', hotter < base,
    `${(base * 1e3).toFixed(2)} ms → ${(hotter * 1e3).toFixed(2)} ms`);

  const tempSens = autoignitionDelay(95, P, T, 1.0, { ...DEFAULT_KNOCK_CAL, tempFactor: 1.2 });
  ok('Sıcaklık faktörü etki ediyor', Math.abs(tempSens - base) / base > 0.05);

  const boostSens = autoignitionDelay(95, P, T, 1.0, { ...DEFAULT_KNOCK_CAL, boostFactor: 1.4 });
  ok('Basınç faktörü etki ediyor', Math.abs(boostSens - base) / base > 0.05);

  const richBase = autoignitionDelay(95, P, T, 0.80, DEFAULT_KNOCK_CAL);
  ok('Zengin karışım gecikmeyi uzatır', richBase > base,
    `λ1.00: ${(base * 1e3).toFixed(2)} ms → λ0.80: ${(richBase * 1e3).toFixed(2)} ms`);

  const noLambda = autoignitionDelay(95, P, T, 0.80, { ...DEFAULT_KNOCK_CAL, lambdaFactor: 0 });
  ok('Karışım faktörü 0 olunca lambda etkisi kalkar',
    Math.abs(noLambda - base) / base < 1e-9);

  const strongerLambda = autoignitionDelay(95, P, T, 0.80, { ...DEFAULT_KNOCK_CAL, lambdaFactor: 2 });
  ok('Karışım faktörü büyütülünce bastırma artar', strongerLambda > richBase);
}

// ============================================================
console.log('\n=== YUKE BAGLI ZENGINLESTIRME ===');
// ============================================================
{
  const amb = 101325;
  const partLoad = commandedLambda(0.92, 0.85, amb * 0.45, amb);
  const wot = commandedLambda(0.92, 0.85, amb * 0.99, amb);
  ok('Kısmi yükte zenginleştirme yok', Math.abs(partLoad - 0.92) < 1e-6,
    `λ ${partLoad.toFixed(3)}`);
  ok('Tam yükte WOT hedefine iner', Math.abs(wot - 0.85) < 0.01,
    `λ ${wot.toFixed(3)}`);

  const boosted = commandedLambda(0.92, 0.85, amb * 2.0, amb, 0.055);
  ok('Basınçta daha da zenginleşir', boosted < wot - 0.02,
    `λ ${wot.toFixed(3)} → ${boosted.toFixed(3)}`);

  // Gecis dogrusal OLMAMALI.
  //
  // Olcumu ceyrek noktada yapmak SART: smoothstep simetriktir ve tam
  // ortada (t = 0.5) dogrusalla zaten CAKISIR — orada olcmek her zaman
  // "dogrusal" sonucu verir, testi degersiz kilar.
  const LO = 0.72, HI = 0.98;
  const load = LO + 0.25 * (HI - LO);
  const t = (load - LO) / (HI - LO);            // = 0.25
  const quarter = commandedLambda(0.92, 0.85, amb * load, amb);
  const linear = 0.92 + (0.85 - 0.92) * t;
  ok('Geçiş doğrusal değil', Math.abs(quarter - linear) > 0.002,
    `smoothstep ${quarter.toFixed(4)} vs dogrusal ${linear.toFixed(4)}`);
  // Baslangicta smoothstep dogrusaldan DAHA YAVAS zenginlesmeli
  ok('Geçiş başta yumuşak', quarter > linear,
    `${quarter.toFixed(4)} > ${linear.toFixed(4)}`);

  // Yanabilirlik sinirinin altina inmemeli
  const extreme = commandedLambda(0.75, 0.70, amb * 4, amb, 0.2);
  ok('Yanabilirlik sınırının altına inmez', extreme >= 0.65,
    `λ ${extreme.toFixed(3)}`);
}

// ============================================================
console.log('\n=== SON GAZ SICAKLIGI ===');
// ============================================================
{
  const p = solveOperatingPoint(getPreset('ls3'), 3000);
  ok('Son gaz sıcaklığı raporlanıyor', p.endGasTemp > 400 && p.endGasTemp < 1600,
    `${(p.endGasTemp - 273.15).toFixed(0)} °C`);
  // Son gaz, kutle-ortalamali tepe sicakligindan DUSUK olmalidir:
  // yanmamis bolge alev tarafindan isitilmaz, yalnizca sikistirilir.
  ok('Son gaz sıcaklığı yanmış gazdan düşük', p.endGasTemp < p.peakTemperature,
    `son gaz ${p.endGasTemp.toFixed(0)} K < tepe ${p.peakTemperature.toFixed(0)} K`);
}

console.log(`\n${pass} gecti, ${fail} kaldi`);
process.exit(fail ? 1 : 0);
