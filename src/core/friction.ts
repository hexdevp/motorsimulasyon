/**
 * Mekanik surtunme ve parazitik kayiplar
 *
 * Bilesen bazli model (Patton–Nitschke–Heywood, SAE 890836 yapisinda).
 * Tek bir "FMEP sabiti" yerine parcalara ayirmanin sebebi: kullanici
 * segman gerginligini dusurdugunde veya daha ince yag koydugunda
 * FARKI GORMELI. Ayrica raporda "gucun nereye gittigi" dokumu cikar.
 *
 * Tum bilesenler FMEP (surtunme ortalama efektif basinci, Pa) olarak
 * dondurulur; boylece dogrudan IMEP'ten cikarilabilir.
 */

import type { EngineConfig, FrictionBreakdown } from './types';
import type { CrankKinematics } from './geometry';
import { clamp } from './gas';

export type { FrictionBreakdown };

/**
 * Yag dinamik viskozitesi (Pa·s).
 *
 * mu(T) = mu_100 · exp[ B·(1/T − 1/373) ],  B ≈ 4000 K
 *
 * Ustel bagimlilik onemli: 90°C yerine 130°C yagda calisan bir motorun
 * yatak surtunmesi yaklasik yariya iner — ama film kalinligi da azalir,
 * yani sinira yaklasilir. Model bu takasi gosterir.
 */
export function oilViscosity(sae: number, tempK: number): number {
  // SAE sinifina gore 100°C kinematik viskozite (cSt)
  const nu100 = clamp(0.375 * sae - 0.5, 3, 30);
  const rho = 850; // kg/m³
  const mu100 = (nu100 * 1e-6) * rho; // Pa·s
  const B = 4000;
  return mu100 * Math.exp(B * (1 / clamp(tempK, 250, 450) - 1 / 373));
}

/**
 * Surtunme dokumu (FMEP, Pa).
 *
 * @param peakPressure Tepe silindir basinci (Pa) — segman yukunu belirler
 * @param meanPistonSpeed Ortalama piston hizi (m/s)
 * @param peakSideForce Tepe etek yan kuvveti (N)
 * @param oilPressure Galeri basinci (Pa) — yag pompasi gucu icin
 * @param oilFlow Pompa debisi (m³/s)
 * @param superchargerPower Mekanik koruk tahrik gucu (W), turboda 0
 */
export function frictionBreakdown(
  cfg: EngineConfig,
  k: CrankKinematics,
  rpm: number,
  peakPressure: number,
  meanPistonSpeed: number,
  peakSideForce: number,
  oilPressure = 4e5,
  oilFlow = 3e-4,
  superchargerPower = 0,
): FrictionBreakdown {
  const m = cfg.mechanical;
  const B = cfg.geometry.bore;
  const mu = oilViscosity(m.oilGrade, m.oilTemp);
  // Referans viskozite (SAE 30 @ 100°C) — model bununla olceklenir
  const muRef = oilViscosity(30, 373);
  const muRatio = mu / muRef;
  const nCyl = cylCount(cfg);

  /**
   * Hidrodinamik surtunme terimlerinde kullanilan ETKIN viskozite.
   *
   * Petroff bagintisi es-merkezli muylu varsayar ve surtunmenin
   * viskoziteyle DOGRUSAL arttigini soyler. Gercekte viskozite
   * yukseldikce yag filmi kalinlasir, eksantriklik duser ve surtunme
   * viskoziteden daha yavas artar. Dogrusal varsayim, 20°C'deki soguk
   * bir motorda surtunmeyi 18 kat gosterir; olculen deger 2-3 kattir.
   * 0.7 ussu bu doyumu temsil eder.
   */
  const muEff = muRef * Math.pow(Math.max(muRatio, 1e-3), 0.7);
  const omega = (rpm * 2 * Math.PI) / 60;
  const totalDisp = k.sweptVolume * nCyl;

  /**
   * Gidip gelen bir surtunme kuvvetini FMEP'e cevirir.
   *
   * Piston bir 4 zamanli cevrimde 4 strok yol alir:
   *   W = F · 4S    →    FMEP = W/V_strok = 4·F·S/(A_p·S) = 4F/A_p
   * Strok sadelesir; FMEP yalnizca kuvvete ve piston alanina baglidir.
   */
  const recipFMEP = (force: number) => (4 * force) / k.pistonArea;

  /** Bir donme momentini FMEP'e cevirir (cevrim = 2 tur = 4π radyan) */
  const torqueFMEP = (torque: number) => (4 * Math.PI * torque) / Math.max(totalDisp, 1e-9);

  /** Bir mekanik gucu FMEP'e cevirir */
  const powerFMEP = (watts: number) =>
    watts / Math.max((totalDisp * rpm) / (2 * 60), 1e-9);

  // --- 1. Segman gerginligi surtunmesi ---
  // Yay gerginliginden gelen, gaz basincindan BAGIMSIZ kisim. Dusuk
  // devirde sinir yaglama rejimi baskin oldugu icin goreli olarak daha
  // buyuktur; devirle birlikte hidrodinamik filme gecilir ve azalir.
  const ringTension =
    356 * m.ringTension * (1 + 1000 / Math.max(rpm, 300)) / (B * B);

  // --- 2. Gaz yuklu segman surtunmesi ---
  // Yanma basinci segmanlari silindir cidarina bastirir. Turbo/yuksek
  // sikistirmali motorlarda surtunmenin neden arttiginin ana sebebi budur.
  const ringGasLoaded =
    0.00375 * peakPressure * Math.pow(clamp(muRatio, 0.3, 3), 0.25);

  // --- 3. Piston etegi ---
  // Iki bilesen: yan kuvvete bagli sinir/karma yaglama surtunmesi ve
  // etek-cidar arasindaki viskoz kayma.
  const contactArea = 0.25 * Math.PI * B * (0.55 * B); // yuklu etek bolgesi
  const filmThickness = 20e-6;
  const viscousForce = ((muEff * meanPistonSpeed) / filmThickness) * contactArea;
  // Hidrodinamik rejimde surtunme katsayisi 0.005-0.02 arasindadir.
  // Tepe yan kuvvet cok kisa surer; cevrim ortalamasi ~%30'udur.
  const muCoeff = 0.008 * Math.pow(clamp(muRatio, 0.3, 3), 0.5);
  const skirtForce = viscousForce + muCoeff * 0.3 * Math.abs(peakSideForce);
  const pistonSkirt = recipFMEP(skirtForce);

  // --- 4. Yataklar (ana + biyel) — Petroff hidrodinamik surtunmesi ---
  //   T = 2π·μ·ω·R³·L / c        (R: yaricap, L: genislik, c: radyal bosluk)
  // c/R = 0.001 ve L/D = 0.28 tipik degerleriyle sadelesince:
  //   T = 439.8 · μ · ω · D³
  const clearanceRatio = 1e-3;
  const bearingLD = 0.28;
  const perBearing = (D: number) =>
    (2 * Math.PI * muEff * omega * Math.pow(D / 2, 3) * (bearingLD * D)) /
    (clearanceRatio * (D / 2));
  const nMains = nCyl + 1;
  const bearingTorque =
    nMains * perBearing(m.mainBearingDia) + nCyl * perBearing(m.rodBearingDia);
  // Gaz yukunun yataklara bindirdigi ek karma-yaglama surtunmesi
  const bearings = torqueFMEP(bearingTorque) + 0.0004 * peakPressure;

  // --- 5. Supap mekanizmasi ---
  // Yayin acarken yaptigi isin bir kismi kapanirken geri kazanilmaz;
  // ustune kam mili yataklarinin viskoz surtunmesi biner. Mimari
  // belirleyici: OHV'de itici cubuk + kulbutor, DOHC'de dogrudan tahrik.
  const archFactor =
    cfg.valvetrain.type === 'OHV' ? 1.45 : cfg.valvetrain.type === 'SOHC' ? 1.15 : 1.0;
  const nValvesTotal =
    (cfg.valvetrain.intakeValvesPerCyl + cfg.valvetrain.exhaustValvesPerCyl) * nCyl;
  const springAvg =
    0.5 * (cfg.valvetrain.springSeatPressure + cfg.valvetrain.springOpenPressure);
  // Acilma + kapanma boyunca yapilan isin ~%15'i geri kazanilamaz
  const springWork = nValvesTotal * springAvg * cfg.valvetrain.intakeCam.lift * 2 * 0.15;
  const camViscous = powerFMEP(2.4e-5 * muRatio * rpm * rpm * nCyl / 6);
  const valvetrain = archFactor * (springWork / Math.max(totalDisp, 1e-9) + camViscous);

  // --- 6. Yag pompasi ---
  // Guc = basinc × debi / verim. Her ikisi de devirle artar, ustelik
  // soguk yagda (yuksek μ) basinc tahliye valfine dayanir ve pompa
  // bosuna guc harcar. Soguk motorda kaybin buyudugu yerlerden biri.
  const oilPumpPower = (oilPressure * oilFlow) / 0.62;
  const oilPump = powerFMEP(oilPumpPower);

  // --- 7. Su pompasi ---
  // Santrifuj pompa: guc devrin kubuyle artar.
  const waterPump = powerFMEP(
    32 * Math.pow(rpm / 3000, 3) * (totalDisp / 3e-3),
  );

  // --- 8. Alternator ---
  // Elektrik yuku mekanik gucten cekilir; alternator verimi ~%55.
  const alternator = powerFMEP(m.accessoryLoad / 0.55);

  // --- 9. Windage (krank yag calkalama) ---
  // Krank mili karterdeki yag sisi icinde doner. Kayip devrin KUBUYLE
  // ve krank yaricapinin dorduncu kuvvetiyle artar; bu yuzden dusuk
  // devirde ihmal edilebilirken yuksek devirde bir V8'de 7-10 HP'ye
  // ulasir. Yaris motorlarinda windage tepsisi ve kuru karter
  // kullanilmasinin sebebi tam olarak budur.
  const omega3 = Math.pow(omega, 3);
  const windagePower =
    4.29 * nCyl * omega3 * Math.pow(k.a, 4) * B * Math.pow(clamp(muRatio, 0.4, 3), 0.25);
  const windage = powerFMEP(windagePower);

  // --- 10. Mekanik koruk (supersarj) tahriki ---
  // Turbo egzoz enerjisini kullanir ve krank milinden guc CEKMEZ
  // (bedeli karsi basinc olarak pompalama kaybinda gorunur).
  const superchargerDrive = powerFMEP(superchargerPower);

  const total =
    ringTension + ringGasLoaded + pistonSkirt + bearings + valvetrain +
    oilPump + waterPump + alternator + windage + superchargerDrive;

  return {
    ringTension, ringGasLoaded, pistonSkirt, bearings, valvetrain,
    oilPump, waterPump, alternator, windage, superchargerDrive,
    total: Math.max(total, 0),
  };
}

function cylCount(cfg: EngineConfig): number {
  const mm = cfg.layout.match(/\d+/);
  return mm ? parseInt(mm[0], 10) : 4;
}

/**
 * Surtunme gucu (W) — FMEP'ten.
 *   P = FMEP · V_toplam · N / (2 · 60)      [4 zamanli]
 */
export function frictionPower(fmep: number, totalDisplacement: number, rpm: number): number {
  return (fmep * totalDisplacement * rpm) / (2 * 60);
}

/**
 * Yatak yuku degerlendirmesi.
 *
 * Biyel yatagi projeksiyon alanina dusen basinc, dayanim sinirinin
 * ana gostergesidir. Modern trimetal yataklar ~55-70 MPa'ya kadar
 * dayanir; bunun uzeri yatak omrunu hizla kisaltir.
 */
export function bearingLoadAssessment(
  peakRodForce: number,
  rodBearingDia: number,
): { projectedPressure: number; severity: 'ok' | 'high' | 'critical' } {
  const bearingLength = 0.28 * rodBearingDia;
  const projectedArea = rodBearingDia * bearingLength;
  const p = Math.abs(peakRodForce) / Math.max(projectedArea, 1e-9);
  const severity = p > 70e6 ? 'critical' : p > 55e6 ? 'high' : 'ok';
  return { projectedPressure: p, severity };
}

/**
 * Yagin sinir sicakligi kontrolu.
 * ~130°C uzerinde oksidasyon hizlanir, 150°C uzerinde film kopar.
 */
export function oilCondition(oilTempK: number): 'ok' | 'hot' | 'breakdown' {
  const c = oilTempK - 273.15;
  if (c > 150) return 'breakdown';
  if (c > 130) return 'hot';
  return 'ok';
}

/**
 * Minimum yag film kalinligi gostergesi (Stribeck sayisi benzeri).
 * Dusuk deger = sinir yaglama = metal-metal temas riski.
 */
export function hydrodynamicNumber(mu: number, rpm: number, bearingPressure: number): number {
  const N = rpm / 60;
  return (mu * N) / Math.max(bearingPressure, 1e3);
}
