/** Surucu modeli — otomatik debriyaj ve mars davranisi */
import {
  initialDriverState, stepDriver, shiftGear,
  type DriverConfig, type DriverInputs,
} from '../src/core/driverModel';

const NO: DriverInputs = { throttle: false, brake: false, clutch: false, handbrake: false, starter: false };
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const cfg = (autoClutch: boolean): DriverConfig =>
  ({ autoClutch, idleRpm: 800, maxGear: 6, startDelay: 0.9 });

console.log('=== OTOMATIK DEBRIYAJ ACIK ===');
{
  const s = initialDriverState();
  // Viteste, devir rolantinin altina duserken
  for (let i = 0; i < 60; i++) stepDriver(s, cfg(true), NO, 500, 0, true, 0.016);
  ok('Düşük devirde debriyaj ayrılır', s.clutch > 0.4, `clutch=${s.clutch.toFixed(2)}`);

  const s2 = initialDriverState();
  for (let i = 0; i < 60; i++) stepDriver(s2, cfg(true), NO, 3000, 3000, true, 0.016);
  ok('Normal devirde debriyaj kavrar', s2.clutch < 0.02, `clutch=${s2.clutch.toFixed(2)}`);
}

console.log('\n=== OTOMATIK DEBRIYAJ KAPALI ===');
{
  const s = initialDriverState();
  // Ayni dusuk devir kosulu — otomatik kapaliyken MUDAHALE ETMEMELI
  for (let i = 0; i < 60; i++) stepDriver(s, cfg(false), NO, 500, 0, true, 0.016);
  ok('Düşük devirde debriyaj kavramış kalır', s.clutch < 0.02, `clutch=${s.clutch.toFixed(2)}`);

  // Surucu pedali basarsa yine de ayrilmali
  const s2 = initialDriverState();
  const held: DriverInputs = { ...NO, clutch: true };
  for (let i = 0; i < 40; i++) stepDriver(s2, cfg(false), held, 3000, 3000, true, 0.016);
  ok('Sürücü pedalı her zaman kazanır', s2.clutch > 0.95, `clutch=${s2.clutch.toFixed(2)}`);
}

console.log('\n=== ACIK/KAPALI GECISI ===');
{
  const s = initialDriverState();
  for (let i = 0; i < 60; i++) stepDriver(s, cfg(true), NO, 500, 0, true, 0.016);
  const withAuto = s.clutch;
  // Ayni durumdan otomatigi kapat
  for (let i = 0; i < 60; i++) stepDriver(s, cfg(false), NO, 500, 0, true, 0.016);
  ok('Kapatınca debriyaj geri kavrar', s.clutch < 0.02,
    `açıkken ${withAuto.toFixed(2)} → kapalıyken ${s.clutch.toFixed(2)}`);
}

console.log('\n=== VITES GECISI ===');
{
  const s = initialDriverState();
  ok('Vites yükseltilir', shiftGear(s, 1, 6) && s.gear === 2);
  ok('Geçiş sırasında ikinci komut reddedilir', !shiftGear(s, 1, 6) && s.gear === 2);
  // Gecis sirasinda debriyaj otomatik ayrilmali (otomatik KAPALI olsa bile)
  stepDriver(s, cfg(false), NO, 3000, 3000, true, 0.05);
  ok('Geçişte debriyaj otomatik ayrılır', s.clutch > 0.1, `clutch=${s.clutch.toFixed(2)}`);
  for (let i = 0; i < 30; i++) stepDriver(s, cfg(false), NO, 3000, 3000, true, 0.016);
  ok('Geçiş bitince tekrar kavrar', s.clutch < 0.02, `clutch=${s.clutch.toFixed(2)}`);
  const s2 = initialDriverState();
  s2.gear = 6;
  ok('Son vitesin üstüne çıkmaz', !shiftGear(s2, 1, 6) && s2.gear === 6);
}

console.log('\n=== MARS ===');
{
  const s = initialDriverState();
  s.starter = 'off';
  const press: DriverInputs = { ...NO, starter: true };
  let ignitedAt = -1, crankFrames = 0;
  for (let i = 0; i < 120; i++) {
    const r = stepDriver(s, cfg(true), press, 0, 0, false, 0.016);
    if (r.cranking) crankFrames++;
    if (r.ignited && ignitedAt < 0) ignitedAt = i * 0.016;
  }
  ok('Marş anında çalıştırmaz', ignitedAt > 0.5, `tutuşma=${ignitedAt.toFixed(2)}s`);
  ok('Marş süresi ~startDelay', Math.abs(ignitedAt - 0.9) < 0.1, `${ignitedAt.toFixed(2)}s`);
  ok('Marş çevirme sesi için kare üretir', crankFrames > 40, `${crankFrames} kare`);
  ok('Krank devri makul', s.crankRpm === 0 || (s.crankRpm > 180 && s.crankRpm < 320));

  // Motor calisiyorken marsa basmak etkisiz
  const s2 = initialDriverState();
  const r2 = stepDriver(s2, cfg(true), press, 800, 0, true, 0.016);
  ok('Çalışan motorda marş etkisiz', !r2.cranking && !r2.ignited);
}

console.log(`\n${'='.repeat(46)}\nSONUC: ${pass} basarili, ${fail} basarisiz`);
if (fail) process.exit(1);
