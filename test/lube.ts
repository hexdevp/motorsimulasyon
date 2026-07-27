import { solveLubrication, oilPressureVerdict } from '../src/core/lubrication';
import { solveOperatingPoint } from '../src/core/cycle';
import { getPreset } from '../src/core/presets';
const cfg = getPreset('2jz-gte');
console.log('YAG BASINCI (2JZ-GTE, SAE40)');
console.log('rpm    bosluk   yagT   basinc  film   asinma  durum');
for (const [clearMul, oilC, label] of [[1.0,100,'stok/sicak'],[1.0,80,'stok/ilik'],[1.5,100,'asinmis'],[0.8,100,'siki'],[1.0,130,'cok sicak']] as [number,number,string][]) {
  const c = structuredClone(cfg);
  c.mechanical.mainBearingClearance *= clearMul;
  c.mechanical.rodBearingClearance *= clearMul;
  c.mechanical.oilTemp = oilC + 273.15;
  for (const rpm of [750, 3000, 7000]) {
    const p = solveOperatingPoint(c, rpm, { step: 1.5, maxIterations: 4, ignitionPasses: 1 });
    const l = solveLubrication(c, rpm, p.peakBearingLoad);
    console.log(`${String(rpm).padStart(5)}  ${clearMul.toFixed(2)}x  ${String(oilC).padStart(4)}C  ${(l.pressure/1e5).toFixed(2).padStart(6)} bar  ${(l.minFilm*1e6).toFixed(2).padStart(5)}um  ${l.wearIndex.toFixed(2)}   ${oilPressureVerdict(l.pressure,rpm).padEnd(8)} ${label}`);
  }
}
