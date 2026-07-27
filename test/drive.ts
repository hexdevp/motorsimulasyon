/** Aktarma fiziginin dogrulanmasi */
import { buildTorqueMap, lookupTorque } from '../src/core/sweep';
import { getPreset } from '../src/core/presets';
import {
  vehicleFor, initialVehicleState, stepVehicle, topSpeedPerGear,
  estimateZeroToHundred, type DriverInput,
} from '../src/core/drivetrain';

for (const id of ['2jz-gte', 'k20a']) {
  const cfg = getPreset(id);
  const v = vehicleFor(id);
  const map = buildTorqueMap(cfg);
  const lookup = (rpm: number, thr: number) => lookupTorque(map, rpm, thr);
  console.log(`\n### ${v.name} (${cfg.name}) — ${v.mass}kg ${v.layout}`);
  console.log('Vites basi maks hiz:', topSpeedPerGear(v, cfg.redline).map(x=>x.toFixed(0)).join(' / '), 'km/s');

  const t100 = estimateZeroToHundred(v, lookup, map.inertia, cfg.idleRpm, cfg.redline);
  console.log(`0-100 km/s: ${Number.isFinite(t100) ? t100.toFixed(2)+' s' : 'STALL'}`);

  // Senaryolar
  const scen: [string, Partial<DriverInput>, number, number][] = [
    ['rolanti bosta',          { throttle: 0, gear: 0 },                    0, 2],
    ['1.vites kalkis tam gaz', { throttle: 1, gear: 1, clutch: 0 },         0, 3],
    ['3.vites 100km/s tam gaz',{ throttle: 1, gear: 3, clutch: 0 },        100, 2],
    ['3.vites gaz kesik',      { throttle: 0, gear: 3, clutch: 0 },        100, 2],
    ['fren (3.vites)',         { throttle: 0, brake: 1, gear: 3 },         100, 2],
    ['el freni',               { throttle: 0, handbrake: 1, gear: 3 },     100, 2],
    ['debriyaj basili gaz',    { throttle: 1, gear: 3, clutch: 1 },        100, 1.5],
  ];
  for (const [name, inp, startKmh, dur] of scen) {
    const s = initialVehicleState(cfg.idleRpm);
    s.speed = startKmh / 3.6;
    s.wheelOmega = s.speed / v.wheelRadius;
    const input: DriverInput = { throttle: 0, brake: 0, clutch: 0, handbrake: 0, gear: 1, ...inp };
    if (inp.gear && inp.gear > 0 && (inp.clutch ?? 0) < 0.5 && startKmh > 0) {
      s.engineOmega = s.wheelOmega * Math.abs(v.gearRatios[inp.gear-1] * v.finalDrive);
    }
    let r: any = null;
    for (let t = 0; t < dur; t += 0.01) {
      r = stepVehicle(s, v, input, lookup, map.inertia, cfg.idleRpm, cfg.redline, 0.01);
    }
    console.log(
      `  ${name.padEnd(26)} ${r.rpm.toFixed(0).padStart(5)}rpm ${r.speedKmh.toFixed(1).padStart(6)}km/s ` +
      `ivme ${r.acceleration.toFixed(2).padStart(6)} cekis ${(r.tractionForce/1000).toFixed(2).padStart(6)}kN ` +
      `${r.wheelSpin ? 'PATINAJ ' : ''}${r.clutchSlipping ? 'KAYMA ' : ''}${r.stalled ? 'STALL ' : ''}`
    );
  }
}
