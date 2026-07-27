import { frictionBreakdown } from '../src/core/friction';
import { solveLubrication } from '../src/core/lubrication';
import { solveOperatingPoint } from '../src/core/cycle';
import { getPreset } from '../src/core/presets';
import { makeKinematics, meanPistonSpeed, cylinderCount } from '../src/core/geometry';
for (const id of ['2jz-gte', 'ls3']) {
  const cfg = getPreset(id);
  const k = makeKinematics(cfg.geometry);
  const disp = k.sweptVolume * cylinderCount(cfg.layout);
  console.log(`\n${cfg.name}`);
  console.log('rpm    ' + ['segman','gazSeg','etek','yatak','supap','yagP','suP','alt','windage','TOPLAM'].map(s=>s.padStart(8)).join(''));
  for (const rpm of [1500, 3500, cfg.redline]) {
    const p = solveOperatingPoint(cfg, rpm);
    const l = solveLubrication(cfg, rpm, p.peakBearingLoad);
    const f = frictionBreakdown(cfg, k, rpm, p.peakPressure, meanPistonSpeed(cfg.geometry.stroke, rpm), p.peakSideForce, l.pressure, l.pumpFlow, 0);
    const hp = (v: number) => ((v * disp * rpm) / (2*60) / 745.7).toFixed(1);
    console.log(String(rpm).padStart(5) + '  ' + [f.ringTension,f.ringGasLoaded,f.pistonSkirt,f.bearings,f.valvetrain,f.oilPump,f.waterPump,f.alternator,f.windage,f.total].map(v=>hp(v).padStart(8)).join('') + '  HP');
    if (rpm === cfg.redline) console.log(`       FMEP ${(f.total/1e5).toFixed(2)} bar | mek.verim %${(p.mechanicalEfficiency*100).toFixed(1)} | yag ${(l.pressure/1e5).toFixed(1)} bar`);
  }
}
