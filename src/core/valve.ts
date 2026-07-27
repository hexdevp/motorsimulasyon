/**
 * Supap kalkis profili ve akis modeli
 *
 * CEVRIM KOORDINAT SISTEMI (bu dosyadan sonra her yerde gecerli):
 *   theta = 0°   : ATESLEME UST OLU NOKTASI (yanma TDC'si)
 *   0   → 180°   : genisleme (guc) zamani
 *   180 → 360°   : egzoz zamani  (360° = bindirme TDC'si)
 *   360 → 540°   : emme zamani
 *   540 → 720°   : sikistirma zamani
 *
 * Kam zamanlamasi girdileri sektorde kullanilan bicimde:
 *   intakeCam.centerline  : bindirme TDC'sinden SONRA, krank derecesi (tipik 100-115)
 *   exhaustCam.centerline : bindirme TDC'sinden ONCE, krank derecesi (tipik 100-115)
 *   LSA (kam derecesi)    = (ICL + ECL) / 2
 *   Bindirme (krank °)    = (sure_emme + sure_egzoz)/2 − 2·LSA
 */

import type { CamProfile, Valvetrain_Spec } from './types';
import { clamp } from './gas';

/** Bindirme TDC'sinin cevrim koordinatindaki yeri */
export const OVERLAP_TDC = 360;

/**
 * Kalkis profili sekli.
 *
 * L(u) = L_max · (1 − |2u|^m)^n ,  u = (theta − merkez)/sure,  |u| ≤ 0.5
 *
 * m = 2, n = 2 secildi: egri altindaki alanin sinirlayici dikdortgene orani
 * 8/15 ≈ 0.533 cikar; gercek kamlarda bu oran 0.50–0.58 araligindadir.
 * Ayrica u = ±0.5'te hem kalkis hem egim sifir olur — supap koltuga
 * yumusak oturur, sayisal turevlerde siçrama olmaz.
 */
const PROFILE_M = 2;
const PROFILE_N = 2;

/** Reklam edilen sureden 0.050" (1.27 mm) tabanli sureye gecis carpani */
export const ADV_TO_050 = 0.82;

/**
 * Supap kalkisi (m).
 * @param thetaDeg Cevrim acisi (0-720)
 * @param cam Kam profili
 * @param centerCycleDeg Lobun cevrim koordinatindaki merkezi
 */
export function valveLift(thetaDeg: number, cam: CamProfile, centerCycleDeg: number): number {
  const D = cam.advertisedDuration;
  if (D <= 0 || cam.lift <= 0) return 0;
  // Cevrim 720° periyodik — merkeze en yakin temsili bul
  let dt = thetaDeg - centerCycleDeg;
  while (dt > 360) dt -= 720;
  while (dt < -360) dt += 720;
  const u = dt / D;
  if (Math.abs(u) >= 0.5) return 0;
  const base = 1 - Math.pow(Math.abs(2 * u), PROFILE_M);
  return cam.lift * Math.pow(Math.max(base, 0), PROFILE_N);
}

/** Emme lobunun cevrim koordinatindaki merkezi */
export function intakeCenter(vt: Valvetrain_Spec): number {
  return OVERLAP_TDC + vt.intakeCam.centerline;
}

/** Egzoz lobunun cevrim koordinatindaki merkezi */
export function exhaustCenter(vt: Valvetrain_Spec): number {
  return OVERLAP_TDC - vt.exhaustCam.centerline;
}

export function intakeLift(thetaDeg: number, vt: Valvetrain_Spec): number {
  return valveLift(thetaDeg, vt.intakeCam, intakeCenter(vt));
}

export function exhaustLift(thetaDeg: number, vt: Valvetrain_Spec): number {
  return valveLift(thetaDeg, vt.exhaustCam, exhaustCenter(vt));
}

/** Emme supabi acilmasi — bindirme TDC'sine gore (° BTDC, pozitif = once acilir) */
export function ivoBTDC(vt: Valvetrain_Spec): number {
  return vt.intakeCam.advertisedDuration / 2 - vt.intakeCam.centerline;
}

/** Emme supabi kapanmasi — BDC'ye gore (° ABDC) */
export function ivcABDC(vt: Valvetrain_Spec): number {
  return vt.intakeCam.centerline + vt.intakeCam.advertisedDuration / 2 - 180;
}

/** Emme supabi kapanmasi — cevrim koordinatinda */
export function ivcCycleAngle(vt: Valvetrain_Spec): number {
  return intakeCenter(vt) + vt.intakeCam.advertisedDuration / 2;
}

/** Egzoz supabi acilmasi — BDC'ye gore (° BBDC) */
export function evoBBDC(vt: Valvetrain_Spec): number {
  return vt.exhaustCam.centerline + vt.exhaustCam.advertisedDuration / 2 - 180;
}

/** Egzoz supabi kapanmasi — bindirme TDC'sine gore (° ATDC) */
export function evcATDC(vt: Valvetrain_Spec): number {
  return vt.exhaustCam.advertisedDuration / 2 - vt.exhaustCam.centerline;
}

/** Supap bindirmesi (krank derecesi) */
export function valveOverlap(vt: Valvetrain_Spec): number {
  return ivoBTDC(vt) + evcATDC(vt);
}

/** Lob ayrim acisi (kam derecesi) — girilen degerden bagimsiz, merkezlerden turetilir */
export function computedLSA(vt: Valvetrain_Spec): number {
  return (vt.intakeCam.centerline + vt.exhaustCam.centerline) / 2;
}

/**
 * Supabin efektif akis alani (m²).
 *
 * Iki kisit yarisir:
 *   1) PERDE ALANI  Ac = π·Dv·L  — dusuk kalkista belirleyici
 *   2) PORT BOGAZI  At = (π/4)·(0.85·Dv)²  — yuksek kalkista belirleyici
 *
 * Hangisi kucukse o sinirlar. Bu yuzden kalkisi surekli artirmak bir
 * yerden sonra akis kazandirmaz; "daha buyuk kam her zaman daha cok guc"
 * sanisinin kirildigi nokta tam olarak burasidir.
 *
 * @param lift Anlik supap kalkisi (m)
 * @param valveDia Supap tabla capi (m)
 * @param nValves Silindir basina bu tur supap sayisi
 * @param quality Port isciligi carpani (1.0 = stok dokum)
 * @param isExhaust Egzoz portu biraz daha dusuk Cd'ye sahiptir
 */
export function effectiveFlowArea(
  lift: number,
  valveDia: number,
  nValves: number,
  quality: number,
  isExhaust: boolean,
): number {
  if (lift <= 0) return 0;
  const LD = lift / valveDia;

  // Perde alani akis katsayisi: dusuk kalkista yuksek, kalkis arttikca
  // akis ayrilmasi basladigi icin duser.
  const cdCurtain = clamp(0.68 - 0.42 * LD, 0.30, 0.68);
  const curtain = Math.PI * valveDia * lift * cdCurtain;

  // Bogaz alani ve katsayisi
  const throatDia = 0.85 * valveDia;
  const cdThroat = isExhaust ? 0.78 : 0.83;
  const throat = (Math.PI / 4) * throatDia * throatDia * cdThroat;

  return Math.min(curtain, throat) * nValves * quality;
}

export function intakeFlowArea(thetaDeg: number, vt: Valvetrain_Spec): number {
  return effectiveFlowArea(
    intakeLift(thetaDeg, vt),
    vt.intakeValveDia,
    vt.intakeValvesPerCyl,
    vt.portFlowQuality,
    false,
  );
}

export function exhaustFlowArea(thetaDeg: number, vt: Valvetrain_Spec): number {
  return effectiveFlowArea(
    exhaustLift(thetaDeg, vt),
    vt.exhaustValveDia,
    vt.exhaustValvesPerCyl,
    vt.portFlowQuality,
    true,
  );
}

/**
 * Maksimum kalkistaki perde alani (m²) — statik rapor icin.
 */
export function maxCurtainArea(vt: Valvetrain_Spec): number {
  return Math.PI * vt.intakeValveDia * vt.intakeCam.lift * vt.intakeValvesPerCyl;
}

/**
 * Toplam supap alani / piston alani orani.
 * 0.25 civari zayif, 0.32+ iyi solunum demektir.
 */
export function valveToPistonAreaRatio(vt: Valvetrain_Spec, bore: number): number {
  const av = (Math.PI / 4) * vt.intakeValveDia * vt.intakeValveDia * vt.intakeValvesPerCyl;
  const ap = (Math.PI / 4) * bore * bore;
  return av / ap;
}

/**
 * Kam profilinin tepe ivmesinden supap yuzmesi RPM'i.
 *
 * L(u) = Lmax(1−4u²)² profilinin ikinci turevi u=0'da:
 *   d²L/du² = Lmax·(−8 + 96u²)|_{u=0} = −8·Lmax
 * u = (theta_kam)/(D_kam) oldugundan, D_kam = D_krank/2 (kam derecesi),
 * ve theta_kam = omega_kam·t ise:
 *   d²L/dt² = −8·Lmax·(omega_kam / D_kam_rad)²
 */
export function valveFloatThreshold(
  cam: CamProfile,
  springOpenForce: number,
  valveMass: number,
): number {
  const camDurationRad = ((cam.advertisedDuration / 2) * Math.PI) / 180;
  const accelCoeff = (8 * cam.lift) / (camDurationRad * camDurationRad);
  if (accelCoeff <= 0 || valveMass <= 0) return Infinity;
  // F_yay = m·a  =>  omega_kam² = F/(m·accelCoeff)
  const omegaCam = Math.sqrt(springOpenForce / (valveMass * accelCoeff));
  const rpmCam = (omegaCam * 60) / (2 * Math.PI);
  return rpmCam * 2; // krank RPM'i
}
