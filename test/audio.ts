/**
 * Ses motoru — Web Audio'ya gecersiz deger gonderilmedigini dogrular.
 *
 * NEDEN BU TEST VAR:
 * Web Audio, bir AudioParam'a sonlu olmayan bir deger (NaN / Infinity)
 * verildiginde istisna firlatir. Bu istisna surus dongusunun icinde
 * olustugu icin requestAnimationFrame bir daha kurulamiyor ve
 * simulasyon KALICI olarak doniyordu — ses acikken oynanamaz hale
 * geliyordu. Belirti "ses" gibi gorunuyordu ama sebep tek bir sayiydi.
 *
 * Burada gercek tarayici davranisini taklit eden kati bir sahte
 * AudioContext kuruluyor: gecersiz her deger aninda yakalanip hangi
 * parametreden geldigi soyleniyor.
 */
import { getPreset } from '../src/core/presets';
import { buildTorqueMap, lookupTorque, lookupPoint } from '../src/core/sweep';
import { vehicleFor, initialVehicleState, stepVehicle } from '../src/core/drivetrain';
import { initialDriverState, stepDriver, shiftGear, engageStarter } from '../src/core/driverModel';
import { cylinderCount } from '../src/core/geometry';
import { clamp } from '../src/core/gas';
import type { DriverInputs } from '../src/core/driverModel';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// ============================================================
// KATI SAHTE WEB AUDIO
// Tarayicinin firlattigi her durumda burasi da firlatir.
// ============================================================
const violations: string[] = [];

function check(label: string, v: number, what: string) {
  if (!Number.isFinite(v)) {
    const msg = `${label}: ${what} = ${v}`;
    violations.push(msg);
    throw new TypeError(`Failed to execute Web Audio — ${msg}`);
  }
}

class FakeParam {
  value = 0;
  constructor(private label: string) {}
  setTargetAtTime(target: number, startTime: number, timeConstant: number) {
    check(this.label, target, 'target');
    check(this.label, startTime, 'startTime');
    check(this.label, timeConstant, 'timeConstant');
    // Tarayici: timeConstant negatifse RangeError
    if (timeConstant < 0) {
      violations.push(`${this.label}: timeConstant < 0`);
      throw new RangeError(`${this.label}: timeConstant negatif`);
    }
    this.value = target;
  }
  setValueAtTime(v: number, t: number) {
    check(this.label, v, 'value'); check(this.label, t, 'time');
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    check(this.label, v, 'value'); check(this.label, t, 'time');
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    check(this.label, v, 'value'); check(this.label, t, 'time');
    // Tarayici: hedef 0 veya negatifse RangeError
    if (v <= 0) {
      violations.push(`${this.label}: exponentialRamp hedefi ${v} (>0 olmali)`);
      throw new RangeError(`${this.label}: exponentialRamp hedefi ${v}`);
    }
    this.value = v;
  }
  cancelScheduledValues(t: number) { check(this.label, t, 'time'); }
}

const node = (label: string, extra: Record<string, unknown> = {}) => ({
  connect() { return this; }, disconnect() {},
  start() {}, stop() {},
  ...extra,
  __label: label,
});

let nodeCount = 0;

class FakeCtx {
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  destination = node('destination');
  async resume() { this.state = 'running'; }
  async close() {}
  createGain() { nodeCount++; return node('gain', { gain: new FakeParam('gain.gain') }); }
  createOscillator() {
    nodeCount++;
    return node('osc', {
      frequency: new FakeParam('osc.frequency'),
      detune: new FakeParam('osc.detune'),
      type: 'sine',
      setPeriodicWave() {},
    });
  }
  createBiquadFilter() {
    nodeCount++;
    return node('biquad', {
      frequency: new FakeParam('filter.frequency'),
      Q: new FakeParam('filter.Q'),
      gain: new FakeParam('filter.gain'),
      type: 'lowpass',
    });
  }
  createBufferSource() {
    nodeCount++;
    return node('bufsrc', {
      buffer: null, loop: false,
      playbackRate: new FakeParam('bufsrc.playbackRate'),
    });
  }
  createWaveShaper() { nodeCount++; return node('shaper', { curve: null, oversample: 'none' }); }
  createBuffer(ch: number, len: number, rate: number) {
    const data = new Float32Array(len);
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: () => data };
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array) {
    real.forEach((v, i) => check('periodicWave.real', v, `[${i}]`));
    imag.forEach((v, i) => check('periodicWave.imag', v, `[${i}]`));
    return { __wave: true };
  }
}

(globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };

// audio.ts'i sahte ortam kurulduktan SONRA yukle
const { EngineAudio, soundProfile } = await import('../src/ui/audio');

// ============================================================
// SURUS DONGUSU — DrivePanel'deki tick() ile ayni cagrilar
// ============================================================
const NO: DriverInputs = {
  throttle: false, brake: false, clutch: false, handbrake: false, starter: false,
};
const RPM_TO_RAD = (2 * Math.PI) / 60;

/** Bir motoru kurup senaryoyu kare kare kosar; ilk ihlali dondurur */
function drive(presetId: string, label: string): string | null {
  const cfg = getPreset(presetId);
  const n = cylinderCount(cfg.layout);
  const dispL = (Math.PI / 4) * cfg.geometry.bore ** 2 * cfg.geometry.stroke * n * 1000;
  const profile = soundProfile(
    cfg.layout, n, cfg.induction.type === 'TURBO', cfg.redline, cfg.idleRpm, dispL,
  );

  const audio = new EngineAudio(profile);
  const ctx = new FakeCtx();
  // start() sahte context'i kurar
  (audio as unknown as { ctx: FakeCtx }).ctx = ctx;
  (audio as unknown as { build: () => void }).build();
  (audio as unknown as { started: boolean }).started = true;
  audio.setVolume(0.75);

  const map = buildTorqueMap(cfg);
  const vehicle = vehicleFor(cfg.id);
  const state = initialVehicleState(cfg.idleRpm);
  const driver = initialDriverState();
  const maxTorque = Math.max(...map.wot, 1);
  const dt = 0.016;

  for (let frame = 0; frame < 1500; frame++) {
    ctx.currentTime += dt;
    const sec = frame * dt;

    // Senaryo: mars > rolanti > tam gaz > vites > gaz kesme > sert fren
    const inputs: DriverInputs = { ...NO };
    if (sec < 1.2) inputs.starter = true;
    else if (sec < 3) { /* rolanti */ }
    else if (sec < 10) inputs.throttle = true;
    else if (sec < 12) { /* gaz kesme — patlama penceresi */ }
    else if (sec < 16) inputs.brake = true;
    else if (sec < 20) { inputs.throttle = true; inputs.handbrake = true; }
    else inputs.brake = true;

    if (Math.abs(sec - 6) < dt || Math.abs(sec - 8) < dt) {
      shiftGear(driver, 1, vehicle.gearRatios.length);
    }
    if (sec < 1.2 && !state.running) engageStarter(driver, state.running);

    const rpmNow = (state.engineOmega / RPM_TO_RAD);
    const inputRpm = rpmNow;
    const ds = stepDriver(
      driver,
      { autoClutch: true, idleRpm: cfg.idleRpm, maxGear: vehicle.gearRatios.length, startDelay: 0.9 },
      inputs, rpmNow, inputRpm, state.running, dt,
    );
    if (ds.ignited) { state.running = true; state.engineOmega = cfg.idleRpm * 1.35 * RPM_TO_RAD; }
    if (ds.cranking && !state.running) state.engineOmega = ds.crankRpm * RPM_TO_RAD;

    const r = stepVehicle(
      state, vehicle,
      { throttle: driver.throttle, brake: driver.brake, clutch: driver.clutch,
        handbrake: driver.handbrake, gear: driver.gear },
      (rpm, thr) => lookupTorque(map, rpm, thr),
      map.inertia, cfg.idleRpm, cfg.redline, dt,
    );

    const point = lookupPoint(map, r.rpm);
    try {
      audio.update({
        rpm: r.rpm,
        throttle: driver.throttle,
        load: clamp(Math.abs(r.engineTorque) / maxTorque, 0, 1),
        running: r.state.running,
        cranking: driver.starter === 'cranking',
        crankRpm: driver.crankRpm,
        boost: (point.map - cfg.ambient.pressure) / 1e5,
        wheelSlip: r.slipSpeed,
        brake: driver.brake + driver.handbrake * 0.7,
        speedKmh: r.speedKmh,
        clutchSlip: r.clutchSlipSpeed,
        revLimiter: r.revLimiter,
      });
    } catch (e) {
      return `${label} kare ${frame} (t=${sec.toFixed(2)}s): ${(e as Error).message}`;
    }
  }
  return null;
}

console.log('=== SES: GECERSIZ PARAMETRE TARAMASI ===');
const engines: [string, string][] = [
  ['2jz-gte', '2JZ-GTE (turbo I6)'],
  ['ls3', 'LS3 (NA V8)'],
  ['k20a', 'K20A (NA I4)'],
  ['ej257', 'EJ257 (turbo B4)'],
  ['viper-v10', 'Viper V10'],
  ['v12-na', 'F140 V12'],
];
for (const [id, label] of engines) {
  const v = drive(id, label);
  ok(label, v === null, v ?? '');
}

console.log('\n=== SES: SINIR DEGERLER ===');
{
  const cfg = getPreset('2jz-gte');
  const n = cylinderCount(cfg.layout);
  const dispL = (Math.PI / 4) * cfg.geometry.bore ** 2 * cfg.geometry.stroke * n * 1000;
  const profile = soundProfile(cfg.layout, n, true, cfg.redline, cfg.idleRpm, dispL);
  const audio = new EngineAudio(profile);
  const ctx = new FakeCtx();
  (audio as unknown as { ctx: FakeCtx }).ctx = ctx;
  (audio as unknown as { build: () => void }).build();
  (audio as unknown as { started: boolean }).started = true;

  // Bozuk girdiler ses motorunu ASLA cokertmemeli — surus dongusu
  // bunlari uretmese bile savunma katmani olmali.
  const bad = [
    ['NaN devir', { rpm: NaN }],
    ['NaN yuk', { load: NaN }],
    ['NaN basinc', { boost: NaN }],
    ['NaN kayma', { wheelSlip: NaN }],
    ['NaN hiz', { speedKmh: NaN }],
    ['Infinity devir', { rpm: Infinity }],
    ['negatif devir', { rpm: -500 }],
  ] as const;

  const base = {
    rpm: 3000, throttle: 0.5, load: 0.5, running: true, cranking: false,
    crankRpm: 0, boost: 0.5, wheelSlip: 0, brake: 0, speedKmh: 60,
    clutchSlip: 0, revLimiter: false,
  };
  for (const [label, patch] of bad) {
    let threw: string | null = null;
    try {
      ctx.currentTime += 0.016;
      audio.update({ ...base, ...patch });
    } catch (e) { threw = (e as Error).message; }
    ok(label, threw === null, threw ?? '');
  }
}

console.log(`\n${pass} gecti, ${fail} kaldi`);
if (violations.length) {
  console.log('\nIHLALLER:');
  [...new Set(violations)].forEach((v) => console.log(`  - ${v}`));
}
process.exit(fail ? 1 : 0);
