/**
 * RPM supurmesi, statik motor ozellikleri ve gercek zamanli tork haritasi
 */

import type { EngineConfig, EngineStatics, OperatingPoint, SweepResult } from './types';
import { solveOperatingPoint, DEFAULT_OPTIONS, type SolverOptions } from './cycle';
import {
  makeKinematics, cylinderVolume, dynamicCompressionRatio, meanPistonSpeed,
  cylinderCount, totalInertia,
} from './geometry';
import {
  ivcABDC, ivcCycleAngle, valveFloatThreshold, valveToPistonAreaRatio, maxCurtainArea,
} from './valve';

/** Geometriden turetilen, devirden BAGIMSIZ ozellikler */
export function computeStatics(cfg: EngineConfig): EngineStatics {
  const k = makeKinematics(cfg.geometry);
  const nCyl = cylinderCount(cfg.layout);
  const ivcSolver = ivcCycleAngle(cfg.valvetrain) - 720;

  const floatRpm = valveFloatThreshold(
    cfg.valvetrain.intakeCam,
    cfg.valvetrain.springOpenPressure,
    cfg.valvetrain.valvetrainMass,
  );

  // Onerilen kirmizi cizgi: ortalama piston hizi sinirindan.
  // 20 m/s sokak, 23-25 m/s guclendirilmis alt takim, 25+ yaris.
  // Ikisinden hangisi once geliyorsa o belirler: piston hizi mi, supap yuzmesi mi.
  const speedLimitRpm = (20.5 * 60) / (2 * cfg.geometry.stroke);
  const recommendedRedline = Math.min(speedLimitRpm, floatRpm * 0.95);

  return {
    displacementPerCyl: k.sweptVolume,
    totalDisplacement: k.sweptVolume * nCyl,
    clearanceVolume: k.clearanceVolume,
    rodStrokeRatio: cfg.geometry.rodLength / cfg.geometry.stroke,
    boreStrokeRatio: cfg.geometry.bore / cfg.geometry.stroke,
    ivcAngle: ivcABDC(cfg.valvetrain),
    dynamicCR: dynamicCompressionRatio(k, ivcSolver),
    effectiveStroke: cylinderVolume(k, ivcSolver) / k.pistonArea,
    valveFloatRpm: floatRpm,
    recommendedRedline,
    valveToPistonAreaRatio: valveToPistonAreaRatio(cfg.valvetrain, cfg.geometry.bore),
    intakeCurtainArea: maxCurtainArea(cfg.valvetrain),
    totalRotatingInertia: totalInertia(cfg, k),
  };
}

/** Supurme icin varsayilan devir listesi */
export function defaultRpmList(cfg: EngineConfig, step = 250): number[] {
  const start = Math.max(Math.round(cfg.idleRpm / step) * step, step);
  const list: number[] = [];
  for (let r = start; r <= cfg.redline; r += step) list.push(r);
  if (list[list.length - 1] !== cfg.redline) list.push(cfg.redline);
  return list;
}

export interface SweepProgress {
  done: number;
  total: number;
  rpm: number;
}

/**
 * Tam RPM supurmesi.
 *
 * @param onProgress Her nokta bittiginde cagrilir (arayuz ilerleme cubugu icin)
 */
export function runSweep(
  cfg: EngineConfig,
  rpmList: number[] = defaultRpmList(cfg),
  opts: Partial<SolverOptions> = {},
  onProgress?: (p: SweepProgress) => void,
): SweepResult {
  const points: OperatingPoint[] = [];
  for (let i = 0; i < rpmList.length; i++) {
    const rpm = rpmList[i];
    points.push(solveOperatingPoint(cfg, rpm, opts));
    onProgress?.({ done: i + 1, total: rpmList.length, rpm });
  }

  let peakPower = { rpm: 0, value: -Infinity };
  let peakTorque = { rpm: 0, value: -Infinity };
  for (const p of points) {
    if (p.power > peakPower.value) peakPower = { rpm: p.rpm, value: p.power };
    if (p.torque > peakTorque.value) peakTorque = { rpm: p.rpm, value: p.torque };
  }

  return { engine: cfg, points, peakPower, peakTorque, statics: computeStatics(cfg) };
}

/**
 * Hizli supurme — arayuzde anlik geri bildirim icin.
 * Daha kaba adim ve daha az iterasyon kullanir; egri sekli korunur,
 * mutlak degerlerde ~%1-2 sapma olur.
 */
export function runQuickSweep(
  cfg: EngineConfig,
  rpmList: number[] = defaultRpmList(cfg, 500),
): SweepResult {
  return runSweep(cfg, rpmList, { step: 1.0, maxIterations: 6 });
}

// ============================================================
// GERCEK ZAMANLI SIMULASYON ICIN TORK HARITASI
// ============================================================

export interface TorqueMap {
  rpm: number[];
  /** Tam gazda tork (N·m) */
  wot: number[];
  /** Kapali gazda (motor freni) tork — negatif */
  closed: number[];
  /** Her devirdeki tam gaz calisma noktasi — gostergeler icin */
  points: OperatingPoint[];
  inertia: number;
  idleRpm: number;
  redline: number;
}

/**
 * Gercek zamanli mod icin tork haritasi olusturur.
 *
 * Canli simulasyonda her karede tam cevrim cozmek mumkun degil (bir nokta
 * ~150 ms surer, 60 fps icin 16 ms var). Onun yerine: agir cozum bir kez
 * yapilip tork haritasi cikarilir, canli mod bu haritadan interpolasyonla
 * calisir. Gercek dinamometre yazilimlarinin ve ECU'larin yaptigi da budur.
 */
export function buildTorqueMap(cfg: EngineConfig, step = 500): TorqueMap {
  const rpmList = defaultRpmList(cfg, step);
  const k = makeKinematics(cfg.geometry);

  // Canli mod icin hiz onceliklidir: tork egrisi devirle yumusak degistigi
  // icin 500 rpm araliginda ornekleyip aradakileri interpolasyonla vermek
  // gorsel olarak farkedilmez, ama hazirlik suresini ~4 kat kisaltir.
  const wotSweep = runSweep(cfg, rpmList, {
    step: 1.5, maxIterations: 5, ignitionPasses: 1,
  });

  // Kapali gaz: kelebek neredeyse kapali, yanma yok denecek kadar az.
  // Motor freni torku = surtunme + pompalama kaybi.
  const closed: number[] = [];
  for (const p of wotSweep.points) {
    const pumping = Math.abs(p.pmep) * 2.8; // kelebek kapaliyken pompalama kaybi artar
    const totalLoss = p.fmep + pumping;
    closed.push(-(totalLoss * k.sweptVolume * cylinderCount(cfg.layout)) / (4 * Math.PI));
  }

  return {
    rpm: rpmList,
    wot: wotSweep.points.map((p) => p.torque),
    closed,
    points: wotSweep.points,
    inertia: totalInertia(cfg, k),
    idleRpm: cfg.idleRpm,
    redline: cfg.redline,
  };
}

/** Tork haritasindan dogrusal interpolasyon */
export function lookupTorque(map: TorqueMap, rpm: number, throttle: number): number {
  const r = Math.max(map.rpm[0], Math.min(rpm, map.rpm[map.rpm.length - 1]));
  let i = 0;
  while (i < map.rpm.length - 2 && map.rpm[i + 1] < r) i++;
  const t = (r - map.rpm[i]) / (map.rpm[i + 1] - map.rpm[i]);
  const wot = map.wot[i] + (map.wot[i + 1] - map.wot[i]) * t;
  const closed = map.closed[i] + (map.closed[i + 1] - map.closed[i]) * t;

  // Kelebek acikligi ile tork arasindaki iliski dogrusal degildir:
  // ilk %30'da torkun buyuk kismi gelir (kelebek akis karakteristigi).
  const th = Math.max(0, Math.min(throttle, 1));
  const blend = Math.pow(th, 0.62);
  return closed + (wot - closed) * blend;
}

/** Belirli bir devirdeki tam gaz calisma noktasini bulur (gosterge verisi) */
export function lookupPoint(map: TorqueMap, rpm: number): OperatingPoint {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < map.rpm.length; i++) {
    const d = Math.abs(map.rpm[i] - rpm);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return map.points[best];
}

export { DEFAULT_OPTIONS, meanPistonSpeed };
