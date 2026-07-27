/** Yeni fizik etkilerinin YONUNU ve BUYUKLUGUNU dogrular */
import { solveOperatingPoint } from '../src/core/cycle';
import { getPreset } from '../src/core/presets';
import { LOCATIONS, applyLocation } from '../src/core/environment';
import { MANIFOLD_TYPES, MANIFOLDS } from '../src/core/turbo';
const HP = 745.7;
const O = { step: 1.0, maxIterations: 5, ignitionPasses: 1 };

function row(label: string, p: any, extra = '') {
  console.log(
    label.padEnd(26) +
    `${(p.power/HP).toFixed(0).padStart(4)} HP  ` +
    `VE ${(p.volumetricEfficiency*100).toFixed(0).padStart(3)}%  ` +
    `MAP ${(p.map/1e5).toFixed(2)}  ` +
    `IAT ${(p.iat-273.15).toFixed(0).padStart(3)}C  ` +
    `avans ${p.sparkAdvance.toFixed(1).padStart(4)}  ` +
    `knock ${(p.knockRisk*100).toFixed(0).padStart(3)}%  ` + extra
  );
}

console.log('=== RAKIM / ORTAM (LS3 NA @ 5000, ve 2JZ turbo @ 5000) ===');
for (const id of ['ls3','2jz-gte']) {
  console.log(`-- ${id} --`);
  for (const locId of ['sea-level','istanbul','denver','mexico-city','death-valley','cold-day']) {
    const loc = LOCATIONS.find(l => l.id === locId)!;
    const c = getPreset(id);
    c.ambient = applyLocation(c.ambient, loc);
    const p = solveOperatingPoint(c, 5000, O);
    row(loc.name, p, `yogunluk %${(p.densityAltitudeFactor*100).toFixed(0)} O2 %${(p.oxygenFactor*100).toFixed(1)}`);
  }
}

console.log('\n=== SOGUK MOTOR (LS3 @ 3000) ===');
for (const cT of [10, 40, 70, 90, 105]) {
  const c = getPreset('ls3');
  c.mechanical.coolantTemp = cT + 273.15;
  c.mechanical.oilTemp = (cT + 10) + 273.15;
  const p = solveOperatingPoint(c, 3000, O);
  row(`su ${cT}C`, p, `isinma %${(p.warmupFactor*100).toFixed(0)} yanmaVerim %${(p.combustionEfficiency*100).toFixed(1)} FMEP ${(p.fmep/1e5).toFixed(2)}`);
}

console.log('\n=== EGZOZ MANIFOLDU (2JZ turbo) ===');
for (const mt of MANIFOLD_TYPES) {
  const c = getPreset('2jz-gte');
  c.induction.manifold = mt;
  const lo = solveOperatingPoint(c, 2500, O);
  const hi = solveOperatingPoint(c, 6500, O);
  console.log(
    (MANIFOLDS[mt].nameEn).padEnd(22) +
    `2500rpm: ${(lo.power/HP).toFixed(0).padStart(3)}HP MAP ${(lo.map/1e5).toFixed(2)}  |  ` +
    `6500rpm: ${(hi.power/HP).toFixed(0).padStart(3)}HP karsiBas ${(hi.exhaustBackpressure/1e5).toFixed(2)} EGT ${(hi.turbineInletTemp-273.15).toFixed(0)}C`
  );
}

console.log('\n=== YAKIT SICAKLIGI ve POMPA (2JZ @ 6500) ===');
for (const ft of [20, 40, 60, 75]) {
  const c = getPreset('2jz-gte');
  c.fuelSystem.fuelTemp = ft + 273.15;
  const p = solveOperatingPoint(c, 6500, O);
  console.log(`yakit ${String(ft).padStart(3)}C   SMD ${(p.sauterMeanDiameter*1e6).toFixed(0).padStart(3)}um  buharKilidiPayi ${(p.vaporLockMargin/1000).toFixed(0).padStart(4)} kPa  duty %${(p.injectorDutyCycle*100).toFixed(0)}`);
}
for (const pf of [200, 140, 100, 70]) {
  const c = getPreset('2jz-gte');
  c.fuelSystem.pumpFlowLPH = pf;
  const p = solveOperatingPoint(c, 6500, O);
  console.log(`pompa ${String(pf).padStart(3)}L/s  talep ${p.fuelDemandLPH.toFixed(0).padStart(3)}  arz ${p.fuelSupplyLPH.toFixed(0).padStart(3)}  pay %${(p.fuelHeadroom*100).toFixed(0).padStart(4)}  guc ${(p.power/HP).toFixed(0)}HP`);
}

console.log('\n=== TURBIN A/R (2JZ) ===');
for (const ar of [0.5, 0.7, 0.9, 1.2]) {
  const c = getPreset('2jz-gte');
  c.induction.turbineAR = ar;
  const lo = solveOperatingPoint(c, 2500, O);
  const hi = solveOperatingPoint(c, 7000, O);
  console.log(`A/R ${ar.toFixed(2)}  2500rpm MAP ${(lo.map/1e5).toFixed(2)} ${(lo.power/HP).toFixed(0).padStart(3)}HP  |  7000rpm karsiBas ${(hi.exhaustBackpressure/1e5).toFixed(2)} ${(hi.power/HP).toFixed(0).padStart(3)}HP  komprVerim %${(hi.compressorEfficiency*100).toFixed(0)} ucHizi ${hi.compressorTipSpeed.toFixed(0)}m/s`);
}
