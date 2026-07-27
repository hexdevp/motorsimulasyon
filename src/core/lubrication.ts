/**
 * Yaglama sistemi — yag basinci, film kalinligi, asinma
 *
 * Yag basinci bir "saglik gostergesi" degil, bir DENGE sonucudur:
 * pompanin bastigi debi ile yataklardan sizan debi esitlendigi noktada
 * olusur. Bu yuzden:
 *
 *   basinc ∝ devir · viskozite / bosluk³
 *
 * Kubik bagimlilik burada belirleyicidir. Yatak boslugunu 0.05 mm'den
 * 0.06 mm'ye cikarmak (yalnizca %20) sizintiyi 1.73 kat artirir ve
 * basinci ayni oranda dusurur. Asinmis bir motorda yag basincinin neden
 * bu kadar hizli coktuğunu aciklayan sey budur.
 *
 * Ayni sekilde sicak yag (dusuk μ) da basinci dusurur — yaz gunu
 * rolantide yag lambasinin titremesinin sebebi.
 */

import type { EngineConfig } from './types';
import { clamp } from './gas';
import { oilViscosity } from './friction';
import { cylinderCount } from './geometry';

/**
 * Yatak sizinti iletkenligi katsayisi.
 *
 * Ideal es-merkezli Poiseuille akisi gercek sizintiyi ~20-40 kat AZ
 * tahmin eder; cunku gercek yatakta muylu eksantriktir (yakinsak kama
 * cok daha fazla akitir), besleme kanallari vardir, ayrica kam
 * yataklari, piston sogutma fiskiyeleri ve kaldiricilar da ayni
 * galeriden beslenir.
 *
 * Bu yuzden geometrik carpanlar tek bir kalibre katsayida toplanmistir.
 * MODELIN FIZIGI olan  c³/μ  olceklemesi korunur; katsayi yalnizca
 * mutlak seviyeyi stok bir motorun bilinen degerlerine oturtur:
 * hararetli yagla rolantide ~1.2 bar, 6000 rpm'de tahliye valfinde.
 */
const LEAK_COEFF = 14;

/**
 * Yag pompasi debi katsayisi (m³/s per rpm, 3 L motor icin).
 *
 * Pompa, tahliye valfinin ~3000 rpm'de acilacagi sekilde boyutlandirilir
 * — gercek motorlarda oldugu gibi. Bu sayede basinc egrisi dogru sekli
 * alir: rolantide ~1.2 bar, orta devirden itibaren tahliye basincinda sabit.
 */
const PUMP_COEFF = 1.5e-7;

/** Yuzey purüzlülüğü — yatak + muylu bilesik (m) */
const SURFACE_ROUGHNESS = 0.5e-6;

/**
 * Yatak sizinti iletkenliginin viskoziteden BAGIMSIZ kismi.
 *
 * Canli surus modelinde yag sicakligi her karede degistigi icin
 * iletkenligi her seferinde bastan hesaplamak yerine, sabit gemetrik
 * kismi bir kez cikarilir:  iletkenlik = referans / mu
 */
export function leakConductanceRef(cfg: EngineConfig): number {
  const m = cfg.mechanical;
  const nCyl = cylinderCount(cfg.layout);
  const path = (clearanceDiametral: number) =>
    (LEAK_COEFF * Math.PI * Math.pow(clearanceDiametral / 2, 3)) / 1.68;
  return (nCyl + 1) * path(m.mainBearingClearance) +
    nCyl * path(m.rodBearingClearance) +
    nCyl * path(m.mainBearingClearance * 0.9);
}

/** Pompa debi katsayisi — motor hacmine gore olceklenmis */
export function pumpCoefficientFor(cfg: EngineConfig): number {
  const nCyl = cylinderCount(cfg.layout);
  const disp = (Math.PI / 4) * cfg.geometry.bore ** 2 * cfg.geometry.stroke * nCyl;
  return PUMP_COEFF * (disp / 3e-3);
}

export interface LubricationState {
  /** Galeri basinci (Pa, gauge) */
  pressure: number;
  /** Pompanin bastigi debi (m³/s) */
  pumpFlow: number;
  /** Yataklardan sizan debi (m³/s) */
  leakFlow: number;
  /** Tahliye valfi devrede mi */
  reliefOpen: boolean;
  /** Biyel yataginda minimum film kalinligi (m) */
  minFilm: number;
  /** Film kalinligi / purüzlülük orani (λ). >3 tam film, <1 sinir yaglama */
  lambdaRatio: number;
  /** Asinma indeksi (0 = guvenli, 1 = metal-metal temas) */
  wearIndex: number;
  /** Yaga giden isi yuku (W) */
  heatLoad: number;
}

/**
 * Sommerfeld sayisindan minimum yag film kalinligi.
 *
 *   S = (r/c)² · (μ·N) / P        (P = yatak birim yuku)
 *   h_min / c ≈ 0.93 · S^0.51     (kisa yatak cozumunun pratik uyumu)
 *
 * Yuksek yuk → dusuk S → ince film. Yuksek devir veya kalin yag →
 * yuksek S → kalin film. Motorun neden yuksek devirde degil de DUSUK
 * devirde yuksek yukte (lugging) yatak yediginin fizigi budur.
 */
export function minimumFilmThickness(
  bearingDia: number,
  clearanceDiametral: number,
  load: number,
  rpm: number,
  viscosity: number,
): { film: number; sommerfeld: number } {
  const c = clearanceDiametral / 2;              // radyal bosluk
  const r = bearingDia / 2;
  const L = 0.28 * bearingDia;                   // yatak genisligi
  const N = Math.max(rpm, 60) / 60;              // devir/saniye
  const P = Math.max(Math.abs(load), 1) / (L * bearingDia);
  const S = Math.pow(r / c, 2) * ((viscosity * N) / P);
  const ratio = clamp(0.93 * Math.pow(S, 0.51), 0.008, 0.85);
  return { film: ratio * c, sommerfeld: S };
}

/**
 * Yaglama sistemi durumu.
 *
 * @param peakBearingLoad Cevrimdeki tepe biyel yatagi kuvveti (N)
 */
export function solveLubrication(
  cfg: EngineConfig,
  rpm: number,
  peakBearingLoad: number,
): LubricationState {
  const m = cfg.mechanical;
  const mu = oilViscosity(m.oilGrade, m.oilTemp);
  const nCyl = cylinderCount(cfg.layout);

  // --- Pompa debisi ---
  // Pozitif deplasmanli pompa: debi devirle DOGRUSAL artar.
  // Motor hacmiyle olceklenir (buyuk motor, buyuk pompa).
  const displacementScale = (Math.PI / 4) * cfg.geometry.bore ** 2 * cfg.geometry.stroke * nCyl / 3e-3;
  const pumpFlow = PUMP_COEFF * rpm * m.oilPumpCapacity * displacementScale;

  // --- Sizinti iletkenligi ---
  // Ana yataklar (nCyl+1 adet), biyel yataklari (nCyl adet), ve kam
  // yataklari + fiskiyeler (yaklasik nCyl adet ek yol).
  const pathConductance = (clearanceDiametral: number) =>
    (LEAK_COEFF * Math.PI * Math.pow(clearanceDiametral / 2, 3)) / (1.68 * mu);

  const conductance =
    (nCyl + 1) * pathConductance(m.mainBearingClearance) +
    nCyl * pathConductance(m.rodBearingClearance) +
    nCyl * pathConductance(m.mainBearingClearance * 0.9);

  // --- Denge basinci ---
  let pressure = pumpFlow / Math.max(conductance, 1e-15);
  const reliefOpen = pressure > m.oilReliefPressure;
  if (reliefOpen) pressure = m.oilReliefPressure;

  const leakFlow = pressure * conductance;

  // --- Film kalinligi ve asinma ---
  const { film } = minimumFilmThickness(
    m.rodBearingDia, m.rodBearingClearance, peakBearingLoad, rpm, mu,
  );
  const lambdaRatio = film / SURFACE_ROUGHNESS;
  // λ > 3 tam hidrodinamik film, 1-3 karma rejim, < 1 sinir yaglama
  const wearIndex = clamp(1 - (lambdaRatio - 1) / 3, 0, 1);

  // --- Yaga giden isi ---
  // Basincli yagin yataklardan gecerken kaybettigi enerji + sürtünmeden
  // gelen isi. Yag sogutucusu boyutlandirmasinin girdisi.
  const heatLoad = pressure * leakFlow + 0.35 * rpm * mu * displacementScale * 1200;

  return {
    pressure, pumpFlow, leakFlow, reliefOpen,
    minFilm: film, lambdaRatio, wearIndex, heatLoad,
  };
}

/** Yag basinci degerlendirmesi — devre gore beklenen minimum */
export function oilPressureVerdict(
  pressurePa: number, rpm: number,
): 'ok' | 'low' | 'critical' {
  // Yaygin kural: her 1000 devir icin ~0.7 bar, minimum 0.7 bar
  const expected = Math.max(0.7e5, (rpm / 1000) * 0.7e5);
  if (pressurePa < expected * 0.55) return 'critical';
  if (pressurePa < expected * 0.8) return 'low';
  return 'ok';
}

/**
 * Yatak boslugu onerisi (m, capsal).
 *
 * Sektor kurali: yatak capinin her 25.4 mm'si icin 0.001" (0.0254 mm).
 * Yuksek devirli ve yuksek yuklu motorlarda biraz daha gevsek tutulur
 * ki yag akisi (ve dolayisiyla sogutma) artsin.
 */
export function recommendedClearance(bearingDia: number, performance = false): number {
  const base = bearingDia * 0.001;
  return performance ? base * 1.25 : base;
}
