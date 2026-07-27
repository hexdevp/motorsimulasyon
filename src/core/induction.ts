/**
 * Induksiyon sistemi — asiri doldurma, intercooler, emme/egzoz ayari
 *
 * KAPSAM NOTU: Tam 1D gaz dinamigi (karakteristikler yontemiyle basinc
 * dalgasi yayilimi) bu modelde YOKTUR. Onun yerine dalga etkileri
 * toplulastirilmis (lumped) rezonans tepkisi olarak modellenmistir:
 * Helmholtz ayar devri hesaplanir ve VE'ye o devir civarinda bir tepe
 * bindirilir. Gercek runner uzunlugu taramalarinda yon dogru, mutlak
 * genlik yaklasiktir.
 */

import type { EngineConfig, Induction, Ambient } from './types';
import { clamp } from './gas';

/** Ses hizi (m/s) */
export function speedOfSound(tempK: number, gamma = 1.4, R = 287): number {
  return Math.sqrt(gamma * R * Math.max(tempK, 100));
}

/** Rakimdan atmosfer basinci (Pa) — barometrik formul */
export function pressureAtAltitude(altitudeM: number, seaLevelPa = 101325): number {
  return seaLevelPa * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
}

// ============================================================
// ASIRI DOLDURMA
// ============================================================

export interface BoostState {
  /** Manifold mutlak basinci (Pa) */
  map: number;
  /** Kompresor cikis sicakligi (K) */
  compressorOutletTemp: number;
  /** Intercooler sonrasi emme havasi sicakligi (K) */
  iat: number;
  /** Basinc orani */
  pressureRatio: number;
  /** Kompresoru cevirmek icin harcanan guc (W) — supersarj icin */
  compressorPower: number;
}

/**
 * Kompresor cikis sicakligi.
 *
 *   T_out = T_in · { 1 + [ PR^((γ−1)/γ) − 1 ] / η_izentropik }
 *
 * Bu, turbo motorlardaki vurunti probleminin kokudur: 2 bar basinc
 * oraninda %70 verimli bir kompresor emme havasini 20°C'den ~100°C'ye
 * cikarir. Intercooler olmadan yuksek basinc kullanilamamasinin sebebi budur.
 */
export function compressorOutlet(
  inletTemp: number,
  pressureRatio: number,
  isentropicEff: number,
  gamma = 1.4,
): number {
  if (pressureRatio <= 1) return inletTemp;
  const ideal = Math.pow(pressureRatio, (gamma - 1) / gamma);
  return inletTemp * (1 + (ideal - 1) / clamp(isentropicEff, 0.35, 0.88));
}

/**
 * Turbo spool karakteri.
 *
 * Turbo, egzoz enerjisiyle calisir; dusuk devirde egzoz debisi yetersizdir.
 * Basincin devirle yukselisi S-egrisi seklindedir. `fullBoostRpm`
 * hedeflenen basincin ~%95'ine ulasildigi devirdir.
 */
export function turboSpoolFraction(rpm: number, fullBoostRpm: number, throttle: number): number {
  if (fullBoostRpm <= 0) return 1;
  // Kelebek kapaliyken egzoz enerjisi de yok — spool cokerse basinc da coker
  const throttleEffect = Math.pow(clamp(throttle, 0, 1), 0.7);
  const x = rpm / fullBoostRpm;
  // Logistik egri: x=1'de ~0.95
  const s = 1 / (1 + Math.exp(-5.5 * (x - 0.62)));
  return clamp(s, 0, 1) * throttleEffect;
}

/**
 * Manifold basinci ve emme havasi sicakligi.
 *
 * Supersarj (mekanik) turboya gore dusuk devirde tam basinc verir ama
 * krank milinden guc calar — bu guc net cikistan dusulur.
 */
export function computeBoost(
  ind: Induction,
  amb: Ambient,
  rpm: number,
  massAirFlow: number,
): BoostState {
  const throttle = clamp(ind.throttlePosition, 0, 1);

  if (ind.type === 'NA') {
    // Dogal emisli: kelebek kismasi manifoldda vakum yaratir.
    // Tam gazda bile emme sistemi kaybi nedeniyle MAP < atmosfer.
    const inductionLoss = 1 - 0.06 * Math.pow(rpm / 7000, 2);
    const map = amb.pressure * throttlePressureRatio(throttle) * clamp(inductionLoss, 0.8, 1);
    return {
      map,
      compressorOutletTemp: amb.temperature,
      iat: amb.temperature + 8, // manifold cidarindan isinma
      pressureRatio: 1,
      compressorPower: 0,
    };
  }

  const spool =
    ind.type === 'TURBO'
      ? turboSpoolFraction(rpm, ind.fullBoostRpm, throttle)
      : Math.pow(throttle, 0.7); // supersarj: devirle dogrudan orantili, spool yok

  const desiredBoost = ind.targetBoost * spool;
  let map = amb.pressure + desiredBoost;
  // Wastegate siniri
  map = Math.min(map, ind.boostLimit);
  // Kelebek kapaliysa manifold basinci duser
  map = Math.min(map, amb.pressure + desiredBoost) * throttlePressureRatio(throttle);
  map = Math.max(map, 8000);

  const pressureRatio = map / amb.pressure;
  const compressorOutletTemp = compressorOutlet(
    amb.temperature,
    pressureRatio,
    ind.compressorEfficiency,
  );
  // Intercooler: cikis sicakligini ortam sicakligina dogru ceker
  const iat =
    compressorOutletTemp -
    clamp(ind.intercoolerEfficiency, 0, 0.95) * (compressorOutletTemp - amb.temperature);

  // Supersarji cevirmenin bedeli (turbo egzoz enerjisi kullanir, bedava degil
  // ama krank milinden dogrudan cekmez)
  let compressorPower = 0;
  if (ind.type === 'SUPERCHARGER' && massAirFlow > 0) {
    const cp = 1005;
    compressorPower =
      (massAirFlow * cp * (compressorOutletTemp - amb.temperature)) /
      0.92; // kayis/dislik mekanik verimi
  }

  return { map, compressorOutletTemp, iat, pressureRatio, compressorPower };
}

/**
 * Gaz kelebegi acikligindan manifold basinc orani.
 * Kelebek karakteristigi dogrusal degildir: ilk %20'de akisin buyuk
 * kismi acilir, son %50 neredeyse hicbir sey degistirmez.
 */
export function throttlePressureRatio(throttle: number): number {
  const t = clamp(throttle, 0, 1);
  if (t >= 0.98) return 1;
  // Kelebek plakasi efektif akis alani ~ sin egrisi
  const effectiveArea = Math.sin((t * Math.PI) / 2);
  return clamp(0.03 + 0.97 * Math.pow(effectiveArea, 0.55), 0.03, 1);
}

// ============================================================
// EMME AYARI (HELMHOLTZ REZONANSI)
// ============================================================

/**
 * Emme sisteminin ayar devri (rpm) — Engelman'in Helmholtz yaklasimi.
 *
 *   f_H   = (c/2π)·sqrt( A / (L_eff · V_eff) )
 *   N_ayar = 60 · f_H / K
 *
 * V_eff: emme zamani boyunca ortalama silindir hacmi = (Vd/2)·(CR+1)/(CR−1)
 * L_eff: runner uzunlugu + uc duzeltmesi (0.3·d)
 * K    : "Helmholtz sayisi" — rezonansin motor devrine orani.
 *
 * K icin literatur 2-3 araligini verir. K = 3 secildi cunku gercek
 * motorlarla ortusen tek deger bu:
 *   150 mm runner → ~6300 rpm  (kisa, yaris tipi emme)
 *   300 mm runner → ~4570 rpm  (tipik sokak motoru)
 *   500 mm runner → ~3570 rpm  (uzun, tork agirlikli manifold)
 * K = 2 kullanilirsa ayni uzunluklar %50 yuksek devir verir ve 4500 rpm
 * icin 730 mm'lik gercek disi bir runner gerekir.
 *
 * Pratik dogrulama: uzun runner = dusuk ayar devri = dusuk devir torku.
 * Degisken emme manifoldlarinin (DISA, IMRC) yaptigi tam olarak budur.
 */
export function intakeTunedRpm(
  ind: Induction,
  sweptVolume: number,
  compressionRatio: number,
  airTemp: number,
  harmonic = 3,
): number {
  const d = ind.runnerDiameter;
  if (d <= 0 || ind.runnerLength <= 0) return 0;
  const A = (Math.PI / 4) * d * d;
  const Leff = ind.runnerLength + 0.3 * d;
  // Emme zamani boyunca ortalama silindir hacmi
  const Veff = (sweptVolume / 2) * ((compressionRatio + 1) / (compressionRatio - 1));
  const c = speedOfSound(airTemp);
  const fH = (c / (2 * Math.PI)) * Math.sqrt(A / (Leff * Veff));
  return (fH * 60) / harmonic;
}

/**
 * Egzoz primer borusunun ayar devri (rpm).
 *
 * Egzoz supabi acildiginda olusan basinc dalgasi kollektore gider,
 * genlesme dalgasi olarak geri doner. Bu VAKUM dalgasi bindirme
 * aninda supaba varirsa silindirdeki artik gazi emerek disari ceker.
 * Zamanlama tutmazsa tam tersi olur: basinc dalgasi geri doner ve
 * artik gazi silindire iter.
 */
export function exhaustTunedRpm(ind: Induction, egtK: number): number {
  if (ind.primaryLength <= 0) return 0;
  const c = speedOfSound(egtK, 1.33, 287);
  // Dalganin gidip gelme suresi: 2L/c. Bu sure bindirmenin ortasina
  // denk gelmeli. Yaklasik olarak 1/2 krank turu.
  const period = (2 * ind.primaryLength) / c;
  return 60 / (period * 2);
}

/**
 * Dalga ayarindan gelen VE carpani.
 *
 * Ayar devrinde tepe, cevresinde sonumlu salinim. Gercek VE egrilerindeki
 * "tumsek ve cukurlar" bu etkidendir — duz bir VE egrisi gercekci degildir.
 */
export function tuningVEMultiplier(rpm: number, tunedRpm: number, strength: number): number {
  if (tunedRpm <= 0 || rpm <= 0) return 1;
  const r = rpm / tunedRpm;
  // Ana rezonans tepesi. Genislik 0.42 secildi: gercek emme sistemleri
  // tek keskin bir rezonans degil, birden fazla ust uste binen mod
  // barindirir; dar bir tepe kullanmak ayar devrinin disinda gercek disi
  // ceza keser.
  const primary = Math.exp(-Math.pow((r - 1) / 0.42, 2));
  // Ikinci harmonik (yarim devirde daha zayif bir tepe)
  const secondary = 0.40 * Math.exp(-Math.pow((r - 0.5) / 0.18, 2));
  // Rezonansin belirgin uzerinde hafif cukur (dalga faz disi doner)
  const dip = -0.15 * Math.exp(-Math.pow((r - 1.7) / 0.35, 2));
  return 1 + strength * (primary + secondary + dip);
}

// ============================================================
// EGZOZ
// ============================================================

/**
 * Egzoz karsi basinci (Pa, mutlak).
 *
 * Basinc kaybi kutle akisinin KARESIYLE artar. Bu yuzden egzoz kisiti
 * yuksek devirde dusuk devirdekinin cok uzerinde ceza keser — ve
 * "egzoz degisimi sadece ust devirde fark etti" gozlemi buradan gelir.
 */
export function exhaustBackpressure(
  massFlow: number,
  ambient: number,
  egtK: number,
  flowCapacity: number,
  primaryDiameter: number,
  cylinderCount: number,
): number {
  // Egzoz sisteminin etkin akis kesiti. Kollektor, primerlerin
  // toplaminin ~%60'i kadardir (hepsi ayni anda akmaz).
  const primaryArea = (Math.PI / 4) * primaryDiameter * primaryDiameter;
  const area = Math.max(0.6 * primaryArea * cylinderCount * Math.max(flowCapacity, 0.1), 1e-5);

  // Sicak egzoz gazinin yogunlugu — atmosfer basincinda
  const rho = Math.max(ambient / (287 * Math.max(egtK, 300)), 0.05);
  const velocity = massFlow / (rho * area);

  // Toplam kayip katsayisi: manifold + katalizor + susturucu + dirsekler.
  // K = 5.4, stok bir sistemde tepe gucte ~0.15-0.25 bar kayip verir.
  const K = 5.4;
  return ambient + K * 0.5 * rho * velocity * velocity;
}

/**
 * Supurme (scavenging) verimi.
 *
 * Bindirme sirasinda emme basinci egzoz basincindan yuksekse taze dolgu
 * artik gazi disari suprur. Turbo motorlarda (MAP > karsi basinc) bu
 * cok etkilidir ve "anti-lag"in fizigidir. Emme basinci dusukse tam
 * tersi olur: egzoz gazi silindire geri doner.
 */
export function scavengingEfficiency(
  overlapDeg: number,
  intakePressure: number,
  exhaustPressure: number,
  rpm: number,
): number {
  const pressureRatio = intakePressure / Math.max(exhaustPressure, 1);
  // Bindirme suresi ne kadar uzunsa etki o kadar buyuk; ama yuksek
  // devirde gecen SURE kisalir, o yuzden rpm ile normalize ediyoruz
  const overlapTime = overlapDeg / (rpm * 6); // saniye
  const overlapFactor = clamp(overlapTime / 0.0015, 0, 2.5);

  if (pressureRatio > 1) {
    // Pozitif supurme
    return clamp(1 - 0.55 * overlapFactor * (pressureRatio - 1), 0.25, 1);
  }
  // Ters akis: egzoz gazi silindire geri doluyor
  return clamp(1 + 0.85 * overlapFactor * (1 - pressureRatio), 1, 2.6);
}

/**
 * Emme portu ve supap tarafindan dolguya verilen isi (K cinsinden artis).
 *
 * Taze dolgu, manifolddan silindire giderken 380-420 K'deki port
 * cidarindan ve arka yuzu ~800 K olan emme supabindan gecer. Isinir,
 * yogunlugu duser, hacimsel verim duser. Ihmal edilirse VE %10-15
 * fazla cikar — yani silindire fiziksel olarak sigmayacak kadar hava
 * doldurulmus olur.
 *
 * NTU (isi degistirici) yaklasimi:
 *   NTU = hA/(ṁ·cp),   h ∝ v^0.8 ∝ ṁ^0.8   ⟹   NTU ∝ ṁ^(−0.2)
 *   ΔT  = [1 − exp(−NTU)] · (T_cidar − T_manifold)
 *
 * Ussun negatif olmasi dogru davranisi verir: DUSUK debide dolgunun
 * isinmaya vakti vardir (rolantide 25-35 K), yuksek debide gecis
 * cok hizlidir (tam gazda 12-18 K). Dusuk devirde hacimsel verimin
 * dusuk kalmasinin sebeplerinden biri budur.
 *
 * @param massFlowPerCyl Emme olayi suresince silindir basina ortalama
 *        kutle debisi (kg/s)
 * @param portWallTemp Port cidar sicakligi (K)
 * @param intakeTemp Manifold sicakligi (K)
 * @param bore Silindir capi (m) — port yuzey alaniyla olceklenir
 */
export function portHeating(
  massFlowPerCyl: number,
  portWallTemp: number,
  intakeTemp: number,
  bore: number,
): number {
  const mdot = Math.max(massFlowPerCyl, 1e-5);
  const boreScale = (bore / 0.09) * (bore / 0.09);
  const ntu = 0.124 * boreScale * Math.pow(mdot, -0.2);
  const effectiveness = 1 - Math.exp(-ntu);
  return effectiveness * Math.max(portWallTemp - intakeTemp, 0);
}

/**
 * Emme havasi yogunlugu (kg/m³) — nem duzeltmeli.
 * Nemli hava kuru havadan HAFIFTIR (su buharinin molar kutlesi 18,
 * havanınki 29). Cok nemli gunlerde guc kaybinin sebebi budur.
 */
export function chargeDensity(pressurePa: number, tempK: number, humidity: number): number {
  const Rdry = 287.058;
  const Rvapor = 461.495;
  // Doymus buhar basinci (Tetens formulu, Pa)
  const tC = tempK - 273.15;
  const pSat = 610.78 * Math.exp((17.27 * tC) / (tC + 237.3));
  const pVapor = clamp(humidity, 0, 1) * pSat;
  const pDry = Math.max(pressurePa - pVapor, 1);
  return pDry / (Rdry * tempK) + pVapor / (Rvapor * tempK);
}

/** Motorun toplam hacminden ve VE'den kutle debisi (kg/s) */
export function massAirFlowFromVE(
  ve: number,
  totalDisplacement: number,
  density: number,
  rpm: number,
): number {
  return (ve * totalDisplacement * density * rpm) / (2 * 60);
}

/** Emme sistemi ayar bilgilerini bir arada toplar (rapor icin) */
export function inductionSummary(cfg: EngineConfig, sweptVolume: number, iat: number) {
  const tuned = intakeTunedRpm(
    cfg.induction, sweptVolume, cfg.geometry.compressionRatio, iat,
  );
  return {
    intakeTunedRpm: tuned,
    runnerLength: cfg.induction.runnerLength,
    runnerDiameter: cfg.induction.runnerDiameter,
  };
}
