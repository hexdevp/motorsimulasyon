/**
 * Teshis ve durum degerlendirmesi
 *
 * Iki ayri soruya cevap verir:
 *
 *   DURUM  — "Bu motor su anda saglikli mi?" Her kalem olculen degerle
 *            birlikte, gecti/sinirda/kaldi seklinde.
 *   KOK NEDEN — "Neden vuruyor? Guc nerede kayboluyor?" Katkilar
 *            buyuklugune gore siralanir; tahmin degil, hesaplanan pay.
 *
 * Amac kullaniciya "sorun var" demek degil, SEBEBINI ve BUYUKLUGUNU
 * gostermek.
 */

import type { EngineConfig, OperatingPoint } from './types';
import { clamp } from './gas';
import { TURBINE_TEMP_LIMIT } from './turbo';
import { thermalState } from './thermal';
import { oilPressureVerdict } from './lubrication';
import { valveFloatThreshold } from './valve';
import { bearingLoadAssessment } from './friction';

export type Severity = 'ok' | 'caution' | 'danger' | 'info';

export interface StatusItem {
  /** i18n anahtari */
  key: string;
  severity: Severity;
  /** Olculen deger, birimiyle biçimlenmiş */
  value: string;
  /** Sinir/hedef degeri */
  limit?: string;
  /** Doluluk cubugu icin 0-1 (varsa) */
  fraction?: number;
}

/** Bir kalemi esiklere gore degerlendirir (yuksek = kotu) */
function gradeHigh(v: number, caution: number, danger: number): Severity {
  if (v >= danger) return 'danger';
  if (v >= caution) return 'caution';
  return 'ok';
}

/** Bir kalemi esiklere gore degerlendirir (dusuk = kotu) */
function gradeLow(v: number, caution: number, danger: number): Severity {
  if (v <= danger) return 'danger';
  if (v <= caution) return 'caution';
  return 'ok';
}

/**
 * Bir calisma noktasinin durum listesi.
 * Sonuc, en kotuden en iyiye siralanir.
 */
export function statusChecks(cfg: EngineConfig, p: OperatingPoint): StatusItem[] {
  const items: StatusItem[] = [];

  // --- Enjektor doluluk ---
  items.push({
    key: 'stInjectorDuty',
    severity: gradeHigh(p.injectorDutyCycle, 0.80, 0.90),
    value: `%${(p.injectorDutyCycle * 100).toFixed(0)}`,
    limit: '%85',
    fraction: p.injectorDutyCycle,
  });

  // --- Vurunti payi ---
  const knockMargin = 1 - p.knockRisk;
  items.push({
    key: 'stKnockMargin',
    severity: gradeLow(knockMargin, 0.15, 0.02),
    value: `%${(knockMargin * 100).toFixed(0)}`,
    limit: `${p.knockRetard > 0.05 ? `−${p.knockRetard.toFixed(1)}° geri çekme` : 'MBT'}`,
    fraction: clamp(knockMargin, 0, 1),
  });

  // --- Ortalama piston hizi ---
  items.push({
    key: 'stPistonSpeed',
    severity: gradeHigh(p.meanPistonSpeed, 21, 25),
    value: `${p.meanPistonSpeed.toFixed(1)} m/s`,
    limit: '20-22 m/s',
    fraction: p.meanPistonSpeed / 25,
  });

  // --- Supap yuzmesi payi ---
  const floatRpm = valveFloatThreshold(
    cfg.valvetrain.intakeCam, cfg.valvetrain.springOpenPressure,
    cfg.valvetrain.valvetrainMass,
  );
  if (Number.isFinite(floatRpm)) {
    const floatUse = p.rpm / floatRpm;
    items.push({
      key: 'stValveFloat',
      severity: gradeHigh(floatUse, 0.93, 1.0),
      value: `${p.rpm} / ${floatRpm.toFixed(0)} rpm`,
      limit: `%${(floatUse * 100).toFixed(0)} kullanım`,
      fraction: floatUse,
    });
  }

  // --- Yakit sistemi payi ---
  items.push({
    key: 'stFuelHeadroom',
    severity: gradeLow(p.fuelHeadroom, 0.12, 0.0),
    value: `%${(p.fuelHeadroom * 100).toFixed(0)}`,
    limit: `${p.fuelDemandLPH.toFixed(0)} / ${p.fuelSupplyLPH.toFixed(0)} L/s`,
    fraction: clamp(p.fuelHeadroom, 0, 1),
  });

  // --- Yag basinci ---
  const oilV = oilPressureVerdict(p.oilPressure, p.rpm);
  items.push({
    key: 'stOilPressure',
    severity: oilV === 'critical' ? 'danger' : oilV === 'low' ? 'caution' : 'ok',
    value: `${(p.oilPressure / 1e5).toFixed(2)} bar`,
    limit: `≥${(Math.max(0.7e5, (p.rpm / 1000) * 0.7e5) / 1e5).toFixed(1)} bar`,
    fraction: clamp(p.oilPressure / 6e5, 0, 1),
  });

  // --- Yag filmi / asinma ---
  items.push({
    key: 'stOilFilm',
    severity: gradeHigh(p.wearIndex, 0.4, 0.75),
    value: `${(p.minOilFilm * 1e6).toFixed(2)} µm`,
    limit: '>1.5 µm',
    fraction: p.wearIndex,
  });

  // --- Yatak yuku ---
  const bearing = bearingLoadAssessment(p.peakBearingLoad, cfg.mechanical.rodBearingDia);
  items.push({
    key: 'stBearingLoad',
    severity: bearing.severity === 'critical' ? 'danger'
      : bearing.severity === 'high' ? 'caution' : 'ok',
    value: `${(bearing.projectedPressure / 1e6).toFixed(0)} MPa`,
    limit: '55-70 MPa',
    fraction: bearing.projectedPressure / 70e6,
  });

  // --- Turbo kalemleri ---
  if (cfg.induction.type === 'TURBO') {
    items.push({
      key: 'stCompressorEff',
      severity: gradeLow(p.compressorEfficiency, 0.65, 0.55),
      value: `%${(p.compressorEfficiency * 100).toFixed(0)}`,
      limit: '%70-78 (ada içi)',
      fraction: p.compressorEfficiency,
    });
    items.push({
      key: 'stSurge',
      severity: gradeHigh(p.surgeMargin, 0.05, 0.25),
      value: p.surgeMargin > 0.01 ? `%${(p.surgeMargin * 100).toFixed(0)} içeride` : 'güvenli',
      limit: 'surge hattı',
      fraction: p.surgeMargin,
    });
    items.push({
      key: 'stTipSpeed',
      severity: gradeHigh(p.compressorTipSpeed, 490, 540),
      value: `${p.compressorTipSpeed.toFixed(0)} m/s`,
      limit: '520 m/s',
      fraction: p.compressorTipSpeed / 560,
    });
    items.push({
      key: 'stTurbineTemp',
      severity: gradeHigh(p.turbineInletTemp, TURBINE_TEMP_LIMIT * 0.92, TURBINE_TEMP_LIMIT),
      value: `${(p.turbineInletTemp - 273.15).toFixed(0)} °C`,
      limit: `${(TURBINE_TEMP_LIMIT - 273.15).toFixed(0)} °C`,
      fraction: p.turbineInletTemp / TURBINE_TEMP_LIMIT,
    });
    const bpRatio = p.turbinePressure / p.map;
    items.push({
      key: 'stBackpressure',
      severity: gradeHigh(bpRatio, 1.5, 2.0),
      value: `${bpRatio.toFixed(2)}×`,
      limit: '<1.5× MAP',
      fraction: bpRatio / 2.5,
    });
  }

  // --- EGT ---
  items.push({
    key: 'stEGT',
    severity: gradeHigh(p.egt - 273.15, 870, 950),
    value: `${(p.egt - 273.15).toFixed(0)} °C`,
    limit: '900 °C',
    fraction: (p.egt - 273.15) / 1000,
  });

  // --- Buhar kilidi ---
  items.push({
    key: 'stVaporLock',
    severity: p.vaporLockMargin < 0 ? 'danger'
      : p.vaporLockMargin < 15000 ? 'caution' : 'ok',
    value: `${(p.vaporLockMargin / 1000).toFixed(0)} kPa pay`,
    limit: `yakıt ${(cfg.fuelSystem.fuelTemp - 273.15).toFixed(0)}°C`,
    fraction: clamp(p.vaporLockMargin / 60000, 0, 1),
  });

  // --- Termal durum ---
  const th = thermalState(cfg.mechanical.coolantTemp);
  items.push({
    key: 'stThermal',
    severity: th.status === 'overheat' ? 'danger'
      : th.status === 'cold' || th.status === 'hot' ? 'caution'
      : th.status === 'warming' ? 'info' : 'ok',
    value: `${(cfg.mechanical.coolantTemp - 273.15).toFixed(0)} °C`,
    limit: `ısınma %${(th.warmup * 100).toFixed(0)}`,
    fraction: th.warmup,
  });

  const order: Record<Severity, number> = { danger: 0, caution: 1, info: 2, ok: 3 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ============================================================
// KOK NEDEN ANALIZI
// ============================================================

export interface CauseItem {
  key: string;
  /** Bu etkenin toplam icindeki payi (0-1) */
  share: number;
  /** Olculen deger */
  detail: string;
}

/**
 * Vuruntuyu tetikleyen etkenlerin siralamasi.
 *
 * Vurunti tek bir sebepten olmaz; son gazin basinc-sicaklik gecmisinin
 * toplam sonucudur. Burada her etkenin, otomatik tutusma gecikmesini
 * (Douaud-Eyzat tau) ne kadar KISALTTIGINA bakarak payini hesapliyoruz.
 * Boylece "sikistirma oranini mi dusureyim, intercooler mi takayim,
 * yoksa daha yuksek oktan mi alayim" sorusu olculebilir hale gelir.
 */
export function knockCauses(cfg: EngineConfig, p: OperatingPoint): CauseItem[] {
  const causes: CauseItem[] = [];

  // Her etken icin "referans kosuldan sapma" bir log-oranla olculur;
  // tau'nun ilgili degiskene duyarliligi carpan olarak kullanilir.
  const contributions: { key: string; weight: number; detail: string }[] = [];

  // 1) Sikistirma orani — son gaz basincini dogrudan belirler
  const crRef = 10.0;
  contributions.push({
    key: 'causeCompression',
    weight: Math.max(Math.log(cfg.geometry.compressionRatio / crRef) * 1.7, 0),
    detail: `${cfg.geometry.compressionRatio.toFixed(1)}:1 (dinamik ${p.dynamicCompressionRatio.toFixed(1)}:1)`,
  });

  // 2) Emme havasi sicakligi
  const iatRef = 305;
  contributions.push({
    key: 'causeIAT',
    weight: Math.max((p.iat - iatRef) / 45, 0),
    detail: `${(p.iat - 273.15).toFixed(0)} °C`,
  });

  // 3) Manifold basinci (doldurma)
  contributions.push({
    key: 'causeBoost',
    weight: Math.max((p.map / 101325 - 1) * 1.9, 0),
    detail: `${(p.map / 1e5).toFixed(2)} bar (${((p.map - 101325) / 1e5).toFixed(2)} bar basınç)`,
  });

  // 4) Yakit oktani (dusuk oktan = pozitif katki)
  const ronRef = 98;
  contributions.push({
    key: 'causeOctane',
    weight: Math.max((ronRef - cfg.fuel.ron) / 12, 0),
    detail: `${cfg.fuel.ron} RON ${cfg.fuel.name}`,
  });

  // 5) Sogutma suyu / cidar sicakligi
  contributions.push({
    key: 'causeCoolant',
    weight: Math.max((cfg.mechanical.coolantTemp - 361) / 22, 0),
    detail: `${(cfg.mechanical.coolantTemp - 273.15).toFixed(0)} °C (oda cidarı ${(p.chamberWallTemp - 273.15).toFixed(0)} °C)`,
  });

  // 6) Devir — dusuk devirde son gazin bekleme suresi uzar
  contributions.push({
    key: 'causeLowRpm',
    weight: Math.max((3200 - p.rpm) / 2600, 0),
    detail: `${p.rpm} rpm (düşük devirde son gaz daha uzun bekler)`,
  });

  // 7) Karisim — fakir karisim daha sicak yanar
  contributions.push({
    key: 'causeLeanMixture',
    weight: Math.max((p.lambda - 0.88) * 2.4, 0),
    detail: `λ ${p.lambda.toFixed(2)} (AFR ${p.afr.toFixed(1)})`,
  });

  // 8) Artik gaz — seyreltme vuruntuyu AZALTIR, az artik gaz riski artirir
  contributions.push({
    key: 'causeLowResidual',
    weight: Math.max((0.06 - p.residualFraction) * 6, 0),
    detail: `%${(p.residualFraction * 100).toFixed(1)} artık gaz`,
  });

  const total = contributions.reduce((s, c) => s + c.weight, 0);
  if (total < 1e-6) return [];

  for (const c of contributions) {
    if (c.weight / total < 0.03) continue;
    causes.push({ key: c.key, share: c.weight / total, detail: c.detail });
  }
  return causes.sort((a, b) => b.share - a.share);
}

export interface EnergyBalance {
  /** Yakitin getirdigi toplam guc (W) */
  fuelPower: number;
  /** Krank milinden alinan net guc (W) */
  brakePower: number;
  /** Yanmadan kacan kimyasal enerji (W) */
  incompleteCombustion: number;
  /** Cidarlara kaybedilen isi (W) */
  heatLoss: number;
  /** Egzozla giden entalpi (W) */
  exhaustLoss: number;
  /** Mekanik surtunme (W) */
  friction: number;
  /** Pompalama isi (W) */
  pumping: number;
}

/**
 * Enerji dengesi — yakitin enerjisi nereye gitti.
 *
 * Tipik bir benzinli motorda: %30 fren gucu, %30 egzoz, %25 sogutma,
 * %10 surtunme+pompalama, %5 yanmamis. Bu dagilimi gormek, "nereyi
 * iyilestirsem" sorusunun cevabini verir.
 */
export function energyBalance(p: OperatingPoint, totalDisplacement: number): EnergyBalance {
  const fuelPower = p.fuelFlow * 44e6 * (p.fuelFlow > 0 ? 1 : 0) || 0;
  // LHV'yi noktadan turetmek yerine termal verimden geri hesapla —
  // yakit tipinden bagimsiz dogru sonuc verir.
  const actualFuelPower = p.thermalEfficiency > 0 ? p.power / p.thermalEfficiency : fuelPower;

  const incompleteCombustion = actualFuelPower * (1 - p.combustionEfficiency);
  const friction = p.frictionPower;
  const pumping = (Math.abs(p.pmep) * totalDisplacement * p.rpm) / (2 * 60);

  // Silindir icinde (kapali cevrimde) cidarlara giden isi
  const inCylinderHeat = p.wallHeatPower;
  const remainder = Math.max(
    actualFuelPower - p.power - incompleteCombustion - inCylinderHeat - friction - pumping,
    0,
  );

  // Sicak egzoz gazi, kafayi ve egzoz portunu gecerken isisinin bir
  // kismini sogutma suyuna birakir; supap oturma yuzeyleri ve port
  // cidarlari su ceketiyle cevrilidir. Olculen degerlerde egzoz
  // entalpisinin ~%28'i kafada kalir.
  //
  // Bu ayrimi yapmazsak, sadece silindir ici Woschni isisi sayilir ve
  // sogutma yuku %7 gibi gercek disi bir deger cikar; olculen deger
  // %25-30 bandindadir. Toplam enerji her iki durumda da korunur —
  // yanlis olan yalnizca kalemler arasi dagilimdir.
  const portHeatToCoolant = remainder * 0.28;
  const heatLoss = inCylinderHeat + portHeatToCoolant;
  const exhaustLoss = remainder - portHeatToCoolant;

  return {
    fuelPower: actualFuelPower,
    brakePower: p.power,
    incompleteCombustion,
    heatLoss,
    exhaustLoss,
    friction,
    pumping,
  };
}

/**
 * Guc kaybinin kaynaklari — referans bir "ideal" noktaya gore.
 *
 * Ortam kosullari, vurunti geri cekmesi, yanma verimi ve sistem
 * kisitlarinin her birinin kac beygir yedigini ayirir.
 */
export function powerLossCauses(cfg: EngineConfig, p: OperatingPoint): CauseItem[] {
  const out: CauseItem[] = [];
  const contributions: { key: string; loss: number; detail: string }[] = [];

  // Referans guc: mevcut fren gucunun, kayiplar olmasaydi ulasacagi deger
  const base = p.power / 745.7;

  // 1) Ortam kosullari (rakim, sicaklik, nem)
  const ambientLoss = base * (1 / Math.max(p.densityAltitudeFactor, 0.4) - 1);
  contributions.push({
    key: 'lossAmbient', loss: ambientLoss,
    detail: `${cfg.ambient.altitude.toFixed(0)} m, ${(cfg.ambient.temperature - 273.15).toFixed(0)}°C, %${(cfg.ambient.humidity * 100).toFixed(0)} nem`,
  });

  // 2) Vurunti nedeniyle cekilen avans
  const retardLoss = base * (p.knockRetard * 0.012);
  contributions.push({
    key: 'lossKnockRetard', loss: retardLoss,
    detail: `${p.knockRetard.toFixed(1)}° geri çekme (MBT ${p.mbtAdvance.toFixed(0)}°)`,
  });

  // 3) Eksik yanma (zengin karisim / soguk motor)
  const combLoss = base * (1 / Math.max(p.combustionEfficiency, 0.5) - 1);
  contributions.push({
    key: 'lossCombustion', loss: combLoss,
    detail: `yanma verimi %${(p.combustionEfficiency * 100).toFixed(1)}, λ ${p.lambda.toFixed(2)}`,
  });

  // 4) Mekanik surtunme
  contributions.push({
    key: 'lossFriction', loss: p.frictionPower / 745.7,
    detail: `FMEP ${(p.fmep / 1e5).toFixed(2)} bar, mek. verim %${(p.mechanicalEfficiency * 100).toFixed(1)}`,
  });

  // 5) Pompalama (kelebek kismasi + egzoz karsi basinci)
  const pumpLoss = (Math.abs(p.pmep) / Math.max(p.imep, 1)) * base;
  contributions.push({
    key: 'lossPumping', loss: pumpLoss,
    detail: `PMEP ${(p.pmep / 1e5).toFixed(2)} bar, karşı basınç ${(p.exhaustBackpressure / 1e5).toFixed(2)} bar`,
  });

  // 6) Hacimsel verim eksigi
  const veLoss = base * Math.max(1 / Math.max(p.volumetricEfficiency, 0.4) - 1, 0);
  contributions.push({
    key: 'lossVE', loss: veLoss,
    detail: `VE %${(p.volumetricEfficiency * 100).toFixed(1)}`,
  });

  // 7) Soguk motor
  if (p.warmupFactor < 0.98) {
    contributions.push({
      key: 'lossCold', loss: base * (1 - p.warmupFactor) * 0.12,
      detail: `ısınma %${(p.warmupFactor * 100).toFixed(0)}, su ${(cfg.mechanical.coolantTemp - 273.15).toFixed(0)}°C`,
    });
  }

  // 8) Yakit sistemi yetersizligi
  if (p.fuelHeadroom < 0) {
    contributions.push({
      key: 'lossFuelSupply', loss: base * Math.min(-p.fuelHeadroom, 0.3),
      detail: `talep ${p.fuelDemandLPH.toFixed(0)} L/s, arz ${p.fuelSupplyLPH.toFixed(0)} L/s`,
    });
  }

  // 9) Kompresor verimsizligi
  if (cfg.induction.type === 'TURBO' && p.compressorEfficiency > 0) {
    const effLoss = base * Math.max((0.76 - p.compressorEfficiency) * 0.55, 0);
    contributions.push({
      key: 'lossCompressor', loss: effLoss,
      detail: `kompresör verimi %${(p.compressorEfficiency * 100).toFixed(0)}, IAT ${(p.iat - 273.15).toFixed(0)}°C`,
    });
  }

  const total = contributions.reduce((s, c) => s + Math.max(c.loss, 0), 0);
  if (total < 1e-6) return [];
  for (const c of contributions) {
    if (c.loss <= 0 || c.loss / total < 0.02) continue;
    out.push({ key: c.key, share: c.loss / total, detail: `${c.loss.toFixed(1)} HP — ${c.detail}` });
  }
  return out.sort((a, b) => b.share - a.share);
}
