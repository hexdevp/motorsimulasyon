/**
 * Hazir motor kutuphanesi
 *
 * VERI GUVENILIRLIGI NOTU — bu ayrimi bilmek onemli:
 *
 *   BIRINCIL olculer (cap, strok, biyel uzunlugu, sikistirma orani,
 *   silindir sayisi, kirmizi cizgi) yayimlanmis uretici verileridir.
 *
 *   IKINCIL olculer (supap caplari, yay basinclari, parca kutleleri,
 *   atalet momentleri, runner uzunluklari) cogu motor icin yayimlanmaz.
 *   Bunlar cap/strok ve mimariden olceklenmis TEMSILI degerlerdir.
 *   Motorun karakterini dogru verirler ama katalog degeri degildirler.
 *
 * Yani: 2JZ ile K20'yi karsilastirmak anlamlidir; cikan rakami dinamo
 * cikti belgesi gibi kullanmak degil.
 */

import type {
  EngineConfig, Layout, Valvetrain, InductionType, Geometry, ManifoldType,
  Valvetrain_Spec, Induction, FuelSystem, Ignition, Mechanical, Ambient,
} from './types';
import { makeFuel } from './fuel';
import { cylinderCount } from './geometry';

/** Standart ortam: deniz seviyesi, 20°C, %40 nem */
export function standardAmbient(): Ambient {
  return {
    pressure: 101325,
    temperature: 293.15,
    humidity: 0.4,
    altitude: 0,
    useAltitude: true,
  };
}

/** Bir preseti tanimlamak icin gereken minimum bilgi */
interface PresetSpec {
  id: string;
  name: string;
  manufacturer: string;
  years: string;
  layout: Layout;
  /** mm */
  bore: number;
  /** mm */
  stroke: number;
  /** mm — biyel merkez-merkez */
  rod: number;
  compressionRatio: number;
  valvetrain: Valvetrain;
  intakeValvesPerCyl: number;
  exhaustValvesPerCyl: number;
  /** mm */
  intakeValveDia: number;
  /** mm */
  exhaustValveDia: number;
  /** mm — maks supap kalkisi */
  lift: number;
  /** krank derecesi — reklam edilen sure */
  duration: number;
  /** kam derecesi */
  lsa: number;
  redline: number;
  idleRpm: number;
  induction: InductionType;
  /** bar — atmosfer uzeri hedef basinc */
  boost?: number;
  /** turbo tam basinca ulastigi devir */
  fullBoostRpm?: number;
  /**
   * Intercooler etkinligi (0-1). Verilmezse cage gore secilir.
   *
   * Bu deger vurunti payini dogrudan belirler ve motorlar arasinda
   * gercekten cok farklidir — hepsine ayni degeri vermek, modern
   * su-hava intercooler'li bir motoru 1990'larin ust montaj
   * intercooler'i kadar kotu gosterir:
   *
   *   0.86-0.90  Modern OEM su-hava (B58, EA888 Gen3)
   *   0.72-0.78  Iyi boyutlandirilmis on montaj hava-hava (Barra, RB26)
   *   0.62-0.68  Ust montaj hava-hava — isi emmesiyle bilinir (EJ257)
   */
  intercooler?: number;
  /** mm — emme runner uzunlugu */
  runnerLength: number;
  /** mm — emme runner capi */
  runnerDiameter: number;
  /** cc/dk — enjektor debisi */
  injector: number;
  /** g — piston + pim + segman */
  pistonMass: number;
  /** g — biyel kolu */
  rodMass: number;
  /** Egzoz manifold mimarisi (verilmezse tipe gore secilir) */
  manifold?: ManifoldType;
  /** Turbin govdesi A/R orani */
  turbineAR?: number;
  /** kisa aciklama */
  note: string;
  noteEn: string;
}

const PRESET_SPECS: PresetSpec[] = [
  {
    id: '2jz-gte',
    name: 'Toyota 2JZ-GTE',
    manufacturer: 'Toyota', years: '1991-2002',
    layout: 'I6', bore: 86.0, stroke: 86.0, rod: 142.0, compressionRatio: 8.5,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 34.0, exhaustValveDia: 29.5, lift: 8.7, duration: 236, lsa: 113,
    redline: 7000, idleRpm: 750,
    induction: 'TURBO', boost: 0.75, fullBoostRpm: 3600, intercooler: 0.72,  // on montaj hava-hava, iyi boyutlandirilmis
    runnerLength: 300, runnerDiameter: 45,
    injector: 550, pistonMass: 420, rodMass: 640,
    note: 'Efsanevi demir blok. Cok saglam alt takim, yuksek basinca dayanir.',
    noteEn: 'Legendary iron block. Very strong bottom end, tolerates high boost.',
  },
  {
    id: 'ls3',
    name: 'Chevrolet LS3 6.2 V8',
    manufacturer: 'General Motors', years: '2008-2017',
    layout: 'V8', bore: 103.25, stroke: 92.0, rod: 154.05, compressionRatio: 10.7,
    valvetrain: 'OHV', intakeValvesPerCyl: 1, exhaustValvesPerCyl: 1,
    intakeValveDia: 55.0, exhaustValveDia: 40.4, lift: 13.7, duration: 250, lsa: 117,
    redline: 6600, idleRpm: 650,
    induction: 'NA',
    runnerLength: 260, runnerDiameter: 52,
    injector: 320, pistonMass: 470, rodMass: 620,
    note: 'Buyuk hacim, itici cubuklu tek kam. Dusuk devirde tork canavari.',
    noteEn: 'Big displacement pushrod V8. Torque monster down low.',
  },
  {
    id: 'k20a',
    name: 'Honda K20A Type R',
    manufacturer: 'Honda', years: '2001-2011',
    layout: 'I4', bore: 86.0, stroke: 86.0, rod: 139.0, compressionRatio: 11.5,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 35.0, exhaustValveDia: 30.0, lift: 11.5, duration: 292, lsa: 106,
    redline: 8600, idleRpm: 850,
    induction: 'NA',
    runnerLength: 200, runnerDiameter: 42,
    injector: 310, pistonMass: 350, rodMass: 480,
    note: 'VTEC ust kam profili modellenmistir. Yuksek devirde nefes alir.',
    noteEn: 'Models the high VTEC lobe. Breathes hard at high rpm.',
  },
  {
    id: 'ej257',
    name: 'Subaru EJ257 (STI)',
    manufacturer: 'Subaru', years: '2004-2021',
    layout: 'B4', bore: 99.5, stroke: 79.0, rod: 131.45, compressionRatio: 8.2,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 37.0, exhaustValveDia: 32.0, lift: 10.2, duration: 248, lsa: 110,
    redline: 6700, idleRpm: 800,
    induction: 'TURBO', boost: 1.0, fullBoostRpm: 3400, intercooler: 0.64,  // ust montaj — isi emmesiyle bilinir
    runnerLength: 320, runnerDiameter: 44,
    injector: 550, pistonMass: 480, rodMass: 600,
    note: 'Kisa strok, buyuk cap. Boxer dizilim, dusuk agirlik merkezi.',
    noteEn: 'Oversquare boxer. Low centre of gravity.',
  },
  {
    id: 'b58',
    name: 'BMW B58 3.0 Turbo',
    manufacturer: 'BMW', years: '2015-',
    layout: 'I6', bore: 82.0, stroke: 94.6, rod: 144.35, compressionRatio: 11.0,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 31.5, exhaustValveDia: 28.0, lift: 9.9, duration: 252, lsa: 108,
    redline: 7000, idleRpm: 700,
    induction: 'TURBO', boost: 1.05, fullBoostRpm: 2200, intercooler: 0.88,  // modern OEM su-hava
    runnerLength: 270, runnerDiameter: 40,
    injector: 620, pistonMass: 340, rodMass: 520,
    note: 'Modern direkt enjeksiyon, yuksek CR + turbo. Genis tork plaformu.',
    noteEn: 'Modern DI, high CR with boost. Very flat torque plateau.',
  },
  {
    id: 'rb26dett',
    name: 'Nissan RB26DETT',
    manufacturer: 'Nissan', years: '1989-2002',
    layout: 'I6', bore: 86.0, stroke: 73.7, rod: 121.5, compressionRatio: 8.5,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 34.5, exhaustValveDia: 30.0, lift: 8.6, duration: 240, lsa: 114,
    redline: 8000, idleRpm: 850,
    induction: 'TURBO', boost: 0.7, fullBoostRpm: 3800, intercooler: 0.74,  // buyuk on montaj hava-hava
    runnerLength: 230, runnerDiameter: 45,
    injector: 444, pistonMass: 400, rodMass: 570,
    note: 'Cok kisa strok — yuksek devire cok musait. Alti ayri kelebek.',
    noteEn: 'Very short stroke, loves revs. Individual throttle bodies.',
  },
  {
    id: 'coyote',
    name: 'Ford Coyote 5.0 V8',
    manufacturer: 'Ford', years: '2011-',
    layout: 'V8', bore: 92.7, stroke: 92.7, rod: 150.7, compressionRatio: 11.0,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 37.0, exhaustValveDia: 31.8, lift: 12.0, duration: 262, lsa: 112,
    redline: 7000, idleRpm: 700,
    induction: 'NA',
    runnerLength: 240, runnerDiameter: 46,
    injector: 350, pistonMass: 400, rodMass: 545,
    note: 'Kare olcu, dort kamli V8. Hem devir hem hacim.',
    noteEn: 'Square bore/stroke, quad-cam V8. Revs and displacement.',
  },
  {
    id: 'barra',
    name: 'Ford Barra 4.0 Turbo',
    manufacturer: 'Ford Australia', years: '2002-2016',
    layout: 'I6', bore: 92.26, stroke: 99.31, rod: 153.68, compressionRatio: 8.7,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 35.0, exhaustValveDia: 30.0, lift: 9.0, duration: 244, lsa: 114,
    redline: 6500, idleRpm: 700,
    induction: 'TURBO', boost: 0.9, fullBoostRpm: 3000, intercooler: 0.76,  // buyuk on montaj hava-hava
    runnerLength: 340, runnerDiameter: 47,
    injector: 630, pistonMass: 460, rodMass: 700,
    note: 'Uzun strok, buyuk hacim turbo alti. Dusuk devirde muazzam tork.',
    noteEn: 'Long stroke big-displacement turbo six. Huge low-end torque.',
  },
  {
    id: 'ea888',
    name: 'VAG EA888 2.0 TSI',
    manufacturer: 'Volkswagen Group', years: '2008-',
    layout: 'I4', bore: 82.5, stroke: 92.8, rod: 144.0, compressionRatio: 9.6,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 33.0, exhaustValveDia: 28.0, lift: 10.0, duration: 246, lsa: 110,
    redline: 6800, idleRpm: 750,
    induction: 'TURBO', boost: 1.0, fullBoostRpm: 2400, intercooler: 0.86,  // modern OEM su-hava
    runnerLength: 280, runnerDiameter: 40,
    injector: 520, pistonMass: 330, rodMass: 500,
    note: 'Yaygin modern turbo dortlu. Direkt enjeksiyon.',
    noteEn: 'Ubiquitous modern turbo four. Direct injection.',
  },
  {
    id: 'viper-v10',
    name: 'Dodge Viper 8.4 V10',
    manufacturer: 'Dodge', years: '2008-2017',
    layout: 'V10', bore: 103.0, stroke: 100.6, rod: 160.0, compressionRatio: 10.2,
    valvetrain: 'OHV', intakeValvesPerCyl: 1, exhaustValvesPerCyl: 1,
    intakeValveDia: 55.4, exhaustValveDia: 42.0, lift: 14.0, duration: 256, lsa: 116,
    redline: 6200, idleRpm: 650,
    induction: 'NA',
    runnerLength: 300, runnerDiameter: 54,
    injector: 390, pistonMass: 520, rodMass: 700,
    note: 'Devasa hacim, dusuk devir. Tork egrisi neredeyse duz.',
    noteEn: 'Enormous displacement, low rpm. Nearly flat torque curve.',
  },
  {
    id: 'v12-na',
    name: 'Ferrari F140 6.3 V12',
    manufacturer: 'Ferrari', years: '2012-',
    layout: 'V12', bore: 94.0, stroke: 75.2, rod: 143.0, compressionRatio: 13.5,
    valvetrain: 'DOHC', intakeValvesPerCyl: 2, exhaustValvesPerCyl: 2,
    intakeValveDia: 36.0, exhaustValveDia: 30.5, lift: 12.5, duration: 280, lsa: 104,
    redline: 8500, idleRpm: 900,
    induction: 'NA',
    runnerLength: 180, runnerDiameter: 44,
    injector: 400, pistonMass: 360, rodMass: 480,
    note: 'Cok yuksek CR, kisa strok, kisa runner. Tepe guc icin kurulmus.',
    noteEn: 'Very high CR, short stroke, short runners. Built for peak power.',
  },
  {
    id: '4age',
    name: 'Toyota 4A-GE 20V',
    manufacturer: 'Toyota', years: '1991-1998',
    layout: 'I4', bore: 81.0, stroke: 77.0, rod: 122.0, compressionRatio: 11.0,
    valvetrain: 'DOHC', intakeValvesPerCyl: 3, exhaustValvesPerCyl: 2,
    intakeValveDia: 25.0, exhaustValveDia: 27.5, lift: 8.2, duration: 272, lsa: 106,
    redline: 8000, idleRpm: 850,
    induction: 'NA',
    runnerLength: 210, runnerDiameter: 38,
    injector: 295, pistonMass: 300, rodMass: 420,
    note: 'Silindir basina 5 supap, bagimsiz kelebekler. Kucuk ama istekli.',
    noteEn: 'Five valves per cylinder, ITBs. Small but eager.',
  },
];

/**
 * Ikincil parametreleri olceklendirerek tam motor tanimini uretir.
 *
 * Olcekleme kurallari fiziksel: yay basinci supap kutlesi ve hedef
 * devirle, atalet momenti hacim ve silindir sayisiyla, yatak caplari
 * silindir capiyla orantilidir.
 */
function buildEngine(s: PresetSpec): EngineConfig {
  const nCyl = cylinderCount(s.layout);
  const bore = s.bore / 1000;
  const stroke = s.stroke / 1000;
  const displacementPerCyl = (Math.PI / 4) * bore * bore * stroke;
  const totalDisp = displacementPerCyl * nCyl;

  // Supap mekanizmasi kutlesi: supap capiyla olceklenir
  const valveMass = 0.045 * Math.pow(s.intakeValveDia / 34, 2.2) *
    (s.valvetrain === 'OHV' ? 2.6 : 1.0); // itici cubuk + kulbutor eklenir

  // Yay basinci: hedef devirde supap yuzmesini onleyecek kadar.
  // a_max ∝ lift·rpm² oldugundan yay kuvveti de oyle olceklenir.
  const camDurRad = ((s.duration / 2) * Math.PI) / 180;
  const omegaCamAtRedline = ((s.redline / 2) * 2 * Math.PI) / 60;
  const peakAccel = (8 * (s.lift / 1000) * omegaCamAtRedline * omegaCamAtRedline) /
    (camDurRad * camDurRad);
  // %15 emniyet payi ile
  const springOpen = valveMass * peakAccel * 1.15;
  const springSeat = springOpen * 0.42;

  const geometry: Geometry = {
    bore, stroke,
    rodLength: s.rod / 1000,
    compressionRatio: s.compressionRatio,
    deckClearance: 0.0009,
    pinOffset: 0.0008,
    squishAreaRatio: s.valvetrain === 'OHV' ? 0.30 : 0.18,
  };

  const valvetrain: Valvetrain_Spec = {
    type: s.valvetrain,
    intakeValvesPerCyl: s.intakeValvesPerCyl,
    exhaustValvesPerCyl: s.exhaustValvesPerCyl,
    intakeValveDia: s.intakeValveDia / 1000,
    exhaustValveDia: s.exhaustValveDia / 1000,
    intakeCam: {
      lift: s.lift / 1000,
      duration: s.duration * 0.82,
      advertisedDuration: s.duration,
      centerline: s.lsa,
    },
    exhaustCam: {
      lift: s.lift / 1000,
      duration: s.duration * 0.82,
      advertisedDuration: s.duration,
      centerline: s.lsa,
    },
    lsa: s.lsa,
    springSeatPressure: springSeat,
    springOpenPressure: springOpen,
    valvetrainMass: valveMass,
    portFlowQuality: 1.0,
    swirlRatio: s.intakeValvesPerCyl >= 2 ? 0.5 : 1.1,
    tumbleRatio: s.intakeValvesPerCyl >= 2 ? 1.3 : 0.5,
  };

  const boosted = s.induction !== 'NA';

  // --- Turbo boyutlandirmasi ---
  // Kompresor carki motorun tepe debisine gore secilir. Atalet momenti
  // cark capinin BESINCI kuvvetiyle olceklenir — buyuk turbo = gec spool.
  const targetMap = 101325 + (s.boost ?? 0) * 1e5;
  const estPeakDensity = targetMap / (287 * 315);
  const estPeakFlow = 0.95 * estPeakDensity * totalDisp * (s.redline / 120);
  const wheelDia = 0.055 * Math.pow(Math.max(totalDisp, 1e-4) / 2e-3, 0.4);
  const turboInertia = 2.2e-5 * Math.pow(wheelDia / 0.065, 5);

  const induction: Induction = {
    type: s.induction,
    targetBoost: (s.boost ?? 0) * 1e5,
    compressorEfficiency: 0.72,
    intercoolerEfficiency: boosted ? (s.intercooler ?? 0.72) : 0,
    fullBoostRpm: s.fullBoostRpm ?? 3000,
    boostLimit: 101325 + (s.boost ?? 0) * 1e5 * 1.15,
    runnerLength: s.runnerLength / 1000,
    runnerDiameter: s.runnerDiameter / 1000,
    plenumVolume: totalDisp * 1.1,
    throttlePosition: 1.0,
    exhaustFlowCapacity: 1.0,
    primaryLength: 0.75,
    primaryDiameter: bore * 0.42,
    manifold: s.manifold ?? (boosted ? 'CAST' : 'TUBULAR'),
    turbineAR: s.turbineAR ?? 0.70,
    compressorWheelDia: wheelDia,
    turboInertia,
    compressorPeakPR: Math.max((targetMap / 101325) * 0.92, 1.3),
    // Kompresor adasinin merkezi, motorun CALISMA CIZGISINE oturmalidir.
    //
    // Bir turbo motor tam basinca ulastigi devirden kirmizi cizgiye kadar
    // kabaca devirle orantili debi gecirir. Yani calisma cizgisi
    // (fullBoostRpm/redline)·tepe debi ile tepe debi arasindadir; adanin
    // merkezi bu araligin geometrik ortasina konur.
    //
    // Bunun fiziksel karsiligi sudur: ERKEN basinc yapan turbo KUCUK
    // turbodur, adasi da dusuk debidedir. Onceki sabit 0.85 katsayisi
    // adayi her motorda tepe debiye yakin koyuyordu; erken spool eden
    // modern motorlar (B58 2200 rpm'de tam basinc) dusuk devirde adanin
    // cok solunda kaliyor, verim %28 tabanina cakiliyor ve kompresor
    // havayi 85 °C'ye kadar isitiyordu. Vuruntunun asil sebebi buydu.
    compressorPeakFlow: Math.max(
      estPeakFlow * Math.min(Math.max(Math.sqrt((s.fullBoostRpm ?? 3000) / s.redline), 0.45), 0.85),
      0.02,
    ),
    compressorPeakEff: 0.77,
  };

  const fuelSystem: FuelSystem = {
    injection: boosted && s.years >= '2008' ? 'DIRECT' : 'PORT',
    injectorFlowCC: s.injector,
    injectorRefPressure: 300000,
    injectorDeadtime: 0.00095,
    injectorsPerCyl: 1,
    railPressure: 300000,
    batteryVoltage: 13.8,
    targetLambda: boosted ? 0.85 : 0.92,
    targetLambdaWOT: boosted ? 0.82 : 0.90,
    // Depo/ray sicakligi tipik olarak ortam + 15-25 K
    fuelTemp: 313.15,
    // Pompa, enjektorlerin toplam kapasitesinin biraz ustune
    // boyutlandirilir; kullanici kucultup darbogazi gorebilir.
    pumpFlowLPH: s.injector * nCyl * 0.06 * 0.85,
    pumpDeadheadPressure: 650000,
  };

  const ignition: Ignition = {
    autoMBT: true,
    fixedAdvance: 20,
    // Rotar yetkisi. Gercek ECU'lar atmosferik motorlarda 12-16°,
    // asiri doldurulmus motorlarda 20-26° cekebilir; turbo motorda
    // vurunti riski cok daha genis bir yelpazeye yayildigi icin
    // kontrol unitesine daha genis yetki verilir.
    maxRetard: boosted ? 24 : 16,
    dwellTime: 0.0032,
    sparkEnergy: 60,
    knockThreshold: 1.0,
    // Kalibrasyon carpanlari — 1.0 = kalibre edilmis varsayilan davranis
    knockScale: 1,
    knockTempFactor: 1,
    knockBoostFactor: 1,
    knockLambdaFactor: 1,
    boostEnrichment: boosted ? 0.055 : 0.03,
  };

  // Atalet: krank kutlesi hacimle, volan uygulama tipiyle olceklenir
  const crankInertia = 0.018 * nCyl * Math.pow(stroke / 0.086, 2) *
    Math.pow(bore / 0.086, 1.5);
  const mechanical: Mechanical = {
    pistonMass: s.pistonMass / 1000,
    rodMass: s.rodMass / 1000,
    rodRotatingFraction: 0.65,
    crankInertia,
    flywheelInertia: 0.09 + 0.012 * nCyl,
    ringTension: 1.0,
    mainBearingDia: bore * 0.72,
    rodBearingDia: bore * 0.58,
    oilGrade: 40,
    oilTemp: 373.15,
    coolantTemp: 363.15,
    accessoryLoad: 550 + 45 * nCyl,
    // Sektor kurali: yatak capinin her 25.4 mm'si icin 0.0254 mm bosluk
    mainBearingClearance: bore * 0.72 * 0.001,
    rodBearingClearance: bore * 0.58 * 0.001,
    oilPumpCapacity: 1.0,
    oilReliefPressure: 5.0e5,
  };

  return {
    id: s.id,
    name: s.name,
    layout: s.layout,
    geometry,
    valvetrain,
    induction,
    fuel: makeFuel(boosted ? 'GASOLINE' : 'GASOLINE', boosted ? 98 : 95),
    fuelSystem,
    ignition,
    mechanical,
    ambient: standardAmbient(),
    redline: s.redline,
    idleRpm: s.idleRpm,
  };
}

export interface PresetInfo {
  id: string;
  name: string;
  manufacturer: string;
  years: string;
  layout: Layout;
  displacement: number;
  induction: InductionType;
  note: string;
  noteEn: string;
}

export const PRESET_LIST: PresetInfo[] = PRESET_SPECS.map((s) => {
  const nCyl = cylinderCount(s.layout);
  const disp = (Math.PI / 4) * (s.bore / 1000) ** 2 * (s.stroke / 1000) * nCyl;
  return {
    id: s.id, name: s.name, manufacturer: s.manufacturer, years: s.years,
    layout: s.layout, displacement: disp, induction: s.induction,
    note: s.note, noteEn: s.noteEn,
  };
});

const CACHE = new Map<string, EngineConfig>();

/** Preset id'sinden tam motor tanimi */
export function getPreset(id: string): EngineConfig {
  const cached = CACHE.get(id);
  if (cached) return structuredClone(cached);
  const spec = PRESET_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Bilinmeyen motor preseti: ${id}`);
  const built = buildEngine(spec);
  CACHE.set(id, built);
  return structuredClone(built);
}

export function getPresetSpec(id: string): PresetSpec | undefined {
  return PRESET_SPECS.find((s) => s.id === id);
}

export const DEFAULT_PRESET_ID = '2jz-gte';
