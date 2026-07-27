/**
 * Krank-biyel kinematigi ve silindir geometrisi
 *
 * Tum fonksiyonlar KAPALI FORM turevler kullanir (sayisal fark degil).
 * Krank acisi theta: 0° = ates ust olu nokta (TDC), derece cinsinden.
 * Piston yer degistirmesi x: TDC'den itibaren, BDC yonu pozitif.
 *
 * Pim ofseti (desaksiyel krank) dahil edilmistir — modern motorlarda
 * 1-3 mm ofset yan kuvveti %10'a varan oranda azaltir ve piston hizi
 * profilini asimetrik yapar. Ihmal eden simulasyonlar etek asinmasini
 * ve surtunmeyi yanlis tahmin eder.
 */

import type { Geometry, EngineConfig, Mechanical } from './types';

const DEG = Math.PI / 180;

export interface CrankKinematics {
  /** Krank yaricapi a = strok/2 (m) */
  a: number;
  /** Biyel uzunlugu (m) */
  L: number;
  /** Pim ofseti (m) */
  d: number;
  /** Piston tepe alani (m^2) */
  pistonArea: number;
  /** Sikistirma (olu) hacmi (m^3) */
  clearanceVolume: number;
  /** Strok hacmi, silindir basina (m^3) */
  sweptVolume: number;
  /** TDC'de biyel+krank ekseninin uzanimi — x=0 referansi */
  K0: number;
}

export function makeKinematics(g: Geometry): CrankKinematics {
  const a = g.stroke / 2;
  const L = g.rodLength;
  const d = g.pinOffset;
  const pistonArea = (Math.PI / 4) * g.bore * g.bore;
  const sweptVolume = pistonArea * g.stroke;
  const clearanceVolume = sweptVolume / (g.compressionRatio - 1);
  // Ofsetli krankta TDC, theta=0'da degil; K0 x(theta) fonksiyonunun
  // minimumunu 0 yapan sabittir.
  const K0 = Math.sqrt((L + a) * (L + a) - d * d);
  return { a, L, d, pistonArea, clearanceVolume, sweptVolume, K0 };
}

/** Piston yer degistirmesi, TDC'den (m) */
export function pistonPosition(k: CrankKinematics, thetaDeg: number): number {
  const t = thetaDeg * DEG;
  const s = k.a * Math.sin(t) - k.d;
  return k.K0 - k.a * Math.cos(t) - Math.sqrt(k.L * k.L - s * s);
}

/** dx/dtheta (m/rad) */
export function pistonPositionDeriv(k: CrankKinematics, thetaDeg: number): number {
  const t = thetaDeg * DEG;
  const s = k.a * Math.sin(t) - k.d;
  const R = Math.sqrt(k.L * k.L - s * s);
  return k.a * Math.sin(t) + (s * k.a * Math.cos(t)) / R;
}

/** d²x/dtheta² (m/rad²) */
export function pistonPositionDeriv2(k: CrankKinematics, thetaDeg: number): number {
  const t = thetaDeg * DEG;
  const c = Math.cos(t);
  const s = k.a * Math.sin(t) - k.d;
  const R = Math.sqrt(k.L * k.L - s * s);
  return (
    k.a * c +
    (k.a * (k.a * c * c - s * Math.sin(t))) / R +
    (k.a * k.a * s * s * c * c) / (R * R * R)
  );
}

/** Anlik silindir hacmi (m^3) */
export function cylinderVolume(k: CrankKinematics, thetaDeg: number): number {
  return k.clearanceVolume + k.pistonArea * pistonPosition(k, thetaDeg);
}

/** dV/dtheta (m^3/rad) — enerji korunumunda is terimi icin */
export function cylinderVolumeDeriv(k: CrankKinematics, thetaDeg: number): number {
  return k.pistonArea * pistonPositionDeriv(k, thetaDeg);
}

/** Piston hizi (m/s) */
export function pistonVelocity(k: CrankKinematics, thetaDeg: number, rpm: number): number {
  const omega = (rpm * 2 * Math.PI) / 60;
  return pistonPositionDeriv(k, thetaDeg) * omega;
}

/** Piston ivmesi (m/s²) — sabit acisal hiz varsayimi */
export function pistonAcceleration(k: CrankKinematics, thetaDeg: number, rpm: number): number {
  const omega = (rpm * 2 * Math.PI) / 60;
  return pistonPositionDeriv2(k, thetaDeg) * omega * omega;
}

/** Biyel kolunun silindir eksenine gore acisi (radyan) */
export function rodAngle(k: CrankKinematics, thetaDeg: number): number {
  const t = thetaDeg * DEG;
  const s = k.a * Math.sin(t) - k.d;
  return Math.asin(s / k.L);
}

/** Ortalama piston hizi (m/s) — dayaniklilik gostergesinin bir numarali metrigi */
export function meanPistonSpeed(stroke: number, rpm: number): number {
  return (2 * stroke * rpm) / 60;
}

/** Gidip gelen (reciprocating) esdeger kutle (kg) */
export function reciprocatingMass(m: Mechanical): number {
  return m.pistonMass + m.rodMass * (1 - m.rodRotatingFraction);
}

/** Donen esdeger kutle (kg) — krank pimindeki */
export function rotatingMass(m: Mechanical): number {
  return m.rodMass * m.rodRotatingFraction;
}

export interface PistonForces {
  /** Silindir ekseni boyunca net kuvvet (N) */
  axial: number;
  /** Biyel kolu boyunca kuvvet (N) — yatak yukunun ana bileseni */
  rodForce: number;
  /** Etek yan kuvveti (N) — pozitif = basinc tarafi */
  sideForce: number;
  /** Biyel acisi (rad) */
  rodAngleRad: number;
}

/**
 * Piston/biyel kuvvet dagilimi.
 *
 * Piston hareket denklemi (x yonu = BDC'ye dogru pozitif):
 *   m·ẍ = (P_sil − P_karter)·Ap − F_biyel·cos(φ)
 * Buradan eksenel kuvvet ve yan itme cikar. Yan kuvvet etek asinmasini
 * ve surtunme kaybini belirler; biyel kuvveti ise yatak yukunu.
 */
export function pistonForces(
  k: CrankKinematics,
  thetaDeg: number,
  rpm: number,
  cylinderPressure: number,
  crankcasePressure: number,
  recipMass: number,
): PistonForces {
  const phi = rodAngle(k, thetaDeg);
  const accel = pistonAcceleration(k, thetaDeg, rpm);
  const gasForce = (cylinderPressure - crankcasePressure) * k.pistonArea;
  const axial = gasForce - recipMass * accel;
  const rodForce = axial / Math.cos(phi);
  const sideForce = axial * Math.tan(phi);
  return { axial, rodForce, sideForce, rodAngleRad: phi };
}

/**
 * Dinamik sikistirma orani.
 *
 * Statik CR yaniltici bir sayidir: emme supabi BDC'den sonra kapanir,
 * dolayisiyla gercek sikistirma BDC'de degil IVC'de baslar. Agresif kamli
 * bir motorda 11:1 statik CR, 8.5:1 dinamik CR'ye dusebilir — bu yuzden
 * yuksek CR ile buyuk kam bir arada kullanilabilir.
 */
export function dynamicCompressionRatio(k: CrankKinematics, ivcDegATDC: number): number {
  const vIVC = cylinderVolume(k, ivcDegATDC);
  return vIVC / k.clearanceVolume;
}

/**
 * Krank + volan + gidip gelen parcalarin esdeger atalet momenti (kg·m²).
 * Gidip gelen kutlelerin katkisi krank acisina gore degisir; cevrim
 * ortalamasi olarak m_recip·a²/2 kullaniyoruz (standart yaklasim).
 */
export function totalInertia(cfg: EngineConfig, k: CrankKinematics): number {
  const nCyl = cylinderCount(cfg.layout);
  const recip = reciprocatingMass(cfg.mechanical);
  const rot = rotatingMass(cfg.mechanical);
  const perCyl = (recip * k.a * k.a) / 2 + rot * k.a * k.a;
  return cfg.mechanical.crankInertia + cfg.mechanical.flywheelInertia + nCyl * perCyl;
}

/** Dizilimden silindir sayisi */
export function cylinderCount(layout: string): number {
  const m = layout.match(/\d+/);
  return m ? parseInt(m[0], 10) : 4;
}

/** Dizilimin banka acisi (derece) */
export function bankAngle(layout: string): number {
  if (layout.startsWith('B')) return 180;
  if (layout.startsWith('V')) {
    switch (layout) {
      case 'V6': return 60;
      case 'V8': return 90;
      case 'V10': return 72;
      case 'V12': return 60;
      default: return 90;
    }
  }
  return 0;
}
