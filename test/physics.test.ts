/**
 * Fizik cekirdegi dogrulama testleri
 *
 * Burada amac "kod calisiyor mu" degil, "sayilar FIZIKSEL OLARAK dogru mu".
 * Her beklenen deger literaturden veya elle yapilabilir bir hesaptan gelir;
 * kaynagi yorumda belirtilmistir.
 *
 * Calistir:  npx tsx test/physics.test.ts
 */

import {
  airComposition, mixtureCp, mixtureCv, mixtureGamma, mixtureR,
  combustionProducts, compressibleFlow, IDX,
  mixtureInternalEnergy, sensibleInternalEnergy, sensibleEnthalpy,
  type Composition,
} from '../src/core/gas';
import {
  makeKinematics, cylinderVolume, pistonPosition, meanPistonSpeed,
  dynamicCompressionRatio, pistonVelocity,
} from '../src/core/geometry';
import {
  intakeLift, exhaustLift, valveOverlap, computedLSA, ivcABDC,
  effectiveFlowArea, intakeCenter,
} from '../src/core/valve';
import {
  wiebeBurnFraction, wiebeBurnRate, laminarFlameSpeed, autoignitionDelay,
  turbulentFlameSpeed, burnDurations,
} from '../src/core/combustion';
import { woschniCoefficient } from '../src/core/heat';
import { makeFuel, stoichiometricAFR } from '../src/core/fuel';
import type { Geometry, Valvetrain_Spec } from '../src/core/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, actual: number, expected: number, tolPct: number, unit = '') {
  // Beklenen deger sifirsa yuzdesel tolerans anlamsizdir; kayan nokta
  // gurultusune izin veren mutlak bir esik kullaniriz.
  const tol = expected === 0 ? 1e-9 : Math.abs(expected * tolPct) / 100;
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) {
    passed++;
    console.log(`  OK   ${name}: ${fmt(actual)}${unit} (beklenen ~${fmt(expected)}${unit})`);
  } else {
    failed++;
    const msg = `  FAIL ${name}: ${fmt(actual)}${unit}, beklenen ${fmt(expected)}${unit} +-${tolPct}%`;
    console.log(msg);
    failures.push(msg);
  }
}

function checkTrue(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  OK   ${name}`);
  } else {
    failed++;
    const msg = `  FAIL ${name} ${detail}`;
    console.log(msg);
    failures.push(msg);
  }
}

function fmt(v: number): string {
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1e5 || (a < 1e-3 && a > 0)) return v.toExponential(3);
  return v.toFixed(a < 1 ? 4 : a < 100 ? 2 : 1);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// ============================================================
section('GAZ TERMODINAMIGI (NASA polinomlari)');
// ============================================================

const air = airComposition();

// Referans: kuru havanin 300 K'deki ozellikleri (Cengel, Termodinamik, Tablo A-2)
check('Hava cp @ 300K', mixtureCp(air, 300), 1005, 1.5, ' J/kg.K');
check('Hava cv @ 300K', mixtureCv(air, 300), 718, 2, ' J/kg.K');
check('Hava gamma @ 300K', mixtureGamma(air, 300), 1.400, 1);
check('Hava R', mixtureR(air), 287, 1, ' J/kg.K');

// 1000 K'de cp belirgin yukselir — sabit-cp varsayiminin kirildigi yer
check('Hava cp @ 1000K', mixtureCp(air, 1000), 1142, 2, ' J/kg.K');
check('Hava gamma @ 1000K', mixtureGamma(air, 1000), 1.336, 1.5);

// Yanmis gaz 2500 K: gamma 1.25'e duser. Genisleme isini dogrudan etkiler.
const stoichProd = combustionProducts(8, 15.5, 0, 1.0);
check('Yanmis gaz gamma @ 2500K', mixtureGamma(stoichProd.composition, 2500), 1.25, 3);
checkTrue(
  'Stokiyometrikte CO olusmaz',
  stoichProd.composition[IDX.CO] < 1e-6,
  `CO=${stoichProd.composition[IDX.CO]}`,
);
check('Stokiyometrik yanma verimi', stoichProd.combustionEfficiency, 1.0, 0.5);

// Fakir karisimda artik O2 kalmali
const leanProd = combustionProducts(8, 15.5, 0, 0.8);
checkTrue('Fakir karisimda artik O2 var', leanProd.composition[IDX.O2] > 0.03,
  `O2=${leanProd.composition[IDX.O2]}`);

// Zengin karisim: CO ve H2 olusur, yanma verimi duser (su-gaz kaymasi).
// Benzinin molar LHV'si: 44.0 MJ/kg × 0.11171 kg/mol = 4915 kJ/mol
const GASOLINE_MOLAR_LHV = 4915;
const richProd = combustionProducts(8, 15.5, 0, 1.2, GASOLINE_MOLAR_LHV);
checkTrue('Zengin karisimda CO olusur', richProd.composition[IDX.CO] > 0.02,
  `CO=${richProd.composition[IDX.CO]}`);
checkTrue('Zengin karisimda H2 olusur', richProd.composition[IDX.H2] > 0.002,
  `H2=${richProd.composition[IDX.H2]}`);
checkTrue('Zengin karisimda O2 tukenir', richProd.composition[IDX.O2] < 1e-6,
  `O2=${richProd.composition[IDX.O2]}`);
// phi=1.2'de yanma verimi.
//
// Bu degeri elle turetebiliriz. Tam yanma icin 8 CO2 (16 O) + 7.75 H2O
// (7.75 O) = 23.75 O atomu gerekir; mevcut olan 2·(11.875/1.2) = 19.79.
// Eksik: 3.958 O atomu. Her eksik O atomu ya bir CO2'yi CO yapar
// (−283 kJ) ya da bir H2O'yu H2 (−242 kJ). En iyi durumda hepsi H2
// olur: kayip 3.958 × 242 = 958 kJ  →  TAVAN verim = 1 − 958/4915 = 0.805
//
// Denge kimyasi kaybi CO ve H2 arasinda paylastirdigi icin sonuc bu
// tavanin biraz altinda kalir. Zengin karisimlarda kabul goren kaba
// kural olan 1/phi = 0.833 ile de ayni mertebededir.
check('Zengin (phi=1.2) yanma verimi', richProd.combustionEfficiency, 0.781, 3);
checkTrue('Yanma verimi termodinamik tavani asmaz',
  richProd.combustionEfficiency < 0.805,
  `${richProd.combustionEfficiency} >= 0.805`);
checkTrue('Zengin yanma verimi < stokiyometrik',
  richProd.combustionEfficiency < stoichProd.combustionEfficiency);
// Zenginlestikce verim monoton dusmeli
checkTrue('Verim phi ile monoton duser', (() => {
  let prev = 1.01;
  for (let phi = 1.0; phi <= 1.5; phi += 0.05) {
    const e = combustionProducts(8, 15.5, 0, phi, GASOLINE_MOLAR_LHV).combustionEfficiency;
    if (e > prev + 1e-9) return false;
    prev = e;
  }
  return true;
})());

// Mol fraksiyonlari 1'e toplanmali
for (const [label, p] of [['stok', stoichProd], ['fakir', leanProd], ['zengin', richProd]] as const) {
  let sum = 0;
  for (let i = 0; i < p.composition.length; i++) sum += p.composition[i];
  check(`Mol fraksiyon toplami (${label})`, sum, 1.0, 0.01);
}

// Element korunumu kontrolu (zengin durum en riskli olan)
{
  const c = richProd.composition;
  // C/H oraninin yakittakiyle uyusmasi gerekir (havadan gelen CO2 haric tutulamaz,
  // o yuzden yalnizca H/C egilimini kabaca dogruluyoruz)
  const cAtoms = c[IDX.CO2] + c[IDX.CO];
  const hAtoms = 2 * c[IDX.H2O] + 2 * c[IDX.H2];
  check('Zengin urunlerde H/C orani', hAtoms / cAtoms, 15.5 / 8, 6);
}

// Sikistirilabilir akis: tikanik rejimde asagi akis basinci onemsizlesmeli
{
  const R = 287, g = 1.4, A = 1e-4, pUp = 300000, T = 350;
  const f1 = compressibleFlow(0.7, A, pUp, 100000, T, R, g);
  const f2 = compressibleFlow(0.7, A, pUp, 50000, T, R, g);
  checkTrue('Tikanik akis asagi basinctan bagimsiz', Math.abs(f1 - f2) / f1 < 1e-9);
  // Tikanik kutle akisi analitik degeri
  const prCrit = Math.pow(2 / (g + 1), g / (g - 1));
  const expected = (0.7 * A * pUp / Math.sqrt(R * T)) * Math.sqrt(g) *
    Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  check('Tikanik kutle akisi', f1, expected, 0.01, ' kg/s');
  checkTrue('Kritik basinc orani ~0.528', Math.abs(prCrit - 0.5283) < 0.001);
  // Basinc farki yoksa akis olmamali
  checkTrue('Basinc farki yok -> akis yok', compressibleFlow(0.7, A, 1e5, 1e5, T, R, g) === 0);
}

// ============================================================
section('KRANK GEOMETRISI');
// ============================================================

// 2JZ-GTE olculeri: 86.0 x 86.0 mm, biyel 142.0 mm, CR 8.5:1
const geo: Geometry = {
  bore: 0.086, stroke: 0.086, rodLength: 0.142,
  compressionRatio: 8.5, deckClearance: 0.001, pinOffset: 0,
  squishAreaRatio: 0.25,
};
const kin = makeKinematics(geo);

// Strok hacmi = pi/4 * 86^2 * 86 = 499.6 cc
check('Silindir hacmi', kin.sweptVolume * 1e6, 499.56, 0.1, ' cc');
check('Toplam hacim (6 sil.)', kin.sweptVolume * 6 * 1e6, 2997.4, 0.1, ' cc');
// Sikistirma hacmi = Vd/(CR-1) = 499.56/7.5 = 66.6 cc
check('Sikistirma hacmi', kin.clearanceVolume * 1e6, 66.61, 0.1, ' cc');

// TDC ve BDC hacimleri
check('Hacim @ TDC (0 deg)', cylinderVolume(kin, 0) * 1e6, 66.61, 0.1, ' cc');
check('Hacim @ BDC (180 deg)', cylinderVolume(kin, 180) * 1e6, 566.17, 0.1, ' cc');
check('Sikistirma orani dogrulama',
  cylinderVolume(kin, 180) / cylinderVolume(kin, 0), 8.5, 0.1);

// Piston TDC'de tam sifirda olmali, BDC'de strok kadar
check('Piston konumu @ TDC', pistonPosition(kin, 0) * 1000, 0, 0.001, ' mm');
check('Piston konumu @ BDC', pistonPosition(kin, 180) * 1000, 86.0, 0.01, ' mm');

// Ortalama piston hizi: 2 * 0.086 * 7000 / 60 = 20.07 m/s
check('Ortalama piston hizi @ 7000rpm', meanPistonSpeed(0.086, 7000), 20.07, 0.1, ' m/s');

// Tepe piston hizi ve olustugu aci — elle turetilebilir bir kontrol.
// lambda = a/L = 0.30282 icin,  d/dθ[sinθ + (λ/2)sin2θ] = 0  denkleminden
//   cosθ = [−1 + sqrt(1+8λ²)]/(4λ) = 0.2614  →  θ = 74.85°
//   v_max/v_ort = (π/2)·[sinθ + λ·sinθcosθ/sqrt(1−λ²sin²θ)] = 1.636
// Tarama 0-180 ile sinirli: |v(θ)| = |v(360−θ)| oldugundan 285.5°'de
// birebir ayni tepe tekrar eder ve kayan nokta gurultusu hangisinin
// "buyuk" gorunecegini rastgele belirler.
{
  let peak = 0, peakAngle = 0;
  for (let t = 0; t <= 180; t += 0.05) {
    const v = Math.abs(pistonVelocity(kin, t, 7000));
    if (v > peak) { peak = v; peakAngle = t; }
  }
  check('Tepe piston hizi @ 7000rpm', peak, 32.93, 1, ' m/s');
  check('Tepe piston hizi / ortalama', peak / 20.07, 1.636, 1);
  check('Tepe hizin krank acisi', peakAngle, 74.85, 2, ' derece');
}

// R/S orani = 142/86 = 1.651
check('Biyel/strok orani', geo.rodLength / geo.stroke, 1.651, 0.1);

// Simetri: ofset yoksa piston konumu theta ve -theta'da ayni olmali
checkTrue('Ofsetsiz krank simetrik',
  Math.abs(pistonPosition(kin, 90) - pistonPosition(kin, -90)) < 1e-12);

// Pim ofseti simetriyi bozmali (desaksiyel krank)
{
  const kinOff = makeKinematics({ ...geo, pinOffset: 0.003 });
  checkTrue('Pim ofseti simetriyi bozar',
    Math.abs(pistonPosition(kinOff, 90) - pistonPosition(kinOff, -90)) > 1e-4);
  // Ofsetli krankta da TDC'de piston konumu ~0 olmali (K0 sabiti dogru mu).
  // Gercek minimum ornekleme noktalari ARASINA duser; minimum civarinda
  // egri paraboliktir, dolayisiyla 0.02° adimda ~1e-9 m'lik bir artik
  // kacinilmazdir (fiziksel hata degil, tarama cozunurlugu).
  let minPos = Infinity;
  for (let t = -30; t <= 30; t += 0.02) minPos = Math.min(minPos, pistonPosition(kinOff, t));
  checkTrue('Ofsetli krankta min konum ~0', minPos >= 0 && minPos < 1e-8, `min=${minPos}`);
}

// Sayisal turev kontrolu: kapali form dV/dtheta dogru mu
{
  const h = 1e-5;
  let maxErr = 0;
  for (let t = 5; t < 355; t += 7) {
    const numeric = (cylinderVolume(kin, t + h) - cylinderVolume(kin, t - h)) / (2 * h * Math.PI / 180);
    const analytic = kin.pistonArea * (pistonPosition(kin, t + h) - pistonPosition(kin, t - h)) / (2 * h * Math.PI / 180);
    maxErr = Math.max(maxErr, Math.abs(numeric - analytic));
  }
  checkTrue('dV/dtheta sayisal tutarlilik', maxErr < 1e-9, `hata=${maxErr}`);
}

// ============================================================
section('SUPAP MEKANIZMASI');
// ============================================================

const vt: Valvetrain_Spec = {
  type: 'DOHC',
  intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
  intakeValveDia: 0.0335, exhaustValveDia: 0.029,
  intakeCam: { lift: 0.0088, duration: 233, advertisedDuration: 284, centerline: 110 },
  exhaustCam: { lift: 0.0088, duration: 233, advertisedDuration: 284, centerline: 110 },
  lsa: 110,
  springSeatPressure: 320, springOpenPressure: 780,
  valvetrainMass: 0.115,
  portFlowQuality: 1.0, swirlRatio: 0.6, tumbleRatio: 1.2,
};

// LSA = (110 + 110)/2 = 110 kam derecesi
check('Hesaplanan LSA', computedLSA(vt), 110, 0.1, ' kam-derece');
// Bindirme = (284+284)/2 - 2*110 = 284 - 220 = 64 krank derecesi
check('Supap bindirmesi', valveOverlap(vt), 64, 0.1, ' krank-derece');
// IVC = 110 + 142 - 180 = 72 ABDC
check('Emme supabi kapanmasi', ivcABDC(vt), 72, 0.1, ' ABDC');

// Kalkis profili: merkezde maksimum, uclarda sifir
check('Emme kalkisi @ merkez', intakeLift(intakeCenter(vt), vt) * 1000, 8.8, 0.1, ' mm');
checkTrue('Emme kalkisi @ profil disi = 0',
  intakeLift(intakeCenter(vt) + 160, vt) === 0);
checkTrue('Kalkis her zaman >= 0', (() => {
  for (let t = 0; t < 720; t += 0.5) {
    if (intakeLift(t, vt) < 0 || exhaustLift(t, vt) < 0) return false;
  }
  return true;
})());

// Bindirme TDC'sinde (360 deg) HER IKI supap da acik olmali
checkTrue('Bindirme TDC: emme acik', intakeLift(360, vt) > 0);
checkTrue('Bindirme TDC: egzoz acik', exhaustLift(360, vt) > 0);
// Ateslemede (0 deg) her ikisi de kapali olmali
checkTrue('Ateslemede emme kapali', intakeLift(0, vt) === 0);
checkTrue('Ateslemede egzoz kapali', exhaustLift(0, vt) === 0);

// Profil alan orani: teorik 8/15 = 0.5333
{
  let area = 0;
  const step = 0.1;
  for (let t = 0; t < 720; t += step) area += intakeLift(t, vt) * step;
  const boxArea = vt.intakeCam.lift * vt.intakeCam.advertisedDuration;
  check('Kalkis egrisi alan orani', area / boxArea, 8 / 15, 1);
}

// Akis alani: dusuk kalkista perde, yuksek kalkista bogaz sinirlar
{
  const dv = 0.0335;
  const lowLift = effectiveFlowArea(0.001, dv, 1, 1.0, false);
  const highLift = effectiveFlowArea(0.012, dv, 1, 1.0, false);
  const veryHigh = effectiveFlowArea(0.020, dv, 1, 1.0, false);
  // Dusuk kalkista perde alani: pi*D*L*Cd
  const curtainExpected = Math.PI * dv * 0.001 * (0.68 - 0.42 * (0.001 / dv));
  check('Dusuk kalkis = perde sinirli', lowLift, curtainExpected, 0.1, ' m2');
  // Yuksek kalkista bogaz sinirli ve DOYMUS olmali
  checkTrue('Yuksek kalkis bogazda doyar', Math.abs(highLift - veryHigh) < 1e-12,
    `12mm=${highLift}, 20mm=${veryHigh}`);
  const throatExpected = (Math.PI / 4) * Math.pow(0.85 * dv, 2) * 0.83;
  check('Bogaz sinirli akis alani', veryHigh, throatExpected, 0.1, ' m2');
  checkTrue('Akis alani kalkisla monoton artar', (() => {
    let prev = -1;
    for (let l = 0.0005; l < 0.015; l += 0.0005) {
      const a = effectiveFlowArea(l, dv, 1, 1.0, false);
      if (a < prev - 1e-12) return false;
      prev = a;
    }
    return true;
  })());
}

// Dinamik sikistirma orani: IVC'de basladigi icin statikten DUSUK olmali
{
  const ivcCycle = 540 + ivcABDC(vt); // sikistirma zamaninda BDC = 540
  const dcr = dynamicCompressionRatio(kin, ivcCycle);
  checkTrue('Dinamik CR < statik CR', dcr < geo.compressionRatio, `DCR=${dcr}`);
  check('Dinamik sikistirma orani', dcr, 6.9, 8);
}

// ============================================================
section('YANMA VE VURUNTI');
// ============================================================

// Wiebe: baslangicta 0, sonunda ~0.993 (a=5)
check('Wiebe @ baslangic', wiebeBurnFraction(0, 0, 60), 0, 0.001);
check('Wiebe @ Δθ sonu', wiebeBurnFraction(60, 0, 60), 1 - Math.exp(-5), 0.1);
checkTrue('Wiebe monoton artar', (() => {
  let prev = -1;
  for (let t = -10; t < 80; t += 0.5) {
    const x = wiebeBurnFraction(t, 0, 60);
    if (x < prev - 1e-12) return false;
    prev = x;
  }
  return true;
})());
checkTrue('Wiebe atesleme oncesi sifir', wiebeBurnFraction(-5, 0, 60) === 0);

// Yanma hizi integrali, yanma fraksiyonuyla tutarli olmali
{
  let integral = 0;
  const step = 0.05;
  for (let t = 0; t < 72; t += step) integral += wiebeBurnRate(t, 0, 60) * step;
  check('∫(dxb/dθ)dθ = xb', integral, wiebeBurnFraction(72, 0, 60), 0.5);
}

// Laminer alev hizi: referans kosulda (298K, 1 atm, phi=1) ~0.30 m/s
const gasoline = makeFuel('GASOLINE');
check('Benzin laminer alev hizi @ ref', laminarFlameSpeed(gasoline, 298, 101325, 1.0, 0), 0.283, 5, ' m/s');
// Tepe alev hizi phi ~1.2'de olmali (stokiyometrikte degil!)
{
  let best = 0, bestPhi = 0;
  for (let phi = 0.7; phi < 1.6; phi += 0.01) {
    const s = laminarFlameSpeed(gasoline, 298, 101325, phi, 0);
    if (s > best) { best = s; bestPhi = phi; }
  }
  check('Maks alev hizinin phi degeri', bestPhi, 1.21, 3);
}
// Sicaklik artisi alev hizini artirir, basinc artisi DUSURUR
checkTrue('Sicaklik alev hizini artirir',
  laminarFlameSpeed(gasoline, 700, 101325, 1, 0) > laminarFlameSpeed(gasoline, 298, 101325, 1, 0));
checkTrue('Basinc alev hizini dusurur',
  laminarFlameSpeed(gasoline, 298, 2e6, 1, 0) < laminarFlameSpeed(gasoline, 298, 101325, 1, 0));
// Artik gaz seyreltmesi yavaslatir
checkTrue('Artik gaz alev hizini dusurur',
  laminarFlameSpeed(gasoline, 298, 101325, 1, 0.2) < laminarFlameSpeed(gasoline, 298, 101325, 1, 0));
// E85 benzinden hizli yanar
checkTrue('E85 benzinden hizli yanar',
  laminarFlameSpeed(makeFuel('E85'), 298, 101325, 1, 0) >
  laminarFlameSpeed(gasoline, 298, 101325, 1, 0));

// Otomatik tutusma gecikmesi: sicaklik ve basincla kisalmali
{
  const t1 = autoignitionDelay(95, 2e6, 800);
  const t2 = autoignitionDelay(95, 2e6, 900);
  const t3 = autoignitionDelay(95, 4e6, 800);
  const t4 = autoignitionDelay(110, 2e6, 800);
  checkTrue('Sicaklik gecikmeyi kisaltir', t2 < t1, `${t2} < ${t1}`);
  checkTrue('Basinc gecikmeyi kisaltir', t3 < t1, `${t3} < ${t1}`);
  checkTrue('Yuksek oktan gecikmeyi uzatir', t4 > t1, `${t4} > ${t1}`);
  // Tipik buyukluk mertebesi: 900K/20bar'da milisaniye altı
  checkTrue('Gecikme makul mertebede', t1 > 1e-5 && t1 < 1, `tau=${t1} s`);
}

// ============================================================
section('ISI TRANSFERI (Woschni)');
// ============================================================

{
  // Tipik yanma sonrasi kosul: 60 bar, 2400 K, 15 m/s ortalama piston hizi
  const h = woschniCoefficient(0.086, 60e5, 2400, 15, 'COMBUSTION',
    kin.sweptVolume, 1.5e5, 350, kin.sweptVolume * 0.5, 30e5, 0.6);
  // Literaturde tepe h degeri 2000-8000 W/m2K araligindadir
  checkTrue('Yanmada h makul araliktal', h > 1500 && h < 9000, `h=${h}`);

  // Emme zamaninda cok daha dusuk olmali
  const hIntake = woschniCoefficient(0.086, 0.9e5, 340, 15, 'GAS_EXCHANGE',
    kin.sweptVolume, 1.5e5, 350, kin.sweptVolume * 0.5, 0.9e5, 0.6);
  checkTrue('Emmede h << yanmada h', hIntake < h / 3, `${hIntake} vs ${h}`);
  // Basinc arttikca h artmali
  const hHigh = woschniCoefficient(0.086, 120e5, 2400, 15, 'COMBUSTION',
    kin.sweptVolume, 1.5e5, 350, kin.sweptVolume * 0.5, 30e5, 0.6);
  checkTrue('Basinc h artirir', hHigh > h);
}

// ============================================================
section('YAKIT KIMYASI');
// ============================================================

// Stokiyometrik AFR degerleri formulden hesaplanir — literatur degerleriyle karsilastir
check('Benzin stokiyometrik AFR', gasoline.afrStoich, 14.70, 0.5);
check('E85 stokiyometrik AFR', makeFuel('E85').afrStoich, 9.81, 2);
check('E100 stokiyometrik AFR', makeFuel('E100').afrStoich, 9.00, 1);
check('Metanol stokiyometrik AFR', makeFuel('METHANOL').afrStoich, 6.47, 1);
check('LPG (propan) stokiyometrik AFR', makeFuel('LPG').afrStoich, 15.67, 1);
// Saf oktan kontrolu (C8H18 -> 15.13)
check('Saf oktan (C8H18) AFR', stoichiometricAFR(8, 18, 0), 15.13, 0.5);

// RON ezildiginde hassasiyet korunmali
{
  const f98 = makeFuel('GASOLINE', 98);
  check('98 RON benzin MON', f98.mon, 88, 0.1);
  check('98 RON benzin RON', f98.ron, 98, 0.1);
}

// E85 ayni hava icin daha fazla yakit ister (~%50 daha fazla kutle)
{
  const ratio = gasoline.afrStoich / makeFuel('E85').afrStoich;
  check('E85 / benzin yakit kutlesi orani', ratio, 1.50, 3);
}

// ============================================================
section('ENERJI DATUMU TUTARLILIGI (regresyon)');
// ============================================================
//
// Bu testler, gelistirme sirasinda bulunan ve sessizce yanlis sonuc
// ureten hatalarin geri gelmemesi icin var.

{
  // h − u = R·T bagintisi HER sicaklikta ve HER bilesimde saglanmali.
  // Saglanmazsa giren dolgunun akis isi (pistonu iten enerji) kaybolur;
  // emme stroku boyunca dolgu manifold sicakliginin altina soguyup
  // hacimsel verim ~%10 sisirilir.
  const comps: [string, Composition][] = [
    ['hava', airComposition()],
    ['yanmis-stok', combustionProducts(8, 15.5, 0, 1.0).composition],
    ['yanmis-zengin', combustionProducts(8, 15.5, 0, 1.25).composition],
  ];
  let worst = 0;
  for (const [, c] of comps) {
    for (const T of [300, 500, 900, 1500, 2500]) {
      const rel = Math.abs(
        (sensibleEnthalpy(c, T) - sensibleInternalEnergy(c, T) - mixtureR(c) * T) /
        (mixtureR(c) * T),
      );
      worst = Math.max(worst, rel);
    }
  }
  checkTrue('h − u = R·T (tum bilesim ve sicakliklarda)', worst < 1e-9, `en buyuk sapma=${worst}`);

  // Duyulur enerjiler referans sicaklikta SIFIR olmali — yani olusum
  // entalpisi tasinmamali. Tasinirsa yanmis gazin −3 MJ/kg'lik datumu
  // taze dolgunun enerjisine karisir.
  for (const [label, c] of comps) {
    check(`Duyulur u(T_ref) = 0 (${label})`, sensibleInternalEnergy(c, 298.15), 0, 0);
  }
  // Yanmis gazin MUTLAK ic enerjisi cok negatiftir (olusum entalpisi) —
  // duyulur olanla karistirilmamali; test bu ayrimin var oldugunu dogrular.
  const burned = combustionProducts(8, 15.5, 0, 1.0).composition;
  checkTrue('Mutlak ic enerji olusum entalpisi tasir',
    mixtureInternalEnergy(burned, 298.15) < -1e6,
    `${mixtureInternalEnergy(burned, 298.15)}`);

  // Duyulur enerji sicaklikla monoton artmali
  checkTrue('Duyulur u sicaklikla artar', (() => {
    for (const [, c] of comps) {
      let prev = -Infinity;
      for (let T = 250; T <= 3000; T += 50) {
        const u = sensibleInternalEnergy(c, T);
        if (u < prev) return false;
        prev = u;
      }
    }
    return true;
  })());
}

// ============================================================
section('YANMA ZAMANLAMASI (regresyon)');
// ============================================================
{
  // Wiebe egrisinin karakteristik noktalari — burnDurations bunlara
  // dayanarak delay/duration bildirir. Kaymalari sessiz hataya yol acar.
  const total = 60;
  const at = (frac: number) => {
    for (let t = 0; t < total * 1.2; t += 0.01) {
      if (wiebeBurnFraction(t, 0, total) >= frac) return t / total;
    }
    return NaN;
  };
  check('Wiebe %10 yanma noktasi (u)', at(0.10), 0.281, 2);
  check('Wiebe %50 yanma noktasi (u)', at(0.50), 0.518, 2);
  check('Wiebe %90 yanma noktasi (u)', at(0.90), 0.772, 2);

  // Yanma suresi 86 mm capli bir motorda 3500 rpm'de ~55-70° olmali.
  // Cok uzun cikarsa cozucu ateslemeyi gercek disi avansa kacirir.
  const sT = turbulentFlameSpeed(0.90, 10.1);
  const bd = burnDurations(sT, 0.086, 3500, 0.10);
  checkTrue('S_T makul araliktal (12-25 m/s)', sT > 12 && sT < 25, `S_T=${sT}`);
  checkTrue('Yanma suresi makul (45-80 derece)', bd.total > 45 && bd.total < 80,
    `toplam=${bd.total}`);
  // delay + duration toplam icinde kalmali
  checkTrue('delay/duration toplamin icinde', bd.delay + bd.duration < bd.total);

  // Krank derecesi cinsinden yanma suresi devirle KABACA SABIT kalmali:
  // turbulans piston hiziyla, o da devirle orantilidir.
  const d2000 = burnDurations(turbulentFlameSpeed(0.9, 10.1 * 2000 / 3500), 0.086, 2000, 0.1).total;
  const d7000 = burnDurations(turbulentFlameSpeed(0.9, 10.1 * 7000 / 3500), 0.086, 7000, 0.1).total;
  checkTrue('Yanma suresi devirle asiri degismez', d7000 / d2000 < 2.0,
    `${d2000.toFixed(1)}° @2000 → ${d7000.toFixed(1)}° @7000`);
}

// ============================================================
console.log(`\n${'='.repeat(52)}`);
console.log(`SONUC:  ${passed} basarili, ${failed} basarisiz`);
if (failed > 0) {
  console.log('\nBASARISIZ TESTLER:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
} else {
  console.log('Fizik cekirdegi dogrulandi.');
}
