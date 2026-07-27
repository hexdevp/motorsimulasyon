import { generateMaps } from '../src/core/fuelmap';
import { getPreset } from '../src/core/presets';
import { computeStatics } from '../src/core/sweep';
const cfg = getPreset('2jz-gte');
const t0 = Date.now();
const m = generateMaps(cfg);
console.log(`Uretim suresi: ${Date.now() - t0} ms`);
const st = computeStatics(cfg);
console.log(`Hacim ${(st.totalDisplacement*1e6).toFixed(0)} cc | R/S ${st.rodStrokeRatio.toFixed(2)} | DCR ${st.dynamicCR.toFixed(2)} | float ${st.valveFloatRpm.toFixed(0)} | onerilen redline ${st.recommendedRedline.toFixed(0)}`);
console.log('\nFUEL PW (us):  satir=MAP kPa, sutun=rpm');
process.stdout.write('  MAP\rpm ');
for (const r of m.fuelPW.rpmAxis) process.stdout.write(String(r).padStart(7));
console.log();
for (let r = 0; r < m.fuelPW.loadAxis.length; r += 3) {
  process.stdout.write(String(m.fuelPW.loadAxis[r]).padStart(9));
  for (const v of m.fuelPW.values[r]) process.stdout.write(v.toFixed(0).padStart(7));
  console.log();
}
console.log('\nVE (%):');
for (let r = 0; r < m.ve.loadAxis.length; r += 3) {
  process.stdout.write(String(m.ve.loadAxis[r]).padStart(9));
  for (const v of m.ve.values[r]) process.stdout.write(v.toFixed(0).padStart(7));
  console.log();
}
console.log('\nDUTY (%):');
for (let r = m.duty.loadAxis.length - 1; r >= 0; r -= 5) {
  process.stdout.write(String(m.duty.loadAxis[r]).padStart(9));
  for (const v of m.duty.values[r]) process.stdout.write(v.toFixed(0).padStart(7));
  console.log();
}
console.log('\nMaks MAP (kPa) devir bazinda:', m.maxMapPerRpm.map(v=>v.toFixed(0)).join(' '));
