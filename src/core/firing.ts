/**
 * Atesleme sirasi, krank fazlari ve banka geometrisi
 *
 * Bir motorun karakterini belirleyen sey yalnizca silindir sayisi degil,
 * o silindirlerin krank uzerinde NASIL dizildigidir. Ayni 8 silindir,
 * cross-plane krankla Amerikan V8 gurultusunu, flat-plane krankla
 * Ferrari ciglini uretir. Bu modul o farki tasir.
 */

import type { Layout } from './types';
import { cylinderCount } from './geometry';

export interface CylinderPhase {
  /** 1 tabanli silindir numarasi */
  index: number;
  /**
   * Bu silindirin atesleme TDC'sinin, 1 numarali silindire gore
   * gecikmesi (cevrim derecesi, 0-720).
   *
   * Cozucu tek silindir icin theta = 0'da atesler; diger silindirlerin
   * anlik durumu, ayni izin `phase` kadar kaydirilmis halidir.
   */
  phase: number;
  /** 0 = sol banka, 1 = sag banka (sirali motorlarda hepsi 0) */
  bank: 0 | 1;
  /** Silindir ekseninin dusey ile yaptigi aci (derece, sol negatif) */
  axisAngle: number;
}

export interface FiringSpec {
  cylinders: number;
  /** Atesleme araligi (derece) — esit aralikli motorlarda 720/n */
  interval: number;
  /** Atesleme sirasi, silindir numaralariyla */
  order: number[];
  /** V motorlarda banka acisi (derece), boxer 180, sirali 0 */
  bankAngle: number;
  phases: CylinderPhase[];
  /** Krank pimlerinin acisal dagilimi — "cross-plane" gibi ozellikleri belirler */
  crankPinAngles: number[];
  /** Insan tarafindan okunabilir krank tipi */
  crankType: string;
  crankTypeEn: string;
}

/**
 * Fabrika atesleme siralari.
 *
 * Bu diziler keyfi degildir: krank mili titresimini dengelemek ve ardisik
 * ateslemelerin ayni ana yatagi ust uste yuklememesi icin secilirler.
 * Orn. I6'daki 1-5-3-6-2-4, motoru hem birincil hem ikincil dengede
 * tutan diziliminin sonucudur — I6'nin neden bu kadar puruzsuz oldugunun
 * sebeplerinden biridir.
 */
const FIRING_ORDERS: Record<Layout, number[]> = {
  I3: [1, 3, 2],
  I4: [1, 3, 4, 2],
  I5: [1, 2, 4, 5, 3],
  I6: [1, 5, 3, 6, 2, 4],
  V6: [1, 4, 2, 5, 3, 6],
  V8: [1, 8, 7, 2, 6, 5, 4, 3],           // GM cross-plane
  V10: [1, 10, 9, 4, 3, 6, 5, 8, 7, 2],
  V12: [1, 12, 5, 8, 3, 10, 6, 7, 2, 11, 4, 9],
  B4: [1, 3, 2, 4],
  B6: [1, 6, 3, 2, 5, 4],
};

const BANK_ANGLES: Record<Layout, number> = {
  I3: 0, I4: 0, I5: 0, I6: 0,
  V6: 60, V8: 90, V10: 72, V12: 60,
  B4: 180, B6: 180,
};

const CRANK_TYPE: Record<Layout, [string, string]> = {
  I3: ['120° krank', '120° crank'],
  I4: ['Düzlemsel krank', 'Flat crank'],
  I5: ['72° krank', '72° crank'],
  I6: ['120° krank — tam dengeli', '120° crank — fully balanced'],
  V6: ['Bölünmüş pim', 'Split-pin crank'],
  V8: ['Cross-plane (90°)', 'Cross-plane (90°)'],
  V10: ['72° krank', '72° crank'],
  V12: ['60° krank', '60° crank'],
  B4: ['Boxer — karşılıklı', 'Boxer — opposed'],
  B6: ['Boxer — 120°', 'Boxer — 120°'],
};

/**
 * Bir silindirin hangi bankada oldugu.
 *
 * V ve boxer motorlarda yaygin kural: tek numarali silindirler sol,
 * cift numarali silindirler sag bankadadir (GM/Subaru dizilimi).
 */
function bankOf(layout: Layout, cylinderIndex: number): 0 | 1 {
  if (BANK_ANGLES[layout] === 0) return 0;
  return (cylinderIndex % 2 === 1 ? 0 : 1) as 0 | 1;
}

export function firingSpec(layout: Layout): FiringSpec {
  const n = cylinderCount(layout);
  const order = FIRING_ORDERS[layout] ?? Array.from({ length: n }, (_, i) => i + 1);
  const interval = 720 / n;
  const bankAngle = BANK_ANGLES[layout];

  const phases: CylinderPhase[] = [];
  for (let i = 1; i <= n; i++) {
    const slot = order.indexOf(i);
    const bank = bankOf(layout, i);
    phases.push({
      index: i,
      phase: (slot < 0 ? (i - 1) * interval : slot * interval) % 720,
      bank,
      // Sol banka negatif, sag banka pozitif acida
      axisAngle: bankAngle === 0 ? 0 : (bank === 0 ? -bankAngle / 2 : bankAngle / 2),
    });
  }

  // Krank pimi acilari: bir silindirin pimi, atesleme fazinin yarisinda
  // olur (kam degil krank derecesi; 4 zamanlida cevrim 2 tur).
  const crankPinAngles = phases.map((p) => p.phase % 360);

  return {
    cylinders: n,
    interval,
    order,
    bankAngle,
    phases,
    crankPinAngles,
    crankType: CRANK_TYPE[layout][0],
    crankTypeEn: CRANK_TYPE[layout][1],
  };
}

/** Dort zamanli cevrimde bir acinin hangi zamana denk geldigi */
export type Stroke = 'INTAKE' | 'COMPRESSION' | 'POWER' | 'EXHAUST';

/**
 * Cozucu koordinatinda (0 = atesleme TDC'si, aralik −360…+360)
 * verilen acinin hangi zamana denk geldigini bulur.
 */
export function strokeAt(thetaSolver: number): Stroke {
  let t = thetaSolver;
  while (t < -360) t += 720;
  while (t > 360) t -= 720;
  if (t >= -360 && t < -180) return 'INTAKE';
  if (t >= -180 && t < 0) return 'COMPRESSION';
  if (t >= 0 && t < 180) return 'POWER';
  return 'EXHAUST';
}

export const STROKE_LABEL: Record<Stroke, [string, string]> = {
  INTAKE: ['Emme', 'Intake'],
  COMPRESSION: ['Sıkıştırma', 'Compression'],
  POWER: ['Güç', 'Power'],
  EXHAUST: ['Egzoz', 'Exhaust'],
};

export const STROKE_COLOR: Record<Stroke, string> = {
  INTAKE: '#3fb950',
  COMPRESSION: '#4a9eff',
  POWER: '#f85149',
  EXHAUST: '#d29922',
};

/**
 * Bir silindirin, ana silindirin cozum izindeki karsilik gelen acisi.
 *
 * Tum silindirler ayni cevrimi yasar, sadece faz farkiyla. Bu yuzden
 * tek bir cevrim izi cozup hepsini ondan surebiliyoruz.
 */
export function phasedAngle(masterTheta: number, phase: number): number {
  // Cozucu izi −360…+360 araliginda; faz kaydirmasi sonrasi geri sar
  let t = masterTheta - phase;
  while (t < -360) t += 720;
  while (t > 360) t -= 720;
  return t;
}
