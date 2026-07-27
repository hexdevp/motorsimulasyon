/**
 * Yakit ozellikleri
 *
 * Her yakit, kimyasal formulu (C_x H_y O_z) ile tanimlanir; stokiyometrik
 * AFR bu formulden HESAPLANIR, elle girilmez. Boylece yanma urunleri,
 * AFR ve enerji icerigi birbiriyle tutarli kalir.
 */

import type { FuelSpec, FuelType } from './types';

/** Havanin molar kutlesi (kg/mol) */
const M_AIR = 0.028965;
/** Havadaki O2 mol fraksiyonu */
const X_O2 = 0.2095;

const M_C = 0.012011;
const M_H = 0.001008;
const M_O = 0.015999;

/** Formulden molar kutle (kg/mol) */
export function fuelMolarMass(x: number, y: number, z: number): number {
  return x * M_C + y * M_H + z * M_O;
}

/**
 * Formulden stokiyometrik hava-yakit orani (kutlesel).
 *   C_xH_yO_z + a(O2 + 3.773 N2) → x CO2 + (y/2) H2O + 3.773a N2
 *   a = x + y/4 − z/2
 */
export function stoichiometricAFR(x: number, y: number, z: number): number {
  const a = x + y / 4 - z / 2;
  const massAir = (a / X_O2) * M_AIR;
  return massAir / fuelMolarMass(x, y, z);
}

interface FuelDef {
  name: string;
  ron: number;
  mon: number;
  lhv: number;
  latentHeat: number;
  density: number;
  laminarFlameSpeedRef: number;
  carbonAtoms: number;
  hydrogenAtoms: number;
  oxygenAtoms: number;
}

/**
 * Yakit tanimlari.
 *
 * Benzin icin C8H15.5 vekil molekulu kullaniliyor: H/C = 1.94 orani
 * gercek benzinin tipik degeridir ve stokiyometrik AFR'yi tam 14.70
 * verir. Saf oktan (C8H18) kullanmak AFR'yi 15.1'e cikarir ve tum
 * yakit hesabini kaydirir.
 *
 * E85 ise hacimce %85 etanol + %15 benzin karisiminin molar ortalamasidir.
 */
const FUEL_DEFS: Record<FuelType, FuelDef> = {
  GASOLINE: {
    name: 'Benzin / Gasoline',
    ron: 95, mon: 85,
    lhv: 44.0e6, latentHeat: 350e3, density: 745,
    laminarFlameSpeedRef: 0.305,
    carbonAtoms: 8, hydrogenAtoms: 15.5, oxygenAtoms: 0,
  },
  RACE_GAS: {
    name: 'Yaris Benzini / Race Gas',
    ron: 114, mon: 106,
    lhv: 43.5e6, latentHeat: 310e3, density: 720,
    laminarFlameSpeedRef: 0.285,
    carbonAtoms: 8, hydrogenAtoms: 16.5, oxygenAtoms: 0,
  },
  E85: {
    name: 'E85',
    ron: 104, mon: 90,
    lhv: 29.2e6, latentHeat: 760e3, density: 782,
    laminarFlameSpeedRef: 0.425,
    carbonAtoms: 2.386, hydrogenAtoms: 6.61, oxygenAtoms: 0.936,
  },
  E100: {
    name: 'Etanol / Ethanol E100',
    ron: 108, mon: 92,
    lhv: 26.8e6, latentHeat: 840e3, density: 789,
    laminarFlameSpeedRef: 0.465,
    carbonAtoms: 2, hydrogenAtoms: 6, oxygenAtoms: 1,
  },
  METHANOL: {
    name: 'Metanol / Methanol M100',
    ron: 109, mon: 89,
    lhv: 19.9e6, latentHeat: 1100e3, density: 792,
    laminarFlameSpeedRef: 0.369,
    carbonAtoms: 1, hydrogenAtoms: 4, oxygenAtoms: 1,
  },
  LPG: {
    name: 'LPG / Propan',
    ron: 105, mon: 90,
    lhv: 46.4e6, latentHeat: 425e3, density: 510,
    laminarFlameSpeedRef: 0.34,
    carbonAtoms: 3, hydrogenAtoms: 8, oxygenAtoms: 0,
  },
};

/**
 * Yakit olustur. RON degeri istege bagli olarak ezilebilir
 * (orn. "98 RON benzin") — MON, RON ile birlikte kayar.
 */
export function makeFuel(type: FuelType, ronOverride?: number): FuelSpec {
  const d = FUEL_DEFS[type];
  const ron = ronOverride ?? d.ron;
  // Hassasiyet (RON − MON) yakit ailesine ozgudur ve RON degistiginde korunur
  const sensitivity = d.ron - d.mon;
  return {
    type,
    name: d.name,
    ron,
    mon: ron - sensitivity,
    afrStoich: stoichiometricAFR(d.carbonAtoms, d.hydrogenAtoms, d.oxygenAtoms),
    lhv: d.lhv,
    latentHeat: d.latentHeat,
    density: d.density,
    laminarFlameSpeedRef: d.laminarFlameSpeedRef,
    carbonAtoms: d.carbonAtoms,
    hydrogenAtoms: d.hydrogenAtoms,
    oxygenAtoms: d.oxygenAtoms,
    molarMass: fuelMolarMass(d.carbonAtoms, d.hydrogenAtoms, d.oxygenAtoms),
  };
}

export const FUEL_TYPES: FuelType[] = ['GASOLINE', 'RACE_GAS', 'E85', 'E100', 'METHANOL', 'LPG'];

/** Lambda → esdegerlik orani */
export function lambdaToPhi(lambda: number): number {
  return 1 / Math.max(lambda, 1e-6);
}

/** AFR → lambda */
export function afrToLambda(afr: number, afrStoich: number): number {
  return afr / afrStoich;
}

/**
 * Belirli bir yakitin, ayni hava kutlesi icin gerekli yakit kutlesi orani.
 * E85'in neden ~%35 daha buyuk enjektor istedigini gosterir.
 */
export function fuelMassPerAirMass(fuel: FuelSpec, lambda: number): number {
  return 1 / (fuel.afrStoich * lambda);
}

// ============================================================
// YAKIT SICAKLIGI
// ============================================================

/** Yakit hacimsel genlesme katsayisi (1/K) */
const EXPANSION: Record<FuelType, number> = {
  GASOLINE: 0.00095, RACE_GAS: 0.00092, E85: 0.00088,
  E100: 0.00075, METHANOL: 0.00119, LPG: 0.0030,
};

/**
 * Reid buhar basinci (Pa) — 37.8°C'de olculen referans deger.
 *
 * Etanolun tek basina buhar basinci DUSUKTUR (~16 kPa), ama benzinle
 * karistiginda azeotrop olusturup karisimin buhar basincini YUKSELTIR.
 * E85'in benzinden daha dusuk cikmasi, icindeki benzin oraninin
 * az olmasindandir.
 */
const REID_VAPOR_PRESSURE: Record<FuelType, number> = {
  GASOLINE: 55000, RACE_GAS: 48000, E85: 40000,
  E100: 16000, METHANOL: 32000, LPG: 850000,
};

/** 20°C'deki yuzey gerilimi (N/m) — atomizasyonu belirler */
const SURFACE_TENSION: Record<FuelType, number> = {
  GASOLINE: 0.0215, RACE_GAS: 0.0220, E85: 0.0225,
  E100: 0.0223, METHANOL: 0.0226, LPG: 0.0080,
};

/**
 * Sicakliga bagli yakit yogunlugu (kg/m³).
 *
 * Enjektor SABIT HACIM olcer; yogunluk dustugunde ayni darbe genisligi
 * daha AZ kutle verir ve karisim fakirlesir. Yakit deposu sicak bir
 * gunde 20°C'den 50°C'ye cikarsa benzinin yogunlugu ~%2.9 duser —
 * duzeltilmezse lambda 0.85 yerine 0.875 olur.
 */
export function fuelDensityAt(fuel: FuelSpec, tempK: number): number {
  const beta = EXPANSION[fuel.type];
  return fuel.density * (1 - beta * (tempK - 288.15));
}

/**
 * Yakitin buhar basinci (Pa) — Clausius-Clapeyron ile sicakliga tasinir.
 *
 *   p(T) = RVP · exp[ (ΔH/R) · (1/T_ref − 1/T) ]
 */
export function fuelVaporPressure(fuel: FuelSpec, tempK: number): number {
  const rvp = REID_VAPOR_PRESSURE[fuel.type];
  const T_REF = 310.93; // 37.8°C
  const dHoverR = fuel.type === 'LPG' ? 2400 : 4000;
  return rvp * Math.exp(dHoverR * (1 / T_REF - 1 / Math.max(tempK, 200)));
}

/**
 * Buhar kilidi (vapor lock) payi (Pa).
 *
 * Yakit, pompanin EMME tarafinda buhar basincinin altina duserse
 * kaynar; pompa sivi yerine buhar cekmeye baslar ve debi coker.
 * Kritik nokta bu yuzden ray basinci degil, hat/emme basincidir.
 *
 * Negatif deger = buhar olusumu basladi.
 */
export function vaporLockMargin(
  fuel: FuelSpec, fuelTempK: number, suctionPressurePa: number,
): number {
  return suctionPressurePa - fuelVaporPressure(fuel, fuelTempK);
}

/**
 * Sauter ortalama damlacik capi (m) — atomizasyon kalitesi.
 *
 *   SMD ∝ σ^0.6 · μ^0.2 / (ΔP^0.4 · ρ_hava^0.25)
 *
 * Sicak yakitin yuzey gerilimi ve viskozitesi duser, dolayisiyla DAHA
 * IYI atomize olur. Buradaki takas su: sicak yakit atomizasyonu
 * iyilestirir ama yogunlugu dusurur ve buhar kilidi riski getirir.
 *
 * Kucuk damlacik = hizli buharlasma = daha iyi karisim = daha hizli ve
 * tam yanma. Direkt enjeksiyonun port enjeksiyona ustunlugunun bir
 * kismi buradan gelir (yuksek ΔP → kucuk SMD).
 */
export function sauterMeanDiameter(
  fuel: FuelSpec, fuelTempK: number, injectionPressurePa: number, airDensity: number,
): number {
  const sigma0 = SURFACE_TENSION[fuel.type];
  // Yuzey gerilimi sicaklikla lineer duser (~%0.5/K referansa gore)
  const sigma = Math.max(sigma0 * (1 - 0.0022 * (fuelTempK - 293.15)), 0.004);
  // Viskozite sicaklikla ustel duser
  const mu = 0.0005 * Math.exp(1200 * (1 / Math.max(fuelTempK, 200) - 1 / 293.15));
  const dP = Math.max(injectionPressurePa, 5e4);
  const rho = Math.max(airDensity, 0.3);
  // Katsayi olculen degerlere kalibre edildi: 3 bar port enjeksiyonda
  // ~100 µm, 120 bar direkt enjeksiyonda ~23 µm — her ikisi de
  // literaturdeki tipik degerlerdir.
  return 0.85 * Math.pow(sigma, 0.6) * Math.pow(mu, 0.2) /
    (Math.pow(dP, 0.4) * Math.pow(rho, 0.25));
}

// ============================================================
// YAKIT POMPASI
// ============================================================

export interface FuelSupplyState {
  /** Gereken debi (L/saat) */
  demandLPH: number;
  /** Pompanin bu basincta verebildigi debi (L/saat) */
  supplyLPH: number;
  /** Emniyet payi (0-1). Negatif = yetersiz. */
  headroom: number;
  /** Talep karsilanamiyorsa gercekleseh ray basinci (Pa) */
  actualRailPressure: number;
  /** Debi yetmediginde olusan fakirlesme (lambda carpani, 1.0 = sorun yok) */
  leanoutFactor: number;
}

/**
 * Yakit besleme dengesi.
 *
 * Pompa debisi basincla DUSER. Turbo motorlarda ray basinci manifold
 * basinciyla birlikte yukseldiginden, tam basincta pompa hem daha
 * yuksek basinca hem daha yuksek debiye zorlanir — enjektorler yetse
 * bile pompanin darbogaz olmasinin sebebi budur.
 *
 * @param fuelMassFlow Gereken yakit kutle debisi (kg/s), tum motor
 * @param railPressure Hedeflenen ray basinci (Pa, gauge)
 */
export function solveFuelSupply(
  fuel: FuelSpec,
  fuelTempK: number,
  fuelMassFlow: number,
  railPressure: number,
  pumpFlowLPH: number,
  pumpRatedPressure: number,
  pumpDeadheadPressure: number,
): FuelSupplyState {
  const rho = fuelDensityAt(fuel, fuelTempK);
  const demandLPH = (fuelMassFlow / rho) * 3600 * 1000;

  /** Pompa egrisi: debi, tahliye basincina dogru dogrusal duser */
  const flowAt = (p: number) => {
    const span = Math.max(pumpDeadheadPressure - pumpRatedPressure, 1);
    const droop = (p - pumpRatedPressure) / span;
    return Math.max(pumpFlowLPH * (1 - droop), 0);
  };

  const supplyLPH = flowAt(railPressure);
  const headroom = supplyLPH > 0 ? (supplyLPH - demandLPH) / supplyLPH : -1;

  // Talep arzi asiyorsa basinc, debilerin esitlendigi noktaya duser
  let actualRailPressure = railPressure;
  let leanoutFactor = 1;
  if (demandLPH > supplyLPH && demandLPH > 0) {
    // Basinci dusurerek pompa debisini talebe esitle
    const span = Math.max(pumpDeadheadPressure - pumpRatedPressure, 1);
    actualRailPressure = Math.max(
      pumpRatedPressure + span * (1 - demandLPH / Math.max(pumpFlowLPH, 1e-6)),
      0.15 * pumpRatedPressure,
    );
    // Enjektor debisi basincin karekokuyle degisir
    leanoutFactor = Math.sqrt(Math.max(actualRailPressure, 1) / Math.max(railPressure, 1));
  }

  return { demandLPH, supplyLPH, headroom, actualRailPressure, leanoutFactor };
}
