/**
 * Cozucu duman testi — sayilar fiziksel olarak makul mu?
 * Calistir: npx tsx test/smoke.ts
 */
import { solveOperatingPoint } from '../src/core/cycle';
import { getPreset, PRESET_LIST } from '../src/core/presets';
import { cylinderCount } from '../src/core/geometry';

const HP = 745.7;

function run(id: string, rpms: number[]) {
  const cfg = getPreset(id);
  const nCyl = cylinderCount(cfg.layout);
  const disp =
    (Math.PI / 4) * cfg.geometry.bore ** 2 * cfg.geometry.stroke * nCyl * 1000;
  console.log(`\n=== ${cfg.name}  (${disp.toFixed(2)} L, ${cfg.layout}, ${cfg.induction.type}) ===`);
  console.log(
    'RPM    MAP    VE%    Avans  IMEP   BMEP   FMEP   Tork    Guc     Pmax  @deg  Tmax   EGT   Knock  Duty  Verim',
  );
  const t0 = Date.now();
  for (const rpm of rpms) {
    const p = solveOperatingPoint(cfg, rpm);
    console.log(
      [
        String(rpm).padStart(5),
        (p.map / 1e5).toFixed(2).padStart(5),
        (p.volumetricEfficiency * 100).toFixed(1).padStart(6),
        p.sparkAdvance.toFixed(1).padStart(6),
        (p.imep / 1e5).toFixed(2).padStart(6),
        (p.bmep / 1e5).toFixed(2).padStart(6),
        (p.fmep / 1e5).toFixed(2).padStart(6),
        p.torque.toFixed(1).padStart(7),
        (p.power / HP).toFixed(1).padStart(7),
        (p.peakPressure / 1e5).toFixed(0).padStart(5),
        p.peakPressureAngle.toFixed(1).padStart(5),
        p.peakTemperature.toFixed(0).padStart(6),
        (p.egt - 273.15).toFixed(0).padStart(5),
        p.knockRisk.toFixed(2).padStart(6),
        (p.injectorDutyCycle * 100).toFixed(0).padStart(5),
        (p.thermalEfficiency * 100).toFixed(1).padStart(6),
      ].join(' '),
    );
  }
  console.log(`  (${Date.now() - t0} ms)`);
}

console.log('Mevcut motorlar:', PRESET_LIST.map((p) => p.id).join(', '));

run('2jz-gte', [1500, 2500, 3500, 4500, 5500, 6500, 7000]);
run('ls3', [1500, 2500, 3500, 4500, 5500, 6500]);
run('k20a', [2000, 3000, 4000, 5000, 6000, 7000, 8000, 8600]);
