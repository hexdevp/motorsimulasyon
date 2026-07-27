/**
 * Aktarma organlari ve arac dinamigi
 *
 * Motor artik bir dinamometrede degil, bir ARACIN icinde. Zincir:
 *
 *   motor → debriyaj → vites kutusu → şaft → diferansiyel → tekerlek → yol
 *
 * Modelin kritik tarafi, bu zincirin her yerinde AYRILABILIR olmasi:
 * debriyaj kayabilir, lastik patinaj yapabilir, vites bosta olabilir.
 * Her ayrilma noktasi kendi dinamigini kazanir ve surus hissini
 * belirleyen sey tam olarak bunlardir.
 *
 * SAYISAL YAKLASIM: yay-benzeri "sert kuplaj" yerine, birlesik atalet
 * (lumped inertia) kullanilir. Debriyaj kavradiginda ve lastik
 * tutundugunda motor+aktarma+arac TEK bir atalet olarak cozulur;
 * yalnizca kayma basladiginda ayrilirlar. Bu, 60 fps'te kararlidir —
 * sert yay modeli mikrosaniye adim gerektirir ve titrer.
 */

import { clamp } from './gas';

export type DriveLayout = 'FWD' | 'RWD' | 'AWD';

export interface VehicleSpec {
  id: string;
  name: string;
  /** Bos agirlik + surucu (kg) */
  mass: number;
  /** Aerodinamik direnc katsayisi */
  dragCoefficient: number;
  /** Alin alani (m²) */
  frontalArea: number;
  /** Yuvarlanma direnci katsayisi */
  rollingResistance: number;
  /** Tekerlek yuvarlanma yaricapi (m) */
  wheelRadius: number;
  /** Dort tekerlegin toplam atalet momenti (kg·m²) */
  wheelInertia: number;
  /** Vites oranlari (1. vitesten sona) */
  gearRatios: number[];
  /** Diferansiyel oranı */
  finalDrive: number;
  /** Aktarma mekanik verimi */
  drivelineEfficiency: number;
  /** Debriyaj tasima kapasitesi (N·m) — kavradiginda */
  clutchCapacity: number;
  /** Tekerleklerdeki toplam maksimum fren torku (N·m) */
  maxBrakeTorque: number;
  /** El freni torku (arka tekerlekler) (N·m) */
  handbrakeTorque: number;
  /** Lastik-yol surtunme katsayisi */
  tireGrip: number;
  layout: DriveLayout;
  /** Statik agirligin on aksta olan orani */
  frontWeightBias: number;
}

/** Motor presetlerine eslesen arac tanimlari */
export const VEHICLES: Record<string, VehicleSpec> = {
  '2jz-gte': {
    id: '2jz-gte', name: 'Toyota Supra A80', mass: 1570,
    dragCoefficient: 0.31, frontalArea: 1.94, rollingResistance: 0.013,
    wheelRadius: 0.328, wheelInertia: 4.4,
    gearRatios: [3.83, 2.36, 1.69, 1.31, 1.00, 0.79], finalDrive: 3.13,
    drivelineEfficiency: 0.90, clutchCapacity: 620, maxBrakeTorque: 9200,
    handbrakeTorque: 1300, tireGrip: 1.05, layout: 'RWD', frontWeightBias: 0.53,
  },
  ls3: {
    id: 'ls3', name: 'Chevrolet Corvette C6', mass: 1470,
    dragCoefficient: 0.29, frontalArea: 1.86, rollingResistance: 0.012,
    wheelRadius: 0.334, wheelInertia: 4.2,
    gearRatios: [2.97, 2.07, 1.43, 1.00, 0.84, 0.56], finalDrive: 3.42,
    drivelineEfficiency: 0.91, clutchCapacity: 720, maxBrakeTorque: 9800,
    handbrakeTorque: 1200, tireGrip: 1.10, layout: 'RWD', frontWeightBias: 0.51,
  },
  k20a: {
    id: 'k20a', name: 'Honda Civic Type R EP3', mass: 1205,
    dragCoefficient: 0.33, frontalArea: 2.05, rollingResistance: 0.013,
    wheelRadius: 0.312, wheelInertia: 3.6,
    gearRatios: [3.27, 2.13, 1.52, 1.15, 0.92, 0.74], finalDrive: 4.76,
    drivelineEfficiency: 0.92, clutchCapacity: 320, maxBrakeTorque: 7400,
    handbrakeTorque: 900, tireGrip: 1.00, layout: 'FWD', frontWeightBias: 0.62,
  },
  ej257: {
    id: 'ej257', name: 'Subaru Impreza STI', mass: 1495,
    dragCoefficient: 0.34, frontalArea: 2.11, rollingResistance: 0.014,
    wheelRadius: 0.317, wheelInertia: 4.6,
    gearRatios: [3.64, 2.24, 1.59, 1.14, 0.89, 0.71], finalDrive: 3.90,
    drivelineEfficiency: 0.86, clutchCapacity: 520, maxBrakeTorque: 8600,
    handbrakeTorque: 1100, tireGrip: 1.12, layout: 'AWD', frontWeightBias: 0.58,
  },
  b58: {
    id: 'b58', name: 'BMW M240i', mass: 1610,
    dragCoefficient: 0.32, frontalArea: 2.02, rollingResistance: 0.012,
    wheelRadius: 0.330, wheelInertia: 4.5,
    gearRatios: [4.71, 3.14, 2.11, 1.67, 1.29, 1.00, 0.84, 0.67], finalDrive: 3.15,
    drivelineEfficiency: 0.89, clutchCapacity: 680, maxBrakeTorque: 9600,
    handbrakeTorque: 1200, tireGrip: 1.08, layout: 'RWD', frontWeightBias: 0.52,
  },
  rb26dett: {
    id: 'rb26dett', name: 'Nissan Skyline GT-R R34', mass: 1560,
    dragCoefficient: 0.34, frontalArea: 1.98, rollingResistance: 0.013,
    wheelRadius: 0.325, wheelInertia: 4.7,
    gearRatios: [3.83, 2.36, 1.69, 1.31, 1.00, 0.79], finalDrive: 3.55,
    drivelineEfficiency: 0.85, clutchCapacity: 560, maxBrakeTorque: 9400,
    handbrakeTorque: 1250, tireGrip: 1.12, layout: 'AWD', frontWeightBias: 0.56,
  },
  coyote: {
    id: 'coyote', name: 'Ford Mustang GT S550', mass: 1690,
    dragCoefficient: 0.35, frontalArea: 2.16, rollingResistance: 0.013,
    wheelRadius: 0.340, wheelInertia: 4.8,
    gearRatios: [3.24, 2.29, 1.61, 1.28, 1.00, 0.75], finalDrive: 3.55,
    drivelineEfficiency: 0.90, clutchCapacity: 640, maxBrakeTorque: 9700,
    handbrakeTorque: 1200, tireGrip: 1.05, layout: 'RWD', frontWeightBias: 0.53,
  },
  barra: {
    id: 'barra', name: 'Ford Falcon XR6 Turbo', mass: 1720,
    dragCoefficient: 0.32, frontalArea: 2.22, rollingResistance: 0.013,
    wheelRadius: 0.335, wheelInertia: 5.0,
    gearRatios: [3.36, 1.95, 1.41, 1.00, 0.79, 0.64], finalDrive: 3.45,
    drivelineEfficiency: 0.89, clutchCapacity: 680, maxBrakeTorque: 9500,
    handbrakeTorque: 1300, tireGrip: 1.02, layout: 'RWD', frontWeightBias: 0.54,
  },
  ea888: {
    id: 'ea888', name: 'VW Golf GTI Mk7', mass: 1320,
    dragCoefficient: 0.31, frontalArea: 2.19, rollingResistance: 0.012,
    wheelRadius: 0.316, wheelInertia: 3.9,
    gearRatios: [3.77, 2.27, 1.53, 1.12, 0.87, 0.71], finalDrive: 3.55,
    drivelineEfficiency: 0.91, clutchCapacity: 400, maxBrakeTorque: 7800,
    handbrakeTorque: 950, tireGrip: 1.02, layout: 'FWD', frontWeightBias: 0.61,
  },
  'viper-v10': {
    id: 'viper-v10', name: 'Dodge Viper SRT-10', mass: 1560,
    dragCoefficient: 0.39, frontalArea: 2.02, rollingResistance: 0.013,
    wheelRadius: 0.343, wheelInertia: 5.1,
    gearRatios: [2.66, 1.78, 1.30, 1.00, 0.74, 0.50], finalDrive: 3.07,
    drivelineEfficiency: 0.91, clutchCapacity: 900, maxBrakeTorque: 10200,
    handbrakeTorque: 1200, tireGrip: 1.15, layout: 'RWD', frontWeightBias: 0.49,
  },
  'v12-na': {
    id: 'v12-na', name: 'Ferrari F12-tipi GT', mass: 1630,
    dragCoefficient: 0.30, frontalArea: 1.99, rollingResistance: 0.012,
    wheelRadius: 0.345, wheelInertia: 4.6,
    gearRatios: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], finalDrive: 3.60,
    drivelineEfficiency: 0.90, clutchCapacity: 780, maxBrakeTorque: 10500,
    handbrakeTorque: 1200, tireGrip: 1.18, layout: 'RWD', frontWeightBias: 0.46,
  },
  '4age': {
    id: '4age', name: 'Toyota AE86 Levin', mass: 950,
    dragCoefficient: 0.36, frontalArea: 1.83, rollingResistance: 0.014,
    wheelRadius: 0.295, wheelInertia: 3.0,
    gearRatios: [3.59, 2.25, 1.44, 1.00, 0.86], finalDrive: 4.30,
    drivelineEfficiency: 0.90, clutchCapacity: 220, maxBrakeTorque: 5800,
    handbrakeTorque: 800, tireGrip: 0.92, layout: 'RWD', frontWeightBias: 0.54,
  },
};

export function vehicleFor(engineId: string): VehicleSpec {
  return VEHICLES[engineId] ?? VEHICLES['2jz-gte'];
}

// ============================================================
// SURUCU GIRDILERI VE ARAC DURUMU
// ============================================================

export interface DriverInput {
  /** Gaz (0-1) */
  throttle: number;
  /** Fren (0-1) */
  brake: number;
  /** Debriyaj pedali (0 = kavradi, 1 = tam ayrik) */
  clutch: number;
  /** El freni (0-1) */
  handbrake: number;
  /** Vites: 0 = bos, 1..n = ileri vitesler, -1 = geri */
  gear: number;
}

export interface VehicleState {
  /** Motor acisal hizi (rad/s) */
  engineOmega: number;
  /** Tahrik tekerleklerinin acisal hizi (rad/s) */
  wheelOmega: number;
  /** Arac hizi (m/s) */
  speed: number;
  /** Kat edilen mesafe (m) */
  distance: number;
  /** Motor calisiyor mu */
  running: boolean;
}

export interface DriveResult {
  state: VehicleState;
  /** Motor devri (rpm) */
  rpm: number;
  /** Hiz (km/s) */
  speedKmh: number;
  /** Motorun urettigi tork (N·m) */
  engineTorque: number;
  /** Debriyajdan gecen tork (N·m) */
  clutchTorque: number;
  /** Debriyaj kayiyor mu */
  clutchSlipping: boolean;
  /** Debriyaj kayma hizi (rad/s) */
  clutchSlipSpeed: number;
  /** Tekerlekteki tork (N·m) */
  wheelTorque: number;
  /** Yola aktarilan cekis kuvveti (N) */
  tractionForce: number;
  /** Lastigin tasiyabilecegi maksimum kuvvet (N) */
  gripLimit: number;
  /** Tekerlek patinaj yapiyor mu */
  wheelSpin: boolean;
  /** Patinaj hizi (m/s cinsinden fark) */
  slipSpeed: number;
  /** Boyuna ivme (m/s²) */
  acceleration: number;
  /** Aerodinamik direnc (N) */
  dragForce: number;
  /** Yuvarlanma direnci (N) */
  rollingForce: number;
  /** Fren kuvveti (N) */
  brakeForce: number;
  /** Rev limiter devrede mi */
  revLimiter: boolean;
  /** Motor stall etti mi */
  stalled: boolean;
  /** Tekerlege ulasan guc (W) */
  wheelPower: number;
}

const RPM_TO_RAD = (2 * Math.PI) / 60;
const RAD_TO_RPM = 60 / (2 * Math.PI);
const G = 9.81;
const AIR_DENSITY = 1.20;

export function initialVehicleState(idleRpm: number): VehicleState {
  return {
    engineOmega: idleRpm * RPM_TO_RAD,
    wheelOmega: 0,
    speed: 0,
    distance: 0,
    running: true,
  };
}

/** Toplam aktarma orani (motor devri / tekerlek devri) */
export function totalRatio(v: VehicleSpec, gear: number): number {
  if (gear === 0) return 0;
  if (gear < 0) return -v.gearRatios[0] * 1.15 * v.finalDrive; // geri vites
  const g = v.gearRatios[Math.min(gear, v.gearRatios.length) - 1];
  return g * v.finalDrive;
}

/** Belirli bir vitesde, verilen hizda motor devri */
export function rpmAtSpeed(v: VehicleSpec, gear: number, speedMs: number): number {
  const n = totalRatio(v, gear);
  if (n === 0) return 0;
  return (speedMs / v.wheelRadius) * Math.abs(n) * RAD_TO_RPM;
}

/** Vites basina teorik maksimum hiz (km/s) */
export function topSpeedPerGear(v: VehicleSpec, redline: number): number[] {
  return v.gearRatios.map((_, i) => {
    const n = totalRatio(v, i + 1);
    return ((redline * RPM_TO_RAD) / n) * v.wheelRadius * 3.6;
  });
}

/**
 * Bir zaman adimi ilerlet.
 *
 * @param torqueLookup (rpm, throttle) → motor torku (N·m)
 * @param dt Adim suresi (s) — 5 ms'den buyukse ic adimlara bolunur
 */
export function stepVehicle(
  state: VehicleState,
  v: VehicleSpec,
  input: DriverInput,
  torqueLookup: (rpm: number, throttle: number) => number,
  engineInertia: number,
  idleRpm: number,
  redline: number,
  dt: number,
  gradient = 0,
): DriveResult {
  // Sayisal kararlilik icin ic adimlara bol
  const subSteps = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / subSteps;
  let last: DriveResult | null = null;
  for (let i = 0; i < subSteps; i++) {
    last = stepOnce(state, v, input, torqueLookup, engineInertia, idleRpm, redline, h, gradient);
  }
  return last!;
}

function stepOnce(
  s: VehicleState,
  v: VehicleSpec,
  input: DriverInput,
  torqueLookup: (rpm: number, throttle: number) => number,
  engineInertia: number,
  idleRpm: number,
  redline: number,
  dt: number,
  gradient: number,
): DriveResult {
  const n = totalRatio(v, input.gear);
  const inGear = n !== 0;
  const eff = v.drivelineEfficiency;

  let rpm = s.engineOmega * RAD_TO_RPM;

  // ---------- Motor torku ----------
  // Rev limiter: kirmizi cizgide yakit kesilir, %2 asagida geri gelir.
  const revLimiter = rpm >= redline;
  const effThrottle = revLimiter ? 0 : input.throttle;
  let engineTorque = s.running ? torqueLookup(Math.max(rpm, 300), effThrottle) : 0;

  // Rolanti kontrolu: motor rolantinin altina duserse ECU hava/yakit
  // ekleyerek tutmaya calisir. Gercek motorlarda bu, debriyaji yavas
  // biraktiginizda aracin kendiliginden hareket etmesini saglar.
  if (s.running && rpm < idleRpm * 1.15 && input.throttle < 0.05) {
    const deficit = clamp((idleRpm * 1.15 - rpm) / (idleRpm * 0.4), 0, 1);
    engineTorque += deficit * 55;
  }

  // ---------- Fren ----------
  const brakeTorque =
    input.brake * v.maxBrakeTorque + input.handbrake * v.handbrakeTorque;

  // ---------- Yol direncleri ----------
  const speedAbs = Math.abs(s.speed);
  const dragForce = 0.5 * AIR_DENSITY * v.dragCoefficient * v.frontalArea * s.speed * speedAbs;
  const rollingForce = v.rollingResistance * v.mass * G * Math.sign(s.speed || 1) *
    (speedAbs > 0.05 ? 1 : 0);
  const gradeForce = v.mass * G * Math.sin(gradient);
  const resistForce = dragForce + rollingForce + gradeForce;

  // ---------- Lastik tutunma siniri ----------
  // Tahrik aksina binen agirlik. Hizlanirken agirlik arkaya kayar;
  // arkadan itiste bu tutunmayi ARTIRIR, onden cekiste azaltir —
  // on cekisli araclarin kalkista neden daha kolay patinaj yaptigi budur.
  const accelEstimate = s.speed !== 0 ? 0 : 0;
  const weightShift = clamp(accelEstimate * 0.06, -0.15, 0.15);
  const driveWeightFraction =
    v.layout === 'AWD' ? 1.0
      : v.layout === 'RWD' ? (1 - v.frontWeightBias) + weightShift
      : v.frontWeightBias - weightShift;
  // Hizlanmada yalnizca TAHRIK aksi tutunur...
  const gripLimit = v.tireGrip * v.mass * G * driveWeightFraction;
  // ...ama frenlerken DORT tekerlek birden tutunur. Bu ayrimi yapmazsak
  // fren mesafesi arkadan itiste iki katina cikar, onden cekiste yariya iner.
  const gripBrake = v.tireGrip * v.mass * G;

  // ---------- Debriyaj ----------
  // Kapasite pedal konumuyla azalir. Pedal tam basiliyken sifir.
  const clutchCapacity = v.clutchCapacity * Math.pow(clamp(1 - input.clutch, 0, 1), 1.6);

  let clutchTorque = 0;
  let clutchSlipping = false;
  let clutchSlipSpeed = 0;
  let tractionForce = 0;
  let wheelSpin = false;
  let acceleration = 0;

  if (!inGear || clutchCapacity <= 1) {
    // ---- BOSTA veya DEBRIYAJ AYRIK ----
    // Motor serbest doner, arac serbest yuvarlanir. Ikisi birbirini
    // hic etkilemez — gaz verince devir firlar, arac yavaslar.
    s.engineOmega += (engineTorque / engineInertia) * dt;

    const wheelInertiaEff = v.wheelInertia + v.mass * v.wheelRadius * v.wheelRadius;
    const netWheelTorque =
      -resistForce * v.wheelRadius - Math.sign(s.wheelOmega || 1) * brakeTorque *
      (Math.abs(s.wheelOmega) > 0.1 ? 1 : 0);
    const domega = (netWheelTorque / wheelInertiaEff) * dt;
    s.wheelOmega = s.wheelOmega + domega;
    if (s.speed > 0 && s.wheelOmega < 0) s.wheelOmega = 0;
    s.speed = s.wheelOmega * v.wheelRadius;
    acceleration = (domega * v.wheelRadius) / dt;
    tractionForce = 0;
  } else {
    // ---- VITESTE ----
    const inputOmega = s.wheelOmega * Math.abs(n);
    clutchSlipSpeed = s.engineOmega - inputOmega;

    // Once KAVRAMIS varsayip gereken torku hesapla. Bu tork kapasiteyi
    // asiyorsa debriyaj kayar.
    const inertiaAtWheel =
      v.wheelInertia + v.mass * v.wheelRadius * v.wheelRadius +
      engineInertia * n * n;
    const wheelTorqueLocked = engineTorque * Math.abs(n) * eff;
    const netLocked =
      wheelTorqueLocked - resistForce * v.wheelRadius -
      Math.sign(s.wheelOmega || Math.sign(engineTorque)) * brakeTorque *
      (Math.abs(s.wheelOmega) > 0.05 || brakeTorque > 0 ? 1 : 0);
    const alphaLocked = netLocked / inertiaAtWheel;
    // Kavramis durumda debriyajin tasimasi gereken tork
    const requiredClutch = Math.abs(engineTorque - engineInertia * alphaLocked * Math.abs(n));

    if (requiredClutch > clutchCapacity || Math.abs(clutchSlipSpeed) > 3) {
      // ---- DEBRIYAJ KAYIYOR ----
      // Iki taraf ayri cozulur. Aktarilan tork kapasiteyle sinirlidir;
      // kalkista debriyaji yakan sey budur ve kayma isiyi uretir.
      clutchSlipping = true;
      clutchTorque = clutchCapacity * Math.sign(clutchSlipSpeed || 1);

      s.engineOmega += ((engineTorque - clutchTorque) / engineInertia) * dt;

      const wheelSide = clutchTorque * Math.abs(n) * eff;
      const res = solveWheels(
        s, v, wheelSide, resistForce, brakeTorque, gripLimit, gripBrake,
        v.wheelInertia, dt,
      );
      tractionForce = res.traction;
      wheelSpin = res.spin;
      acceleration = res.accel;
    } else {
      // ---- DEBRIYAJ KAVRAMIS ----
      // Motor + aktarma + arac tek bir atalet olarak cozulur.
      clutchTorque = requiredClutch * Math.sign(engineTorque || 1);

      const res = solveWheels(
        s, v, wheelTorqueLocked, resistForce, brakeTorque, gripLimit, gripBrake,
        v.wheelInertia + engineInertia * n * n, dt,
      );
      tractionForce = res.traction;
      wheelSpin = res.spin;
      acceleration = res.accel;

      if (!res.spin) {
        // Patinaj yoksa motor tekerlege kilitlidir
        s.engineOmega = s.wheelOmega * Math.abs(n);
      } else {
        // Patinajda tekerlek (ve motor) araçtan hizli doner
        s.engineOmega = s.wheelOmega * Math.abs(n);
      }
    }
  }

  // ---------- Stall ----------
  // Debriyaj kavramisken devir cok duserse motor boguluр.
  let stalled = false;
  rpm = s.engineOmega * RAD_TO_RPM;
  if (s.running && inGear && input.clutch < 0.55 && rpm < idleRpm * 0.42) {
    s.running = false;
    stalled = true;
    s.engineOmega = 0;
  }
  if (!s.running) {
    s.engineOmega = Math.max(s.engineOmega - 40 * dt, 0);
  }
  s.engineOmega = Math.max(s.engineOmega, 0);
  if (s.speed < 0.02 && s.speed > -0.02 && input.throttle < 0.02) {
    s.speed = 0; s.wheelOmega = 0;
  }
  s.distance += s.speed * dt;

  rpm = s.engineOmega * RAD_TO_RPM;
  const wheelTorque = tractionForce * v.wheelRadius;

  return {
    state: s,
    rpm,
    speedKmh: s.speed * 3.6,
    engineTorque,
    clutchTorque,
    clutchSlipping,
    clutchSlipSpeed,
    wheelTorque,
    tractionForce,
    gripLimit,
    wheelSpin,
    slipSpeed: s.wheelOmega * v.wheelRadius - s.speed,
    acceleration,
    dragForce,
    rollingForce,
    brakeForce: brakeTorque / v.wheelRadius,
    revLimiter,
    stalled,
    wheelPower: tractionForce * s.speed,
  };
}

/**
 * Tekerlek ve arac dinamigi — patinaj kontrolüyle.
 *
 * Once patinaj YOK varsayilir (tekerlek ve arac birlikte hareket eder).
 * Gereken cekis kuvveti lastigin tasiyabilecegini asiyorsa patinaja
 * gecilir: cekis kuvveti sinirda kalir, tekerlek araçtan bagimsiz
 * hizlanir. Kalkista gaz koklendiginde devrin firlayip aracin
 * hizlanmamasinin sebebi budur.
 */
function solveWheels(
  s: VehicleState,
  v: VehicleSpec,
  driveTorque: number,
  resistForce: number,
  brakeTorque: number,
  gripDrive: number,
  gripBrake: number,
  rotatingInertia: number,
  dt: number,
): { traction: number; spin: boolean; accel: number } {
  const r = v.wheelRadius;
  const dir = Math.sign(s.wheelOmega) || Math.sign(driveTorque) || 1;

  // Fren torku: tekerlek donerken KINETIK, dururken STATIK olarak davranir.
  //
  // Onceki surumde tekerlek hizi ~0 iken fren tamamen devre disi
  // kaliyordu; bu yuzden el freni cekiliyken bile arac rolantide
  // surunuyordu ve yokusta tutmuyordu. Duran tekerlekte fren, tahrik
  // torkuna KARSI KOYAN bir tutma torku olarak modellenmelidir.
  const rolling = Math.abs(s.wheelOmega) > 0.05;
  let braking: number;
  if (rolling) {
    braking = brakeTorque * dir;
  } else {
    // Duruyorken: tahrik torkunu fren kapasitesine kadar dengele
    braking = clamp(driveTorque, -brakeTorque, brakeTorque);
  }

  // Mevcut kayma (tekerlek cevresel hizi − arac hizi)
  const slip = s.wheelOmega * r - s.speed;
  const alreadySlipping = Math.abs(slip) > 0.25;

  // 1) Patinaj YOK varsayimi: tekerlek ve arac tek kutle
  const inertiaNoSpin = rotatingInertia + v.mass * r * r;
  const netTorque = driveTorque - resistForce * r - braking;
  const alpha = netTorque / inertiaNoSpin;
  const requiredTraction = v.mass * alpha * r + resistForce;
  // Hizlanmada tahrik aksi, yavaslamada DORT tekerlek tutunur
  const limit = requiredTraction >= 0 ? gripDrive : gripBrake;

  if (!alreadySlipping && Math.abs(requiredTraction) <= limit) {
    s.wheelOmega += alpha * dt;
    if (s.wheelOmega < 0 && s.speed <= 0 && driveTorque >= 0) s.wheelOmega = 0;
    s.speed = s.wheelOmega * r;
    return { traction: requiredTraction, spin: false, accel: alpha * r };
  }

  // 2) Kayma rejimi: cekis kuvveti kayma yonune gore SINIRDA sabittir.
  //
  // Onemli: burada s.speed'i tekerlek hizindan TURETMEK yasaktir.
  // Patinajda tekerlek araçtan cok daha hizli doner; hizi tekerlekten
  // okumak araci aniden isinlar ve 0-100'u 1.5 saniyeye dusurur.
  // Arac yalnizca lastikten gelen KUVVETLE hizlanir.
  const tractionDir = Math.sign(slip) || Math.sign(driveTorque) || 1;
  const slipLimit = tractionDir >= 0 ? gripDrive : gripBrake;
  const traction = slipLimit * tractionDir;

  const wheelAlpha = (driveTorque - traction * r - braking) / rotatingInertia;
  const newOmega = s.wheelOmega + wheelAlpha * dt;

  const vehicleAccel = (traction - resistForce) / v.mass;
  const newSpeed = s.speed + vehicleAccel * dt;

  s.wheelOmega = newOmega;
  s.speed = newSpeed;

  // Kayma isaret degistirdiyse tekerlek arac hizina oturmustur —
  // aksi halde model kayma yonu etrafinda titrer.
  const newSlip = s.wheelOmega * r - s.speed;
  if (Math.sign(newSlip) !== Math.sign(slip) && Math.abs(newSlip) < 1.5) {
    s.wheelOmega = s.speed / r;
  }

  if (s.speed < 0) s.speed = 0;
  if (s.wheelOmega < 0) s.wheelOmega = 0;

  return { traction, spin: true, accel: vehicleAccel };
}

/** 0-100 km/s hesabi icin yardimci — tam gaz, optimal vites gecisleri */
export function estimateZeroToHundred(
  v: VehicleSpec,
  torqueLookup: (rpm: number, throttle: number) => number,
  engineInertia: number,
  idleRpm: number,
  redline: number,
): number {
  const s = initialVehicleState(idleRpm);
  s.speed = 0; s.wheelOmega = 0;
  let gear = 1;
  let time = 0;
  const dt = 0.01;
  const input: DriverInput = { throttle: 1, brake: 0, clutch: 0.6, handbrake: 0, gear };
  while (time < 60 && s.speed * 3.6 < 100) {
    // Kalkista debriyaji kademeli birak
    input.clutch = Math.max(0, 0.6 - time * 1.2);
    input.gear = gear;
    const r = stepVehicle(s, v, input, torqueLookup, engineInertia, idleRpm, redline, dt);
    if (r.rpm >= redline * 0.985 && gear < v.gearRatios.length) {
      gear++;
      time += 0.12; // vites degistirme suresi
    }
    if (r.stalled) return NaN;
    time += dt;
  }
  return time;
}
