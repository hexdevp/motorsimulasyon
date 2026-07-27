/** Donen parcalarin fazlari dogru kaynaktan mi suruluyor */
import { buildTorqueMap, lookupTorque } from '../src/core/sweep';
import { getPreset } from '../src/core/presets';
import { vehicleFor, initialVehicleState, stepVehicle } from '../src/core/drivetrain';
import { initialDriverState, stepDriver } from '../src/core/driverModel';

const cfg = getPreset('2jz-gte');
const v = vehicleFor('2jz-gte');
const map = buildTorqueMap(cfg);
const lookup = (r: number, t: number) => lookupTorque(map, r, t);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${d}`); }
};

// Panelin faz mantiginin birebir kopyasi
function run(seconds: number, keys: {throttle?:boolean}, gear: number) {
  const s = initialVehicleState(cfg.idleRpm);
  const d = initialDriverState();
  d.gear = gear;
  const ph = { engine: 0, gearbox: 0, wheel: 0 };
  const dt = 0.016;
  for (let t = 0; t < seconds; t += dt) {
    stepDriver(d, { autoClutch: true, idleRpm: cfg.idleRpm, maxGear: 6, startDelay: 0.9 },
      { throttle: !!keys.throttle, brake: false, clutch: false, handbrake: false, starter: false },
      s.engineOmega * 9.5493,
      Math.abs(s.wheelOmega * (gear ? v.gearRatios[gear-1]*v.finalDrive : 0)) * 9.5493,
      s.running, dt);
    const r = stepVehicle(s, v, { throttle: d.throttle, brake: d.brake, clutch: d.clutch,
      handbrake: d.handbrake, gear: d.gear }, lookup, map.inertia, cfg.idleRpm, cfg.redline, dt);
    ph.engine += r.state.engineOmega * dt * 0.11;
    ph.wheel  += r.state.wheelOmega * dt;
    ph.gearbox += r.state.wheelOmega * v.finalDrive * dt * 0.25;
  }
  return { ph, s };
}

console.log('=== ARAC DURURKEN (bos vites, rolanti) ===');
{
  const { ph, s } = run(3, {}, 0);
  console.log(`  motor ${(s.engineOmega*9.5493).toFixed(0)} rpm | hiz ${(s.speed*3.6).toFixed(2)} km/s`);
  console.log(`  fazlar: motor ${ph.engine.toFixed(2)} | saft ${ph.gearbox.toFixed(4)} | tekerlek ${ph.wheel.toFixed(4)}`);
  ok('Motor fazı ilerliyor', ph.engine > 1, `${ph.engine}`);
  ok('Tekerlek fazı SABİT (dönmüyor)', Math.abs(ph.wheel) < 1e-9, `${ph.wheel}`);
  ok('Şaft fazı SABİT', Math.abs(ph.gearbox) < 1e-9, `${ph.gearbox}`);
  ok('Araç hızı sıfır', Math.abs(s.speed) < 1e-6);
}

console.log('\n=== HAREKET HALINDE (1.vites, gaz) ===');
{
  const { ph, s } = run(3, { throttle: true }, 1);
  console.log(`  motor ${(s.engineOmega*9.5493).toFixed(0)} rpm | hiz ${(s.speed*3.6).toFixed(1)} km/s`);
  console.log(`  fazlar: motor ${ph.engine.toFixed(2)} | saft ${ph.gearbox.toFixed(2)} | tekerlek ${ph.wheel.toFixed(2)}`);
  ok('Tekerlek fazı ilerliyor', ph.wheel > 1, `${ph.wheel}`);
  ok('Şaft, tekerlekten hızlı döner', ph.gearbox > 0 && ph.gearbox > ph.wheel * 0.5);
  ok('Araç hareket ediyor', s.speed * 3.6 > 5, `${(s.speed*3.6).toFixed(1)} km/s`);
}

console.log(`\n${'='.repeat(46)}\nSONUC: ${pass} basarili, ${fail} basarisiz`);
if (fail) process.exit(1);
