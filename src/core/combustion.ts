/**
 * Yanma modeli, alev yayilimi ve vurunti (knock)
 *
 * Yanma hizi burada TAHMIN EDILIR, kullanicidan alinmaz. Zincir soyle:
 *   karisim + basinc + sicaklik  →  laminer alev hizi (Metghalchi-Keck)
 *   + turbulans yogunlugu        →  turbulansli alev hizi
 *   + yanma odasi boyutu         →  yanma suresi (krank derecesi)
 *   + Wiebe fonksiyonu           →  isi birakma egrisi
 *
 * Bu yuzden strok/cap oranini, swirl'i veya RPM'i degistirdiginizde
 * yanma suresi kendiliginden degisir — elle girilen bir "burn duration"
 * parametresi yoktur.
 */

import type { FuelSpec } from './types';
import { clamp } from './gas';

/**
 * Wiebe isi birakma fonksiyonu — yanmis kutle fraksiyonu.
 *
 *   xb = 1 − exp[ −a · ((θ − θ_ates)/Δθ)^(m+1) ]
 *
 * a = 5 secildi: Δθ sonunda yakitin %99.3'u yanmis olur.
 * m = 2 kivilcim atesli motorlar icin standart sekil faktorudur
 * (yavas baslar, ortada hizlanir, sonda soner — gercek basinc
 * izleriyle iyi ortusur).
 */
export const WIEBE_A = 5.0;
export const WIEBE_M = 2.0;

export function wiebeBurnFraction(
  thetaDeg: number,
  startDeg: number,
  durationDeg: number,
): number {
  if (durationDeg <= 0) return thetaDeg >= startDeg ? 1 : 0;
  const u = (thetaDeg - startDeg) / durationDeg;
  if (u <= 0) return 0;
  if (u >= 1.2) return 1;
  return 1 - Math.exp(-WIEBE_A * Math.pow(u, WIEBE_M + 1));
}

/** Wiebe fonksiyonunun turevi dxb/dtheta (1/derece) */
export function wiebeBurnRate(
  thetaDeg: number,
  startDeg: number,
  durationDeg: number,
): number {
  if (durationDeg <= 0) return 0;
  const u = (thetaDeg - startDeg) / durationDeg;
  if (u <= 0 || u >= 1.2) return 0;
  const p = Math.pow(u, WIEBE_M);
  return (
    (WIEBE_A * (WIEBE_M + 1) * p * Math.exp(-WIEBE_A * u * p)) / durationDeg
  );
}

// ============================================================
// LAMINER ALEV HIZI — Metghalchi & Keck korelasyonu
// ============================================================

interface FlameParams {
  /** Tepe laminer hiz (m/s) */
  Bm: number;
  /** Tepe hizin olustugu esdegerlik orani */
  phiM: number;
  /** Parabolun acikligi (m/s) */
  Bphi: number;
}

function flameParams(fuel: FuelSpec): FlameParams {
  switch (fuel.type) {
    case 'METHANOL':
      return { Bm: 0.369, phiM: 1.11, Bphi: -0.539 };
    case 'E100':
      return { Bm: 0.465, phiM: 1.13, Bphi: -0.601 };
    case 'E85':
      // Benzin ve etanol arasi agirlikli — etanola yakin
      return { Bm: 0.425, phiM: 1.15, Bphi: -0.58 };
    case 'LPG':
      return { Bm: 0.34, phiM: 1.08, Bphi: -0.5 };
    case 'RACE_GAS':
      // Yuksek oktan = daha yavas alev; bu bir bedeldir, bedava oktan yoktur
      return { Bm: 0.285, phiM: 1.2, Bphi: -0.52 };
    case 'GASOLINE':
    default:
      return { Bm: 0.305, phiM: 1.21, Bphi: -0.549 };
  }
}

/**
 * Laminer alev hizi (m/s).
 *
 *   S_L = S_L0 · (T_u/298)^α · (p/p_ref)^β · (1 − 2.1·f_artik)
 *   S_L0 = B_m + B_φ·(φ − φ_m)²
 *   α = 2.18 − 0.8(φ − 1)
 *   β = −0.16 + 0.22(φ − 1)
 *
 * Dikkat edilecek nokta: β NEGATIFTIR. Yani basinc arttikca laminer alev
 * hizi DUSER. Turbo motorlarda yanmanin neden daha uzun surdugu ve
 * ateslemenin neden avans istemedigi buradan gelir.
 *
 * @param Tu Yanmamis gaz sicakligi (K)
 * @param p Silindir basinci (Pa)
 * @param phi Esdegerlik orani
 * @param residualFraction Artik gaz fraksiyonu (0-1)
 */
export function laminarFlameSpeed(
  fuel: FuelSpec,
  Tu: number,
  p: number,
  phi: number,
  residualFraction: number,
): number {
  const fp = flameParams(fuel);
  const dphi = phi - fp.phiM;
  const sl0 = Math.max(fp.Bm + fp.Bphi * dphi * dphi, 0.02);
  const alpha = 2.18 - 0.8 * (phi - 1);
  const beta = -0.16 + 0.22 * (phi - 1);
  const P_REF = 101325;
  const dilution = clamp(1 - 2.1 * residualFraction, 0.15, 1.0);
  const sl =
    sl0 *
    Math.pow(Math.max(Tu, 200) / 298, alpha) *
    Math.pow(Math.max(p, 1000) / P_REF, beta) *
    dilution;
  return clamp(sl, 0.01, 12);
}

/**
 * Turbulans yogunlugu u' (m/s).
 *
 * Silindir ici turbulansin olcegi ortalama piston hiziyla orantilidir.
 * Modern dort supapli kafalarda asil turbulans kaynagi TUMBLE'dir:
 * sikistirma sonunda buyuk olcekli tumble girdabi cokup turbulansa
 * donusur. Bu yuzden tumble katsayisi swirl'inkinden belirgin buyuktur.
 * Squish (quench) alani da TDC yakininda ek carpanti uretir.
 *
 * Kalibrasyon: 86 mm capli, tumble 1.3 olan bir motorda 3500 rpm'de
 * u' ≈ 11 m/s cikar; bu, yanma suresini literaturdeki 50-60° krank
 * araligina oturtan degerdir.
 */
export function turbulenceIntensity(
  meanPistonSpeed: number,
  swirlRatio: number,
  tumbleRatio: number,
  squishAreaRatio: number,
): number {
  const base = 0.55 * meanPistonSpeed;
  const chargeMotion = 1 + 0.25 * swirlRatio + 0.55 * tumbleRatio;
  const squish = 1 + 0.35 * squishAreaRatio;
  return base * chargeMotion * squish;
}

/**
 * Turbulansli alev hizi (m/s).
 *
 *   S_T = S_L · [ 1 + C · (u'/S_L)^0.7 ]
 *
 * Ussun 1 degil 0.7 olmasi onemli: turbulansi ikiye katlamak alev hizini
 * ikiye katlamaz.
 *
 * C = 3.5 kalibrasyonu su hedefe gore yapildi: 86 mm capli bir motorda
 * 3500 rpm'de S_T ≈ 18 m/s → toplam yanma suresi ≈ 55° krank. Olcum
 * verileriyle ortusen deger budur. C = 1.9 gibi dusuk bir degerde yanma
 * 125°'ye uzuyor ve cozucu bunu telafi etmek icin atesleme avansini
 * gercek disi bicimde 50°+ oteliyor.
 *
 * Not: krank derecesi cinsinden yanma suresi devirle neredeyse SABIT
 * kalir; cunku u' piston hiziyla, o da devirle orantilidir. Model bu
 * onemli davranisi kendiliginden uretir.
 */
export function turbulentFlameSpeed(laminar: number, uPrime: number): number {
  const C = 3.5;
  const ratio = uPrime / Math.max(laminar, 1e-3);
  return laminar * (1 + C * Math.pow(Math.max(ratio, 0), 0.7));
}

/**
 * Yanma suresi (krank derecesi).
 *
 * Alev, bujiden yanma odasinin en uzak noktasina kadar yol alir.
 * Ortalama yol ~ cap/2 (merkezi buji) olup cok supapli kafalarda
 * buji merkeze daha yakindir.
 *
 * DIKKAT — Wiebe ile birlikte kullanimi:
 * `total`, ateslemeden yanmanin bitisine kadar olan TOPLAM suredir ve
 * dogrudan Wiebe'nin Δθ'si olarak kullanilir; Wiebe'nin BASLANGICI da
 * bujinin atesledigi andir. Uzerine ayrica bir "gecikme" eklenmemelidir:
 * a=5, m=2 Wiebe egrisi cekirdek olusum evresini zaten kendi sekliyle
 * uretir (%10 yanma u≈0.28'de, %50 yanma u≈0.52'de gerceklesir).
 *
 * Gecikmeyi ayrica eklemek yanmayi ~%22 geciktirir; cozucu bunu telafi
 * etmek icin ateslemeyi asiri avansa kacirir (LS3'te 26° yerine 55°) ve
 * tepe basinci gercek disi sekilde 90 bar'a cikar.
 *
 * @returns delay/duration bilgilendirme amaclidir (rapor icin),
 *          Wiebe'ye yalnizca `total` verilir.
 */
export function burnDurations(
  flameSpeed: number,
  bore: number,
  rpm: number,
  sparkPlugOffset: number,
): { delay: number; duration: number; total: number } {
  const travelDistance = (bore / 2) * (1 + sparkPlugOffset);
  const omegaDegPerSec = rpm * 6; // derece/saniye
  const burnTimeSec = travelDistance / Math.max(flameSpeed, 0.05);
  const totalDeg = clamp(burnTimeSec * omegaDegPerSec, 8, 140);

  // Wiebe (a=5, m=2) egrisinden turetilen karakteristik noktalar:
  //   xb = 1 − exp(−5u³)  →  %10: u = 0.281,  %90: u = 0.772
  const delay = totalDeg * 0.281;              // atesleme → %10 yanma
  const duration = totalDeg * (0.772 - 0.281); // %10 → %90 yanma
  return { delay, duration, total: totalDeg };
}

// ============================================================
// VURUNTI (KNOCK)
// ============================================================

/**
 * Otomatik tutusma gecikmesi tau (saniye) — Douaud & Eyzat korelasyonu.
 *
 *   tau [ms] = 17.68 · (ON/100)^3.402 · p[atm]^(−1.7) · exp(3800/T)
 *
 * Yanmamis gaz "son gaz" (end gas) bolgesindedir; alev oraya varmadan
 * once kendiliginden tutusursa vurunti olur.
 */
export function autoignitionDelay(octaneNumber: number, pressurePa: number, tempK: number): number {
  const pAtm = Math.max(pressurePa / 101325, 0.05);
  const tauMs =
    17.68 *
    Math.pow(octaneNumber / 100, 3.402) *
    Math.pow(pAtm, -1.7) *
    Math.exp(3800 / Math.max(tempK, 300));
  return tauMs / 1000;
}

/**
 * Vurunti modeli olcek katsayisi.
 *
 * Douaud-Eyzat korelasyonu tau'nun DOGRU EGILIMINI verir (basinc,
 * sicaklik ve oktana bagimlilik), ama mutlak esigi uygulamaya gore
 * kalibrasyon ister — ham haliyle "K = 1'de vurunti" kabul edilirse
 * neredeyse her benzinli motor vuruyor cikar.
 *
 * Bu deger TAHMIN DEGILDIR. Sekiz bilinen calisma noktasinda, o
 * motorlarin FABRIKA tam gaz avansinda integralin aldigi degere
 * bakilarak belirlenmistir (fabrika avansi zaten vurunti sinirinda
 * secilmis bir degerdir, yani "sinirda vurunti" demektir):
 *
 *   LS3      @3500 → 2.01      2JZ-GTE  @4500 → 3.02
 *   LS3      @5500 → 1.22      EJ257    @4000 → 2.68
 *   K20A     @6000 → 2.52      Coyote   @5000 → 2.81
 *   K20A     @3000 → 3.90      Viper V10@4000 → 1.81
 *
 *   geometrik ortalama = 2.37   (test/knock-cal.ts ile yeniden uretilebilir)
 *
 * Sacilmanin 3 kattan az olmasi — 6.2 L itici cubuklu V8'den turbo
 * boxer'a kadar uzanan bir yelpazede — korelasyonun sekil olarak dogru
 * oldugunun, yalnizca olceginin kaymis oldugunun gostergesidir.
 *
 * Bolme sonrasi K = 1.0 "sinirda vurunti" anlamina gelir; kullanici
 * ignition.knockThreshold ile emniyet payi birakabilir (0.85 muhafazakar,
 * 1.15 agresif).
 */
export const KNOCK_SCALE = 2.37;

/**
 * Vurunti integrali adimi. Cevrim boyunca toplanir; 1.0'a ulasirsa
 * son gaz kendiliginden tutusmus, yani motor vuruyor demektir.
 *
 *   K = (1/KNOCK_SCALE) · ∫ dt / tau(p, T)
 *
 * @param dtSec Bu adimda gecen sure (s)
 */
export function knockIntegralStep(
  octaneNumber: number,
  pressurePa: number,
  endGasTempK: number,
  dtSec: number,
): number {
  const tau = autoignitionDelay(octaneNumber, pressurePa, endGasTempK);
  return dtSec / (Math.max(tau, 1e-9) * KNOCK_SCALE);
}

/**
 * Son gaz (end gas) sicakligi.
 *
 * Yanmamis karisim, yanan kismin genlesmesiyle IZENTROPIK olarak sikisir.
 * Bu, kutle-ortalamali sicakliktan belirgin farklidir ve vuruntiyu
 * belirleyen asil sicakliktir. Ortalama sicakligi kullanan modeller
 * vuruntiyu sistematik olarak az tahmin eder.
 *
 * @param T_ivc IVC anindaki sicaklik (K)
 * @param p_ivc IVC anindaki basinc (Pa)
 * @param p Anlik basinc (Pa)
 * @param gamma Yanmamis gazin ozgul isi orani
 */
export function endGasTemperature(
  T_ivc: number,
  p_ivc: number,
  p: number,
  gamma: number,
): number {
  return T_ivc * Math.pow(Math.max(p, 1) / Math.max(p_ivc, 1), (gamma - 1) / gamma);
}

/**
 * Son gazin bir adimdaki sicaklik degisimi — sikisma VE cidara isi kaybi.
 *
 *   dT = T·[(γ−1)/γ]·(dp/p)  −  (T − T_cidar)·dt/τ_isil
 *
 * Ikinci terim neden sart:
 * Saf izentropik varsayim son gazin cidara isi vermedigini kabul eder.
 * Bu yalnizca YUKSEK devirde makuldur. Dusuk devirde bir krank derecesi
 * cok daha uzun surer ve son gaz soguyacak vakit bulur.
 *
 * Isi kaybi ihmal edilirse vurunti integrali kabaca 1/devir ile olceklenir;
 * model 1500 rpm'de gercek disi bir vurunti gorur ve cozucu ateslemeyi
 * 2°'ye kadar geri ceker. Halbuki gercek motorlar o bolgede 15-25°
 * avansla calisir. Dusuk devir vurunti davranisini dogru veren sey bu terimdir.
 *
 * τ_isil gercek Woschni katsayisindan hesaplanir:
 *   τ = m_songaz · cv / (h · A_songaz)
 * Tipik degeri 5-10 ms cikar — yani dusuk devir cevrim suresiyle ayni
 * mertebede, tam da etkinin onemli oldugu yerde.
 */
export function endGasStep(
  tempEndGas: number,
  pressure: number,
  dPressure: number,
  wallTemp: number,
  dtSec: number,
  gammaUnburned: number,
  thermalTimeConstant: number,
): number {
  const compression =
    (tempEndGas * ((gammaUnburned - 1) / gammaUnburned) * dPressure) /
    Math.max(pressure, 1);
  const cooling =
    ((tempEndGas - wallTemp) * dtSec) / Math.max(thermalTimeConstant, 1e-4);
  return compression - cooling;
}

/**
 * Yakit tipinin efektif oktan degeri.
 * Vurunti direncinde AKI (=(RON+MON)/2) yerine RON agirlikli bir
 * karisim kullaniyoruz; supersarjli motorlarda MON daha belirleyicidir.
 */
export function effectiveOctane(fuel: FuelSpec, boosted: boolean): number {
  return boosted ? 0.4 * fuel.ron + 0.6 * fuel.mon : 0.7 * fuel.ron + 0.3 * fuel.mon;
}

/**
 * Buharlasma ile sarj sogutma (K cinsinden sicaklik dususu).
 *
 * E85'in neden bu kadar vurunti direncli oldugunun buyuk kismi budur:
 * gizli isisi benzinin ~2.5 kati ve stokiyometrik AFR'si dusuk oldugu
 * icin ayni hava kutlesine cok daha fazla yakit buharlasir.
 *
 * @param directInjection DI'da buharlasma silindir icinde olur — tam etki
 */
export function chargeCoolingDrop(
  fuel: FuelSpec,
  afr: number,
  cpMixture: number,
  directInjection: boolean,
): number {
  // 1 kg hava basina yakit kutlesi
  const fuelPerAir = 1 / Math.max(afr, 1);
  const heatAbsorbed = fuelPerAir * fuel.latentHeat; // J / kg hava
  // Port enjeksiyonda buharlasmanin bir kismi manifold cidarindan isi ceker
  const effectiveness = directInjection ? 1.0 : 0.65;
  return (heatAbsorbed * effectiveness) / Math.max(cpMixture, 100);
}
