/**
 * MBT teshisi: is / atesleme avansi egrisini dogrudan cizdir.
 * Beklenti: tek tepeli, tepe ~25-32 BTDC civarinda.
 * Calistir: npx tsx test/mbt.ts
 */
import { integrateCycle, DEFAULT_OPTIONS } from '../src/core/cycle';
import { getPreset } from '../src/core/presets';
import { makeKinematics } from '../src/core/geometry';
import { wallTemperatures } from '../src/core/heat';

const cfg = getPreset('ls3');
const k = makeKinematics(cfg.geometry);
const rpm = 3500;

const bc = {
  intakePressure: 99800,
  intakeTemp: 285,
  exhaustPressure: 112000,
  exhaustTemp: 1100,
  walls: wallTemperatures(cfg.mechanical, 150e3),
  crankcasePressure: 99300,
  intakeRamFactor: 1.07,
  combustionEfficiencyFactor: 1.0,
  lambda: cfg.fuelSystem.targetLambda,
  scavengePressureFactor: 1.0,
};

let state = {
  mass: (101325 * k.sweptVolume) / (287 * 350),
  temperature: 400,
  burnedMass: 0,
  residualFraction: 0.05,
};

// Once cevrimi yakinsat
for (let i = 0; i < 8; i++) {
  state = integrateCycle(cfg, k, rpm, 30, bc, state, DEFAULT_OPTIONS).endState;
}

console.log('Avans  Wnet(J)  Wbrut(J)  Wpomp(J)  Pmax(bar) @deg  Tmax(K)  Qcidar(J)  knock');
let best = -Infinity, bestAdv = 0;
for (let adv = 5; adv <= 60; adv += 2.5) {
  let s = state;
  let r = integrateCycle(cfg, k, rpm, adv, bc, s, DEFAULT_OPTIONS);
  for (let i = 0; i < 6; i++) r = integrateCycle(cfg, k, rpm, adv, bc, r.endState, DEFAULT_OPTIONS);
  if (r.indicatedWorkNet > best) { best = r.indicatedWorkNet; bestAdv = adv; }
  console.log(
    [
      adv.toFixed(1).padStart(5),
      r.indicatedWorkNet.toFixed(1).padStart(8),
      r.indicatedWorkGross.toFixed(1).padStart(9),
      r.pumpingWork.toFixed(1).padStart(9),
      (r.peakPressure / 1e5).toFixed(1).padStart(9),
      r.peakPressureAngle.toFixed(1).padStart(5),
      r.peakTemperature.toFixed(0).padStart(8),
      r.wallHeat.toFixed(1).padStart(10),
      r.knockIntegral.toFixed(2).padStart(7),
    ].join(' '),
  );
}
console.log(`\nMBT = ${bestAdv} BTDC  (Wnet = ${best.toFixed(1)} J)`);
