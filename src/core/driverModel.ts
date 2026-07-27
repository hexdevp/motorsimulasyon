/**
 * Surucu modeli — pedal dinamigi, otomatik debriyaj, vites, mars
 *
 * Bu mantik bilesenin icinde degil BURADA duruyor ki test edilebilsin.
 * Arayuze gomulu bir "if" zinciri, hatali davrandiginda ancak elle
 * deneyerek fark edilir; buradaki saf fonksiyon ise dogrudan test edilir.
 */

import { clamp } from './gas';

/** Pedallarin saniyede ne kadar hareket ettigi */
export const PEDAL_RATE = {
  throttleUp: 3.4, throttleDown: 5.0,
  brakeUp: 4.2, brakeDown: 6.0,
  clutchUp: 12.0, clutchDown: 3.2,
  handbrakeUp: 8, handbrakeDown: 8,
};

export type StarterPhase = 'off' | 'cranking' | 'catching' | 'running';

export interface DriverState {
  throttle: number;
  brake: number;
  clutch: number;
  handbrake: number;
  gear: number;
  /** Vites gecisi kalan sure (s) — bu sure boyunca debriyaj otomatik ayrilir */
  shiftTimer: number;
  /** Mars durumu */
  starter: StarterPhase;
  /** Mars fazinda gecen sure (s) */
  starterTime: number;
  /** Marsin motoru cevirdigi devir */
  crankRpm: number;
}

export interface DriverConfig {
  autoClutch: boolean;
  idleRpm: number;
  maxGear: number;
  /** Mars kac saniyede motoru tutusturur */
  startDelay: number;
}

export interface DriverInputs {
  throttle: boolean;
  brake: boolean;
  /** Debriyaj pedali TAM basili (Shift) */
  clutch: boolean;
  /**
   * Debriyaj YARIM basili (Ctrl).
   *
   * Kavrama noktasinda tutmak, kalkis ve yokusta kalkis icin gercek
   * surusun temel becerisidir; tam basili/tam birakilmis ikili secim
   * bunu imkansiz kilar.
   */
  halfClutch?: boolean;
  handbrake: boolean;
  starter: boolean;
}

export function initialDriverState(): DriverState {
  return {
    // Duran bir arac debriyaj BASILI bekler; kavramis halde durup
    // viteste beklemek zaten stall etmis olmak demektir.
    throttle: 0, brake: 0, clutch: 1, handbrake: 0, gear: 1,
    shiftTimer: 0, starter: 'running', starterTime: 0, crankRpm: 0,
  };
}

/** Bir yonde hizli, diger yonde yavas hareket eden pedal */
function ramp(cur: number, held: boolean, upRate: number, downRate: number, dt: number): number {
  return clamp(cur + (held ? upRate : -downRate) * dt, 0, 1);
}

/**
 * Vites degistir. Gecis suresi boyunca tork kesilir (debriyaj ayrilir).
 * Gecis devam ederken yeni vites komutu kabul edilmez.
 */
export function shiftGear(s: DriverState, dir: number, maxGear: number): boolean {
  if (s.shiftTimer > 0) return false;
  const next = clamp(s.gear + dir, -1, maxGear);
  if (next === s.gear) return false;
  s.gear = next;
  s.shiftTimer = 0.18;
  return true;
}

/**
 * Marsa bas. Motor zaten calisiyorsa hicbir sey yapmaz.
 * Mars ANINDA calistirmaz: once krank cevirir (mars sesi), sonra tutusur.
 */
export function engageStarter(s: DriverState, engineRunning: boolean): boolean {
  if (engineRunning || s.starter === 'cranking' || s.starter === 'catching') return false;
  s.starter = 'cranking';
  s.starterTime = 0;
  return true;
}

export interface DriverStepResult {
  /** Mars bu adimda motoru tutusturdu mu */
  ignited: boolean;
  /** Mars motoru cevirmeye devam ediyor mu (ses icin) */
  cranking: boolean;
  /** Marsin dayattigi devir (motor calismiyorken) */
  crankRpm: number;
}

/**
 * Surucu girdilerini bir adim ilerlet.
 *
 * @param engineRpm Motorun anlik devri
 * @param inputShaftRpm Vites kutusu giris mili devri (tekerlekten gelen).
 *        Otomatik debriyaj bunu kullanir — bkz. asagidaki aciklama.
 * @param engineRunning Motor calisiyor mu
 */
export function stepDriver(
  s: DriverState,
  cfg: DriverConfig,
  keys: DriverInputs,
  engineRpm: number,
  inputShaftRpm: number,
  engineRunning: boolean,
  dt: number,
): DriverStepResult {
  // ---------- Pedallar ----------
  s.throttle = ramp(s.throttle, keys.throttle, PEDAL_RATE.throttleUp, PEDAL_RATE.throttleDown, dt);
  s.brake = ramp(s.brake, keys.brake, PEDAL_RATE.brakeUp, PEDAL_RATE.brakeDown, dt);
  s.handbrake = ramp(s.handbrake, keys.handbrake, PEDAL_RATE.handbrakeUp, PEDAL_RATE.handbrakeDown, dt);

  // ---------- Debriyaj hedefi ----------
  // Oncelik sirasi onemli:
  //   1. Surucunun pedali (her zaman kazanir)
  //   2. Vites gecisi (otomatik ayirma)
  //   3. Otomatik debriyaj (yalnizca ACIKSA ve digerleri devrede degilse)
  // Tam pedal (Shift) > yarim pedal (Ctrl) > serbest
  let clutchTarget = keys.clutch ? 1 : keys.halfClutch ? 0.52 : 0;
  const driverPressing = keys.clutch || !!keys.halfClutch;

  if (!engineRunning && s.gear !== 0) {
    // DEBRIYAJ EMNIYET SALTERI.
    //
    // Gercek araclarda pedala basmadan mars donmez. Bu yalnizca bir
    // kolaylik degil, zorunluluk: viteste ve debriyaj kavramisken
    // tutusan motor duran tekerleklere kilitlenir ve aninda boğulur —
    // yani hicbir zaman calisamaz.
    clutchTarget = 1;
  } else if (s.shiftTimer > 0) {
    s.shiftTimer = Math.max(s.shiftTimer - dt, 0);
    clutchTarget = 1;
  } else if (cfg.autoClutch && !driverPressing && s.gear !== 0 && engineRunning) {
    // Otomatik debriyaj, gercek bir surucu gibi ONGORULU davranmali.
    //
    // Devir DUSTUKTEN sonra tepki vermek ise yaramaz: o noktada motor
    // zaten aktarmaya kilitlenmis ve negatif tork altindadir, birkac
    // yuz milisaniyede stall eder. Bu yuzden olcut devir degil, GIRIS
    // MILI ile motor arasindaki hiz farkidir.
    //
    // Arac dururken giris mili sifirdir → debriyaj tamamen acik.
    // Hiz arttikca giris mili rolantiye yaklasir → debriyaj kapanir.
    // Kalkista debriyaj kaydirmanin fizigi tam olarak budur.
    const matchRatio = inputShaftRpm / Math.max(cfg.idleRpm * 1.15, 1);
    let target = clamp(1 - matchRatio, 0, 1);
    // Gaz verildikce surucu debriyaji daha cabuk birakir
    target *= 1 - 0.4 * clamp(s.throttle, 0, 1);

    // Ek guvenlik: hiz eslesmesi iyi gorunse bile devir rolantinin
    // altina dusuyorsa surucu debriyaji ANINDA basar. Bu, yokusta veya
    // beklenmedik yuk altinda stall'i onleyen refleks.
    if (engineRpm < cfg.idleRpm * 0.95) {
      const rescue = clamp(
        1 - (engineRpm - cfg.idleRpm * 0.5) / (cfg.idleRpm * 0.45), 0, 1,
      );
      target = Math.max(target, rescue);
    }
    clutchTarget = Math.max(clutchTarget, target);
  }

  s.clutch = clutchTarget > s.clutch
    ? clamp(s.clutch + PEDAL_RATE.clutchUp * dt, 0, clutchTarget)
    : clamp(s.clutch - PEDAL_RATE.clutchDown * dt, clutchTarget, 1);

  // ---------- Mars ----------
  let ignited = false;
  let cranking = false;
  let crankRpm = 0;

  if (keys.starter && !engineRunning && s.starter !== 'cranking' && s.starter !== 'catching') {
    engageStarter(s, engineRunning);
  }

  if (s.starter === 'cranking') {
    s.starterTime += dt;
    cranking = true;
    // Mars motoru krank'i 220-300 rpm arasinda, hafif dalgalanarak cevirir
    crankRpm = 250 + 45 * Math.sin(s.starterTime * 26);
    if (s.starterTime >= cfg.startDelay) {
      s.starter = 'catching';
      s.starterTime = 0;
      ignited = true;
    } else if (!keys.starter && s.starterTime > 0.25) {
      // Mars tusu birakildiysa cevirmeyi birak
      s.starter = 'off';
    }
  } else if (s.starter === 'catching') {
    // Motor tutustu, devir rolantiye firlar
    s.starterTime += dt;
    if (s.starterTime > 0.6) s.starter = 'running';
  } else if (engineRunning) {
    s.starter = 'running';
  } else {
    s.starter = 'off';
  }

  s.crankRpm = crankRpm;
  return { ignited, cranking, crankRpm };
}
