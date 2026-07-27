/**
 * Isi transferi — Woschni korelasyonu ve cidar sicaklik modeli
 *
 * Silindir icindeki isinin %20-30'u cidarlara kacar. Bunu ihmal eden
 * simulasyonlar termal verimi %15-20 fazla gosterir ve egzoz gazi
 * sicakligini tamamen kacirir.
 */

import type { Geometry, Mechanical } from './types';
import type { CrankKinematics } from './geometry';
import { pistonPosition } from './geometry';
import { clamp } from './gas';

/** Cevrimin hangi evresinde oldugumuz — Woschni katsayilarini degistirir */
export type CyclePhase = 'GAS_EXCHANGE' | 'COMPRESSION' | 'COMBUSTION';

/**
 * Woschni isi tasinim katsayisi (W/m²·K).
 *
 *   h = 3.26 · B^(−0.2) · p^0.8 · T^(−0.55) · w^0.8
 *   (B: m, p: kPa, T: K, w: m/s)
 *
 * w, silindir icindeki karakteristik gaz hizidir:
 *   w = C1·Sp + C2·(Vd·T_ref)/(p_ref·V_ref) · (p − p_motorlanmamis)
 *
 * Ikinci terim kritiktir: yanma basinci yukselttikce olusan hizli
 * genlesme gaz hareketini artirir, dolayisiyla isi kaybi yanma
 * sirasinda siçrar. Sadece piston hizina bagli basit modeller bunu kacirir.
 */
export function woschniCoefficient(
  bore: number,
  pressurePa: number,
  tempK: number,
  meanPistonSpeed: number,
  phase: CyclePhase,
  sweptVolume: number,
  pRef: number,
  TRef: number,
  vRef: number,
  motoredPressurePa: number,
  swirlRatio: number,
): number {
  const C1 =
    phase === 'GAS_EXCHANGE'
      ? 6.18 + 0.417 * swirlRatio
      : 2.28 + 0.308 * swirlRatio;
  const C2 = phase === 'COMBUSTION' ? 3.24e-3 : 0;

  let w = C1 * meanPistonSpeed;
  if (C2 > 0 && vRef > 0 && pRef > 0) {
    const dp = Math.max(pressurePa - motoredPressurePa, 0);
    // Basinclar kPa cinsinden olmali (korelasyonun turetildigi birim)
    w += C2 * ((sweptVolume * TRef) / (vRef * (pRef / 1000))) * (dp / 1000);
  }

  const pKpa = Math.max(pressurePa / 1000, 1);
  const T = clamp(tempK, 250, 3500);
  const h =
    3.26 *
    Math.pow(bore, -0.2) *
    Math.pow(pKpa, 0.8) *
    Math.pow(T, -0.55) *
    Math.pow(Math.max(w, 0.5), 0.8);
  return clamp(h, 10, 20000);
}

/** Anlik yanma odasi yuzey alani (m²) */
export function chamberArea(
  k: CrankKinematics,
  g: Geometry,
  thetaDeg: number,
): { total: number; head: number; piston: number; liner: number } {
  const ap = k.pistonArea;
  // Kafa yuzeyi duz degildir: yanma odasi cukuru, supap tablalari ve
  // buji cepi gercek alani %20-35 buyutur.
  const head = ap * 1.28;
  // Piston tepesi: squish alani ve cukur/kubbe alani buyutur
  const piston = ap * (1.0 + 0.25 * g.squishAreaRatio);
  const x = pistonPosition(k, thetaDeg);
  const liner = Math.PI * g.bore * (x + g.deckClearance);
  return { total: head + piston + liner, head, piston, liner };
}

export interface WallTemps {
  /** Silindir kafasi / yanma odasi (K) */
  head: number;
  /** Piston tepesi (K) */
  piston: number;
  /** Silindir gomlegi (K) */
  liner: number;
  /** Alan-agirlikli ortalama (K) */
  mean: number;
}

/**
 * Cidar sicakliklari.
 *
 * Basit modeller bunu sabit alir (orn. 450 K). Gercekte cidar sicakligi
 * isi akisiyla birlikte yukselir ve bu bir GERI BESLEME dongusudur:
 *   yuk ↑ → cidar ↑ → son gaz sicakligi ↑ → vurunti riski ↑
 * Tam yukte uzun sure calisan bir motorun neden zamanla vurmaya
 * basladigi bu dongudur.
 *
 * Her yuzeyin sogutucuya termal direnci farklidir:
 *   kafa   — dogrudan su ceketi, dusuk direnc
 *   gomlek — su ceketi, dusuk direnc
 *   piston — sadece yag sicramasi/jeti, YUKSEK direnc → en sicak parca
 *
 * @param heatFluxAvg Cevrim ortalamasi isi akisi (W/m²)
 */
export function wallTemperatures(m: Mechanical, heatFluxAvg: number): WallTemps {
  const q = Math.max(heatFluxAvg, 0);
  // Termal dirençler (m²·K/W) — alüminyum kafa/blok tipik degerleri
  const R_HEAD = 4.5e-4;
  const R_LINER = 5.5e-4;
  const R_PISTON = 1.9e-3;

  const head = m.coolantTemp + q * R_HEAD;
  const liner = m.coolantTemp + q * R_LINER;
  // Piston yaga isi verir, sogutucuya degil
  const piston = m.oilTemp + q * R_PISTON;

  // Alan agirliklari: kafa ~%33, piston ~%33, gomlek ~%34 (cevrim ortalamasi)
  const mean = 0.33 * head + 0.33 * piston + 0.34 * liner;
  return {
    head: clamp(head, 300, 900),
    piston: clamp(piston, 300, 1000),
    liner: clamp(liner, 300, 800),
    mean: clamp(mean, 300, 900),
  };
}

/**
 * Motorlanmamis (yanma olmadan) basinc — Woschni'nin ikinci terimi icin.
 * IVC durumundan izentropik sikistirma.
 */
export function motoredPressure(
  pIVC: number,
  vIVC: number,
  volume: number,
  gamma: number,
): number {
  return pIVC * Math.pow(vIVC / Math.max(volume, 1e-9), gamma);
}

/**
 * Egzoz gazi sicakligi (K) — supap sonrasi, manifoldda olculen.
 *
 * Silindir icindeki gaz, egzoz supabindan gecerken kismen genlesir ve
 * manifold cidarina isi verir. EGT probunun gordugu deger tepe silindir
 * sicakliginin cok altindadir.
 */
export function exhaustGasTemperature(
  cylinderTempAtEVO: number,
  cylinderPressureAtEVO: number,
  backpressure: number,
  gamma: number,
  manifoldHeatLoss: number,
): number {
  // Supaptan gecerken blowdown genlesmesi
  const expanded =
    cylinderTempAtEVO *
    Math.pow(
      Math.max(backpressure, 1e4) / Math.max(cylinderPressureAtEVO, 1e4),
      (gamma - 1) / gamma,
    );
  return clamp(expanded * (1 - manifoldHeatLoss), 350, 1500);
}
