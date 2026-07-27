/**
 * Yakit haritasi (fuel map) uretimi ve tablo islemleri
 *
 * Cikti, gercek ECU kalibrasyon yazilimlarindaki (HP Tuners, TunerStudio,
 * EcuTek) tablolarla ayni bicimdedir:
 *   satirlar → manifold mutlak basinci (kPa)
 *   sutunlar → motor devri (rpm)
 *   hucreler → enjektor darbe genisligi (µs)
 *
 * Hucreler ampirik doldurulmaz; her biri simulasyondan gelen hacimsel
 * verim ile hesaplanir. Yani kam degistirince, turbo buyutunce veya
 * yakit tipini degistirince HARITA DA DEGISIR.
 */

import type { EngineConfig } from './types';
import { solveOperatingPoint } from './cycle';
import { makeKinematics } from './geometry';
import { chargeDensity } from './induction';
import { injectorDeadtime } from './cycle';
import { clamp } from './gas';

export interface MapTable {
  /** Sutun ekseni — motor devri (rpm) */
  rpmAxis: number[];
  /** Satir ekseni — manifold mutlak basinci (kPa) */
  loadAxis: number[];
  /** values[satir][sutun] */
  values: number[][];
  /** Birim etiketi */
  unit: string;
  /** Ondalik basamak sayisi */
  decimals: number;
}

export interface GeneratedMaps {
  /** Enjektor darbe genisligi (µs) — ana yakit haritasi */
  fuelPW: MapTable;
  /** Hacimsel verim (%) */
  ve: MapTable;
  /** Atesleme avansi (°BTDC) */
  ignition: MapTable;
  /** Hedef lambda */
  lambda: MapTable;
  /** Enjektor doluluk orani (%) — %85 uzeri sorunlu */
  duty: MapTable;
  /** Her devirdeki ulasilabilir en yuksek MAP (kPa) — boost egrisi */
  maxMapPerRpm: number[];
}

/** Varsayilan devir ekseni (16 sutun) */
export function defaultRpmAxis(cfg: EngineConfig, columns = 16): number[] {
  const lo = Math.max(cfg.idleRpm, 500);
  const hi = cfg.redline;
  const axis: number[] = [];
  for (let i = 0; i < columns; i++) {
    // Hafif logaritmik dagilim: dusuk devirde daha sik, gercek ECU'lardaki gibi
    const t = i / (columns - 1);
    const shaped = Math.pow(t, 0.85);
    axis.push(Math.round((lo + (hi - lo) * shaped) / 8) * 8);
  }
  return axis;
}

/** Varsayilan yuk ekseni — kPa (16 satir) */
export function defaultLoadAxis(cfg: EngineConfig, rows = 16): number[] {
  const maxKpa =
    cfg.induction.type === 'NA'
      ? cfg.ambient.pressure / 1000
      : cfg.induction.boostLimit / 1000;
  const lo = 20;
  const axis: number[] = [];
  for (let i = 0; i < rows; i++) {
    axis.push(Number((lo + ((maxKpa - lo) * i) / (rows - 1)).toFixed(1)));
  }
  return axis;
}

function emptyTable(
  rpmAxis: number[], loadAxis: number[], unit: string, decimals: number,
): MapTable {
  return {
    rpmAxis, loadAxis, unit, decimals,
    values: loadAxis.map(() => rpmAxis.map(() => 0)),
  };
}

/** Bir eksende dogrusal interpolasyon icin indeks ve agirlik */
function locate(axis: number[], v: number): { i: number; t: number } {
  if (v <= axis[0]) return { i: 0, t: 0 };
  const n = axis.length;
  if (v >= axis[n - 1]) return { i: n - 2, t: 1 };
  let i = 0;
  while (i < n - 2 && axis[i + 1] < v) i++;
  return { i, t: (v - axis[i]) / (axis[i + 1] - axis[i]) };
}

export interface MapProgress {
  done: number;
  total: number;
  label: string;
}

/**
 * Haritalari uretir.
 *
 * Her hucre icin ayri cevrim cozmek 16×16 = 256 cozum demek olurdu
 * (~40 saniye). Onun yerine: her devirde birkac YUK noktasi cozulur ve
 * hacimsel verim yuk eksenine interpolasyonla yayilir. VE'nin yukle
 * degisimi yumusaktir (esas olarak artik gaz oraniyla), dolayisiyla
 * bu yaklasim %1-2 icinde kalirken ~10 kat hizlidir.
 */
export function generateMaps(
  cfg: EngineConfig,
  onProgress?: (p: MapProgress) => void,
  rpmAxis: number[] = defaultRpmAxis(cfg),
  loadAxis: number[] = defaultLoadAxis(cfg),
): GeneratedMaps {
  const k = makeKinematics(cfg.geometry);

  // Cozulecek devir noktalari — tam eksen degil, her ucuncusu.
  // VE'nin devirle degisimi yumusaktir; aradaki degerler interpolasyonla
  // %1-2 icinde elde edilir ve cozum sayisi ucte bire iner.
  const sampleRpms = rpmAxis.filter((_, i) => i % 3 === 0);
  if (sampleRpms[sampleRpms.length - 1] !== rpmAxis[rpmAxis.length - 1]) {
    sampleRpms.push(rpmAxis[rpmAxis.length - 1]);
  }
  // Cozulecek kelebek acikliklari
  const throttles = [0.18, 0.38, 0.65, 1.0];

  interface Sample { rpm: number; mapKpa: number; ve: number; spark: number; iat: number }
  const samples: Sample[] = [];
  const total = sampleRpms.length * throttles.length;
  let done = 0;

  for (const rpm of sampleRpms) {
    for (const th of throttles) {
      const c = structuredClone(cfg);
      c.induction.throttlePosition = th;
      const pt = solveOperatingPoint(c, rpm, {
        step: 1.5, maxIterations: 4, ignitionPasses: 1,
      });
      samples.push({
        rpm,
        mapKpa: pt.map / 1000,
        ve: pt.volumetricEfficiency,
        spark: pt.sparkAdvance,
        iat: pt.iat,
      });
      done++;
      onProgress?.({ done, total, label: `${rpm} rpm @ %${Math.round(th * 100)}` });
    }
  }

  /** Belirli devir ve MAP icin VE / avans / IAT tahmini */
  function estimate(rpm: number, mapKpa: number) {
    // Devir eksenindeki iki komsu dilim
    const rl = locate(sampleRpms, rpm);
    const sliceA = samples.filter((s) => s.rpm === sampleRpms[rl.i]);
    const sliceB = samples.filter((s) => s.rpm === sampleRpms[rl.i + 1]);

    const inSlice = (slice: Sample[]) => {
      const sorted = [...slice].sort((a, b) => a.mapKpa - b.mapKpa);
      if (sorted.length === 0) return { ve: 0.8, spark: 20, iat: 300 };
      if (mapKpa <= sorted[0].mapKpa) {
        // Dusuk yukte artik gaz orani hizla artar, VE duser
        const ratio = clamp(mapKpa / sorted[0].mapKpa, 0.15, 1);
        return {
          ve: sorted[0].ve * (0.55 + 0.45 * ratio),
          spark: sorted[0].spark + 12 * (1 - ratio), // dusuk yukte avans artar
          iat: sorted[0].iat,
        };
      }
      const last = sorted[sorted.length - 1];
      if (mapKpa >= last.mapKpa) return { ve: last.ve, spark: last.spark, iat: last.iat };
      let i = 0;
      while (i < sorted.length - 2 && sorted[i + 1].mapKpa < mapKpa) i++;
      const t = (mapKpa - sorted[i].mapKpa) / (sorted[i + 1].mapKpa - sorted[i].mapKpa);
      return {
        ve: sorted[i].ve + (sorted[i + 1].ve - sorted[i].ve) * t,
        spark: sorted[i].spark + (sorted[i + 1].spark - sorted[i].spark) * t,
        iat: sorted[i].iat + (sorted[i + 1].iat - sorted[i].iat) * t,
      };
    };

    const a = inSlice(sliceA);
    const b = inSlice(sliceB);
    return {
      ve: a.ve + (b.ve - a.ve) * rl.t,
      spark: a.spark + (b.spark - a.spark) * rl.t,
      iat: a.iat + (b.iat - a.iat) * rl.t,
    };
  }

  const fuelPW = emptyTable(rpmAxis, loadAxis, 'µs', 0);
  const veTable = emptyTable(rpmAxis, loadAxis, '%', 1);
  const ignTable = emptyTable(rpmAxis, loadAxis, '°BTDC', 1);
  const lambdaTable = emptyTable(rpmAxis, loadAxis, 'λ', 2);
  const dutyTable = emptyTable(rpmAxis, loadAxis, '%', 1);

  const deadtime = injectorDeadtime(
    cfg.fuelSystem.injectorDeadtime, cfg.fuelSystem.batteryVoltage,
  );

  for (let r = 0; r < loadAxis.length; r++) {
    const mapKpa = loadAxis[r];
    const mapPa = mapKpa * 1000;
    for (let c = 0; c < rpmAxis.length; c++) {
      const rpm = rpmAxis[c];
      const est = estimate(rpm, mapKpa);

      // Hedef lambda: dusuk yukte ekonomi (stokiyometrik), yuksek yukte
      // sogutma icin zengin. Gercek ECU haritalarinin yaptigi da budur.
      const loadFrac = clamp(mapKpa / (loadAxis[loadAxis.length - 1]), 0, 1);
      const lambda =
        loadFrac < 0.55
          ? 1.0
          : 1.0 - (1.0 - cfg.fuelSystem.targetLambdaWOT) *
                  Math.pow((loadFrac - 0.55) / 0.45, 1.3);

      // Silindir basina hava kutlesi (cevrim basina)
      const density = chargeDensity(mapPa, est.iat, cfg.ambient.humidity);
      const airMass = est.ve * density * k.sweptVolume;
      const fuelMass = airMass / (cfg.fuel.afrStoich * lambda);

      // Enjektor debisi — basinc farkina bagli.
      // Donussuz (returnless) sistemde ray basinci sabittir, dolayisiyla
      // manifold basinci yukseldikce enjektorun gordugu FARK azalir ve
      // debi duser. Turbo motorlarda basinc arttikca enjektorun
      // beklenenden erken yetersiz kalmasinin sebebi budur.
      const dpRef = cfg.fuelSystem.injectorRefPressure;
      const dpActual = Math.max(
        cfg.fuelSystem.railPressure + cfg.ambient.pressure - mapPa, 0.15 * dpRef,
      );
      const flowKgS =
        (cfg.fuelSystem.injectorFlowCC / 60 / 1e6) *
        cfg.fuel.density *
        Math.sqrt(dpActual / dpRef);

      const openTime = fuelMass / Math.max(flowKgS * cfg.fuelSystem.injectorsPerCyl, 1e-12);
      const pw = openTime + deadtime;
      const cycleTime = 120 / rpm;

      fuelPW.values[r][c] = pw * 1e6;
      veTable.values[r][c] = est.ve * 100;
      ignTable.values[r][c] = est.spark;
      lambdaTable.values[r][c] = lambda;
      dutyTable.values[r][c] = (pw / cycleTime) * 100;
    }
  }

  // Her devirde ulasilabilir en yuksek MAP (turbo basinc egrisi)
  const maxMapPerRpm = rpmAxis.map((rpm) => {
    const rl = locate(sampleRpms, rpm);
    const maxAt = (idx: number) =>
      Math.max(...samples.filter((s) => s.rpm === sampleRpms[idx]).map((s) => s.mapKpa));
    const a = maxAt(rl.i);
    const b = maxAt(rl.i + 1);
    return a + (b - a) * rl.t;
  });

  return { fuelPW, ve: veTable, ignition: ignTable, lambda: lambdaTable, duty: dutyTable, maxMapPerRpm };
}

// ============================================================
// TABLO DUZENLEME ISLEMLERI
// ============================================================

export type CellOp = 'set' | 'add' | 'multiply' | 'percent';

export interface CellRange {
  r0: number; c0: number; r1: number; c1: number;
}

export function normalizeRange(sel: CellRange): CellRange {
  return {
    r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1),
    c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1),
  };
}

/** Secili hucrelere matematik islemi uygular (yeni tablo dondurur) */
export function applyCellOp(
  table: MapTable, sel: CellRange, op: CellOp, operand: number,
): MapTable {
  const s = normalizeRange(sel);
  const values = table.values.map((row, r) =>
    row.map((v, c) => {
      if (r < s.r0 || r > s.r1 || c < s.c0 || c > s.c1) return v;
      switch (op) {
        case 'set': return operand;
        case 'add': return v + operand;
        case 'multiply': return v * operand;
        case 'percent': return v * (1 + operand / 100);
      }
    }),
  );
  return { ...table, values };
}

/**
 * Secili bolgeyi yatay/dikey dogrusal interpolasyonla doldurur.
 * Kenar hucreler sabit tutulur, aradakiler hesaplanir — tuning
 * yazilimlarindaki "interpolate" islemiyle ayni.
 */
export function interpolateRange(
  table: MapTable, sel: CellRange, axis: 'horizontal' | 'vertical' | 'both',
): MapTable {
  const s = normalizeRange(sel);
  const values = table.values.map((r) => [...r]);

  if (axis === 'horizontal' || axis === 'both') {
    for (let r = s.r0; r <= s.r1; r++) {
      const a = values[r][s.c0], b = values[r][s.c1];
      const span = s.c1 - s.c0;
      if (span < 2) continue;
      for (let c = s.c0 + 1; c < s.c1; c++) {
        values[r][c] = a + ((b - a) * (c - s.c0)) / span;
      }
    }
  }
  if (axis === 'vertical' || axis === 'both') {
    for (let c = s.c0; c <= s.c1; c++) {
      const a = values[s.r0][c], b = values[s.r1][c];
      const span = s.r1 - s.r0;
      if (span < 2) continue;
      for (let r = s.r0 + 1; r < s.r1; r++) {
        values[r][c] = a + ((b - a) * (r - s.r0)) / span;
      }
    }
  }
  return { ...table, values };
}

/** Secili bolgeyi 3x3 komsulukla yumusatir */
export function smoothRange(table: MapTable, sel: CellRange): MapTable {
  const s = normalizeRange(sel);
  const src = table.values;
  const values = src.map((r) => [...r]);
  for (let r = s.r0; r <= s.r1; r++) {
    for (let c = s.c0; c <= s.c1; c++) {
      let sum = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= src.length || cc >= src[0].length) continue;
          const w = dr === 0 && dc === 0 ? 4 : 1;
          sum += src[rr][cc] * w; n += w;
        }
      }
      values[r][c] = sum / n;
    }
  }
  return { ...table, values };
}

/** Tabloyu sekmeyle ayrilmis metne cevirir (Excel'e yapistirmak icin) */
export function tableToTSV(table: MapTable, sel?: CellRange): string {
  const s = sel
    ? normalizeRange(sel)
    : { r0: 0, c0: 0, r1: table.values.length - 1, c1: table.rpmAxis.length - 1 };
  const lines: string[] = [];
  for (let r = s.r0; r <= s.r1; r++) {
    const row: string[] = [];
    for (let c = s.c0; c <= s.c1; c++) row.push(table.values[r][c].toFixed(table.decimals));
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}

/** Sekmeyle ayrilmis metni secili bolgeye yapistirir */
export function pasteTSV(table: MapTable, sel: CellRange, text: string): MapTable {
  const s = normalizeRange(sel);
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(/\t|;|,\s*/));
  const values = table.values.map((r) => [...r]);
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const r = s.r0 + i, c = s.c0 + j;
      if (r >= values.length || c >= values[0].length) continue;
      const v = parseFloat(rows[i][j].replace(',', '.'));
      if (Number.isFinite(v)) values[r][c] = v;
    }
  }
  return { ...table, values };
}

/** Tablodaki en kucuk ve en buyuk deger — renklendirme icin */
export function tableExtent(table: MapTable): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const row of table.values) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  return { min, max: max === min ? min + 1 : max };
}

/** Haritadan tek bir hucre degeri okur (iki yonlu interpolasyon) */
export function sampleTable(table: MapTable, rpm: number, loadKpa: number): number {
  const rl = locate(table.loadAxis, loadKpa);
  const rc = locate(table.rpmAxis, rpm);
  const v00 = table.values[rl.i][rc.i];
  const v01 = table.values[rl.i][rc.i + 1];
  const v10 = table.values[rl.i + 1][rc.i];
  const v11 = table.values[rl.i + 1][rc.i + 1];
  const top = v00 + (v01 - v00) * rc.t;
  const bot = v10 + (v11 - v10) * rc.t;
  return top + (bot - top) * rl.t;
}
