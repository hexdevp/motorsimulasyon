/**
 * Turbo modeli — kompresor haritasi, turbin, saft dinamigi, manifold
 *
 * Onceki basit model kompresor verimini SABIT aliyordu. Gercekte verim,
 * basinc orani ve debiye bagli bir "ada" olusturur; adanin disina
 * cikildiginda verim hizla duser ve emme havasi cok daha fazla isinir.
 * Bu, vurunti sinirini dogrudan belirler.
 *
 * Ayrica iki fiziksel sinir vardir:
 *   SURGE  — cok yuksek basinc orani, cok dusuk debi. Akis kopar,
 *            kompresor "oksurur". Turbo omrunu kisaltir.
 *   CHOKE  — debi ses hizina ulasir. Daha fazla hava gecmez, verim coker.
 */

import type { EngineConfig, ManifoldType } from './types';
import { clamp } from './gas';

/** Referans kosullar — duzeltilmis debi bunlara gore hesaplanir */
const T_REF_CORR = 298;
const P_REF_CORR = 101325;

// ============================================================
// EGZOZ MANIFOLD MIMARISI
// ============================================================

export interface ManifoldSpec {
  name: string;
  nameEn: string;
  /** Karsi basinc carpani (1.0 = referans tubular) */
  backpressure: number;
  /** Supurme etkinligi carpani */
  scavenging: number;
  /**
   * Turbine ulasan isi orani. Kisa/kalin dokum manifold isiyi tutar
   * (hizli spool), uzun ince boru isiyi kaybeder (yavas spool ama
   * dusuk EGT).
   */
  heatRetention: number;
  /** Spool devrini kaydiran carpan (<1 = daha erken spool) */
  spoolShift: number;
  note: string;
  noteEn: string;
}

export const MANIFOLDS: Record<ManifoldType, ManifoldSpec> = {
  LOG: {
    name: 'Log (kısa döküm)', nameEn: 'Log (short cast)',
    backpressure: 1.35, scavenging: 0.78, heatRetention: 1.15, spoolShift: 0.86,
    note: 'En hızlı spool, en kötü süpürme. Ucuz ve kompakt; üst devirde belirgin ceza.',
    noteEn: 'Fastest spool, worst scavenging. Cheap and compact; clear top-end penalty.',
  },
  CAST: {
    name: 'Fabrika döküm', nameEn: 'Factory cast',
    backpressure: 1.18, scavenging: 0.88, heatRetention: 1.08, spoolShift: 0.93,
    note: 'Dengeli fabrika çözümü. Dayanıklı, ısıyı tutar.',
    noteEn: 'Balanced factory solution. Durable, retains heat.',
  },
  TUBULAR: {
    name: 'Tubular (boru kaynak)', nameEn: 'Tubular (welded)',
    backpressure: 1.0, scavenging: 1.0, heatRetention: 1.0, spoolShift: 1.0,
    note: 'Referans. İyi akış, orta süpürme, makul spool.',
    noteEn: 'The reference. Good flow, moderate scavenging, reasonable spool.',
  },
  EQUAL_LENGTH: {
    name: 'Eşit uzunluk', nameEn: 'Equal-length',
    backpressure: 0.88, scavenging: 1.18, heatRetention: 0.90, spoolShift: 1.12,
    note: 'En iyi süpürme ve en düz güç eğrisi. Uzun borular ısıyı kaybettiği için spool geç.',
    noteEn: 'Best scavenging and flattest curve. Long runners lose heat, so spool is later.',
  },
  ZOOMIES: {
    name: 'Zoomies (açık boru)', nameEn: 'Zoomies (open pipe)',
    backpressure: 0.55, scavenging: 1.30, heatRetention: 0.72, spoolShift: 1.35,
    note: 'Minimum karşı basınç — doğal emişli yarış için ideal. Turboda spool çok geç kalır.',
    noteEn: 'Minimum backpressure — ideal for NA racing. Spool suffers badly on a turbo.',
  },
  INDIVIDUAL: {
    name: 'Bireysel egzoz', nameEn: 'Individual runners',
    backpressure: 0.62, scavenging: 1.26, heatRetention: 0.76, spoolShift: 1.28,
    note: 'Silindirler birbirini hiç etkilemez. Süpürme mükemmel, karşı basınç çok düşük.',
    noteEn: 'Zero interference between cylinders. Excellent scavenging, very low backpressure.',
  },
};

export const MANIFOLD_TYPES: ManifoldType[] =
  ['LOG', 'CAST', 'TUBULAR', 'EQUAL_LENGTH', 'ZOOMIES', 'INDIVIDUAL'];

// ============================================================
// KOMPRESOR
// ============================================================

export interface CompressorState {
  pressureRatio: number;
  /** Duzeltilmis kutle debisi (kg/s) — harita ekseni */
  correctedFlow: number;
  /** Bu noktadaki gercek izentropik verim (0-1) */
  efficiency: number;
  /** Cark uc hizi (m/s) */
  tipSpeed: number;
  /** Saft devri (rpm) */
  shaftRpm: number;
  /** Surge sinirina yakinlik: 0 = guvenli, 1 = surge icinde */
  surgeMargin: number;
  /** Choke sinirina yakinlik: 0 = guvenli, 1 = bogulmus */
  chokeMargin: number;
  /** Kompresorun cektigi guc (W) */
  power: number;
  /** Cikis sicakligi (K) */
  outletTemp: number;
}

/**
 * Duzeltilmis debi — kompresor haritalarinin standart ekseni.
 *
 *   ṁ_corr = ṁ · √(T/T_ref) / (p/p_ref)
 *
 * Rakimin turbo uzerindeki etkisi tam olarak burada gorulur: Denver'da
 * giris basinci dustugu icin AYNI mutlak basinci uretmek daha yuksek
 * basinc orani ve daha yuksek duzeltilmis debi gerektirir — turbo
 * haritanin sagina ve yukarisina, yani verim adasinin disina kayar.
 */
export function correctedFlow(massFlow: number, inletTemp: number, inletPressure: number): number {
  return (massFlow * Math.sqrt(inletTemp / T_REF_CORR)) / (inletPressure / P_REF_CORR);
}

/**
 * Kompresor verimi — eliptik verim adasi + surge/choke cezalari.
 *
 *   η = η_tepe · exp[ −((PR−PR_opt)/w_PR)² − ((ṁ−ṁ_opt)/w_ṁ)² ]
 *
 * Gercek haritalardaki es-verim egrileri kabaca bu sekildedir. Adanin
 * merkezinden uzaklastikca verim duser; %60 verimli bir kompresorde
 * cikis havasi %75 verimlidekinden 40-60 K daha sicak olur ve bu fark
 * dogrudan vurunti payindan yenir.
 */
export function compressorEfficiency(
  pressureRatio: number,
  corrFlow: number,
  peakPR: number,
  peakFlow: number,
  peakEff: number,
): { efficiency: number; surgeMargin: number; chokeMargin: number } {
  const wPR = Math.max(peakPR * 0.55, 0.35);
  // Debi yonundeki ada genisligi.
  //
  // Gercek kompresor haritalarinda verim adalari debi yonunde GENISTIR:
  // tepe verim debisinin yarisinda bile verim tipik olarak %60'in
  // uzerinde kalir. Onceki 0.52 katsayisi adayi asiri dar yapiyordu —
  // tepe debinin yarisinda verim %20'lere dusuyor, kompresor havayi
  // 80 °C'nin uzerine isitiyor ve motor olmadigi kadar vuruntulu
  // gorunuyordu.
  //
  // 0.95 ile: tepe debinin yarisinda verim ~%60, ucte birinde ~%50 —
  // yayimlanmis Garrett/BorgWarner haritalarina yakin.
  const wF = Math.max(peakFlow * 0.95, 0.02);

  const dPR = (pressureRatio - peakPR) / wPR;
  const dF = (corrFlow - peakFlow) / wF;
  let eff = peakEff * Math.exp(-(dPR * dPR) - dF * dF);

  // --- Surge siniri ---
  // Basinc orani yukseldikce surge'e girmeden gecilebilecek minimum
  // debi de yukselir.
  const surgeFlow = peakFlow * 0.34 * Math.pow(Math.max(pressureRatio, 1) / peakPR, 0.55);
  const surgeMargin = clamp((surgeFlow - corrFlow) / Math.max(surgeFlow, 1e-6), 0, 1);
  if (surgeMargin > 0) eff *= 1 - 0.55 * surgeMargin;

  // --- Choke siniri ---
  const chokeFlow = peakFlow * 1.75;
  const chokeMargin = clamp((corrFlow - chokeFlow) / Math.max(chokeFlow * 0.4, 1e-6), 0, 1);
  if (chokeMargin > 0) eff *= 1 - 0.6 * chokeMargin;

  return {
    efficiency: clamp(eff, 0.28, 0.86),
    surgeMargin,
    chokeMargin,
  };
}

/**
 * Kompresor sart durumu.
 *
 * Cark uc hizi, Euler turbomakine denkleminden turetilir:
 *   U² = cp·T_giris·(PR^((γ−1)/γ) − 1) / (η · σ_kayma)
 *
 * σ (kayma faktoru) geriye egimli carklarda ~0.68'dir. Uc hizi
 * aluminyum carklarda ~520 m/s'yi gecerse merkezkac gerilme dayanim
 * sinirina dayanir — bu, bir turbonun ne kadar basinc uretebileceginin
 * MUTLAK sinirlarindan biridir ve haritanin ust kenarini cizer.
 */
export function solveCompressor(
  massFlow: number,
  inletTemp: number,
  inletPressure: number,
  pressureRatio: number,
  wheelDia: number,
  peakPR: number,
  peakFlow: number,
  peakEff: number,
): CompressorState {
  const corr = correctedFlow(massFlow, inletTemp, inletPressure);
  const { efficiency, surgeMargin, chokeMargin } =
    compressorEfficiency(pressureRatio, corr, peakPR, peakFlow, peakEff);

  const cp = 1005, gamma = 1.4;
  const idealRise = Math.pow(Math.max(pressureRatio, 1), (gamma - 1) / gamma) - 1;
  const outletTemp = inletTemp * (1 + idealRise / efficiency);

  const slip = 0.68;
  const tipSpeed = pressureRatio > 1.001
    ? Math.sqrt((cp * inletTemp * idealRise) / (efficiency * slip))
    : 0;
  const shaftRpm = wheelDia > 0 ? (tipSpeed / (Math.PI * wheelDia)) * 60 : 0;
  const power = massFlow * cp * (outletTemp - inletTemp);

  return {
    pressureRatio, correctedFlow: corr, efficiency, tipSpeed, shaftRpm,
    surgeMargin, chokeMargin, power, outletTemp,
  };
}

// ============================================================
// TURBIN VE SAFT
// ============================================================

export interface TurbineState {
  /** Turbin girisindeki basinc (Pa, mutlak) */
  inletPressure: number;
  /** Turbin giris sicakligi (K) */
  inletTemp: number;
  /** Turbinden alinan guc (W) */
  power: number;
  /** Govde malzemesine gore sicaklik payi (0-1, 1 = sinirda) */
  thermalStress: number;
  /** Turbo yataklarina giden isi (W) */
  bearingHeat: number;
}

/**
 * Turbin karsi basinci.
 *
 * A/R orani belirleyicidir: kucuk A/R gazi hizlandirir (hizli spool)
 * ama akisi kisar (yuksek karsi basinc, ust devirde guc kaybi). Turbo
 * secimindeki en temel takas budur ve genelde tek bir sayiyla
 * ozetlenemedigi icin yanlis anlasilir.
 *
 * Karsi basinc, debinin karesiyle ve 1/(A/R) ile artar.
 */
export function turbineBackpressure(
  massFlow: number,
  ambient: number,
  egtK: number,
  turbineAR: number,
  manifold: ManifoldSpec,
  downstreamCapacity: number,
): number {
  const ar = clamp(turbineAR, 0.3, 2.0);
  const rho = Math.max(ambient / (287 * Math.max(egtK, 300)), 0.05);
  // Turbin gecis alani A/R ile orantili kabul edilir
  const effArea = 0.0016 * ar * Math.max(downstreamCapacity, 0.2);
  const velocity = massFlow / (rho * effArea);
  const dp = 1.9 * 0.5 * rho * velocity * velocity * manifold.backpressure;
  return ambient + dp;
}

/** Govde malzemesine gore turbin sicaklik siniri (K) */
export const TURBINE_TEMP_LIMIT = 1220; // Ni-resist dokum, tipik

export function solveTurbine(
  massFlow: number,
  egtK: number,
  backpressure: number,
  ambient: number,
  compressorPower: number,
  manifold: ManifoldSpec,
): TurbineState {
  // Manifold isi tutma orani turbine ulasan sicakligi belirler
  const inletTemp = ambient > 0
    ? 300 + (egtK - 300) * manifold.heatRetention
    : egtK;

  // Kararli halde turbin, kompresorun cektigi gucu karsilar.
  // Mekanik verim ~%97 (yatak kayiplari).
  const power = compressorPower / 0.97;

  const thermalStress = clamp(inletTemp / TURBINE_TEMP_LIMIT, 0, 1.4);

  // Yataklara giden isi: turbin govdesinden iletim + yatak surtunmesi.
  // Yag, turbo sogutmasinin buyuk kismini ustlenir; sicak kapatmada
  // yagin kok yapmasinin (coking) sebebi bu isidir.
  const bearingHeat = 0.035 * massFlow * 1150 * (inletTemp - 400) + 0.03 * power;

  return {
    inletPressure: backpressure, inletTemp, power,
    thermalStress, bearingHeat: Math.max(bearingHeat, 0),
  };
}

/**
 * Sart ataletinden gelen spool gecikmesi.
 *
 * Turbo, kutlesinin degil ATALET MOMENTININ esiri olur; ve atalet
 * cark capinin BESINCI kuvvetiyle artar. Cark capini %20 buyutmek
 * atalet momentini 2.5 kat artirir — "biraz daha buyuk turbo" almanin
 * neden belirgin gecikme getirdigi budur.
 *
 * @returns Efektif tam-basinc devri (rpm)
 */
export function effectiveSpoolRpm(
  baseFullBoostRpm: number,
  turbineAR: number,
  turboInertia: number,
  manifold: ManifoldSpec,
  referenceInertia = 2.2e-5,
): number {
  const arFactor = Math.pow(clamp(turbineAR, 0.3, 2.0) / 0.7, 0.55);
  const inertiaFactor = Math.pow(Math.max(turboInertia, 1e-6) / referenceInertia, 0.22);
  return baseFullBoostRpm * arFactor * inertiaFactor * manifold.spoolShift;
}

/**
 * Canli simulasyon icin spool zaman sabiti (s).
 * Gaz acildiginda basincin ne kadar surede gelecegini belirler.
 */
export function spoolTimeConstant(
  turboInertia: number, targetShaftRpm: number, availablePower: number,
): number {
  if (availablePower <= 0 || targetShaftRpm <= 0) return 2.0;
  const omega = (targetShaftRpm * 2 * Math.PI) / 60;
  const energy = 0.5 * turboInertia * omega * omega;
  return clamp(energy / availablePower, 0.05, 4.0);
}

/** Uc hizi gerilme degerlendirmesi */
export function tipSpeedVerdict(tipSpeed: number): 'ok' | 'high' | 'critical' {
  if (tipSpeed > 540) return 'critical';
  if (tipSpeed > 490) return 'high';
  return 'ok';
}

/**
 * Preset motorlar icin makul turbo boyutlandirmasi turetir.
 * Kompresor haritasinin merkezi, motorun tepe debisine oturtulur.
 */
export function estimateTurboSizing(cfg: EngineConfig, peakMassFlow: number) {
  const targetPR = (cfg.ambient.pressure + cfg.induction.targetBoost) / cfg.ambient.pressure;
  return {
    compressorPeakPR: clamp(targetPR * 0.92, 1.3, 3.6),
    compressorPeakFlow: Math.max(peakMassFlow * 0.85, 0.02),
    compressorPeakEff: 0.76,
  };
}
