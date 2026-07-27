/** Mars: R BASILI TUTULDUGUNDA motor calismali (bildirilen hata) */
import { buildTorqueMap, lookupTorque } from '../src/core/sweep';
import { getPreset } from '../src/core/presets';
import { vehicleFor, initialVehicleState, stepVehicle } from '../src/core/drivetrain';
import { initialDriverState, stepDriver, engageStarter } from '../src/core/driverModel';

const cfg = getPreset('2jz-gte');
const v = vehicleFor('2jz-gte');
const map = buildTorqueMap(cfg);
const RAD = 9.5493;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d='') => { if (c) {pass++;console.log(`  OK   ${n}`);} else {fail++;console.log(`  FAIL ${n} ${d}`);} };

/** Panelin dongusunun birebir kopyasi */
function drive(seconds: number, holdR: boolean, extra: Partial<{throttle:boolean;clutchHalf:boolean}> = {}) {
  const s = initialVehicleState(cfg.idleRpm);
  s.running = false; s.engineOmega = 0;   // motor durmus
  const d = initialDriverState();
  d.starter = 'off';
  let firstRun = -1;
  const dt = 0.016;
  for (let t = 0; t < seconds; t += dt) {
    if (holdR) engageStarter(d, s.running);
    const inputRpm = Math.abs(s.wheelOmega * v.gearRatios[d.gear-1] * v.finalDrive) * RAD;
    const ds = stepDriver(d,
      { autoClutch: true, idleRpm: cfg.idleRpm, maxGear: 6, startDelay: 0.9 },
      { throttle: !!extra.throttle, brake: false, clutch: false,
        halfClutch: !!extra.clutchHalf, handbrake: false, starter: holdR },
      s.engineOmega * RAD, inputRpm, s.running, dt);
    if (ds.ignited) { s.running = true; s.engineOmega = cfg.idleRpm * 1.35 / RAD; }
    if (ds.cranking && !s.running) s.engineOmega = ds.crankRpm / RAD;
    const r = stepVehicle(s, v, { throttle: d.throttle, brake: d.brake, clutch: d.clutch,
      handbrake: d.handbrake, gear: d.gear }, (rp,th)=>lookupTorque(map,rp,th),
      map.inertia, cfg.idleRpm, cfg.redline, dt);
    if (s.running && firstRun < 0) firstRun = t;
    void r;
  }
  return { s, d, firstRun };
}

console.log('=== MARS: R BASILI TUTULUYOR ===');
{
  const { s, firstRun } = drive(3, true);
  console.log(`  tutusma ${firstRun.toFixed(2)}s | devir ${(s.engineOmega*RAD).toFixed(0)} rpm | calisiyor: ${s.running}`);
  ok('Motor ÇALIŞIYOR', s.running);
  ok('Tutuşma ~0.9 s', firstRun > 0.7 && firstRun < 1.2, `${firstRun.toFixed(2)}s`);
  ok('Rölantide dönüyor', s.engineOmega*RAD > cfg.idleRpm*0.7, `${(s.engineOmega*RAD).toFixed(0)}`);
}

console.log('\n=== MARS: R HEMEN BIRAKILIYOR (0.3 s) ===');
{
  const s2 = initialVehicleState(cfg.idleRpm);
  s2.running = false; s2.engineOmega = 0;
  const d = initialDriverState(); d.starter = 'off';
  let started = false;
  for (let t = 0; t < 2.5; t += 0.016) {
    const hold = t < 0.3;
    if (hold) engageStarter(d, s2.running);
    const ds = stepDriver(d, { autoClutch: true, idleRpm: cfg.idleRpm, maxGear: 6, startDelay: 0.9 },
      { throttle: false, brake: false, clutch: false, handbrake: false, starter: hold },
      s2.engineOmega*RAD, 0, s2.running, 0.016);
    if (ds.ignited) { started = true; s2.running = true; }
  }
  ok('Erken bırakılınca çalışmaz', !started);
}

console.log('\n=== YARIM DEBRIYAJ (Ctrl) ===');
{
  const d = initialDriverState();
  for (let i = 0; i < 40; i++)
    stepDriver(d, { autoClutch: false, idleRpm: 800, maxGear: 6, startDelay: 0.9 },
      { throttle: false, brake: false, clutch: false, halfClutch: true,
        handbrake: false, starter: false }, 3000, 3000, true, 0.016);
  ok('Ctrl yarım konumda tutar', d.clutch > 0.45 && d.clutch < 0.6, `clutch=${d.clutch.toFixed(2)}`);

  const d2 = initialDriverState();
  for (let i = 0; i < 40; i++)
    stepDriver(d2, { autoClutch: false, idleRpm: 800, maxGear: 6, startDelay: 0.9 },
      { throttle: false, brake: false, clutch: true, halfClutch: true,
        handbrake: false, starter: false }, 3000, 3000, true, 0.016);
  ok('Shift, Ctrl’i ezer (tam ayrık)', d2.clutch > 0.95, `clutch=${d2.clutch.toFixed(2)}`);
}

console.log(`\n${'='.repeat(46)}\nSONUC: ${pass} basarili, ${fail} basarisiz`);
if (fail) process.exit(1);
