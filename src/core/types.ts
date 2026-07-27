/**
 * Motor simulasyonu — tip tanimlari
 *
 * BIRIM POLITIKASI: Cekirdek icinde her sey SI'dir (m, kg, s, K, Pa, J).
 * Kullanici arayuzunde mm/bar/°C/HP gosterilir; donusum sinirda yapilir.
 * Tek istisna: krank acisi, okunabilirlik icin DERECE cinsindendir.
 */

// ============================================================
// MOTOR MIMARISI
// ============================================================

export type Layout =
  | 'I3' | 'I4' | 'I5' | 'I6'
  | 'V6' | 'V8' | 'V10' | 'V12'
  | 'B4' | 'B6';

export type Valvetrain = 'OHV' | 'SOHC' | 'DOHC';

export type InductionType = 'NA' | 'TURBO' | 'SUPERCHARGER';

export type FuelType = 'GASOLINE' | 'E85' | 'E100' | 'METHANOL' | 'RACE_GAS' | 'LPG';

export type InjectionType = 'PORT' | 'DIRECT';

/**
 * Egzoz manifold mimarisi.
 *
 * Turbo motorlarda bu secim spool hizi ile ust devir gucu arasindaki
 * takasi dogrudan belirler; dogal emisli motorlarda ise supurmeyi.
 */
export type ManifoldType =
  | 'LOG'           // kisa, dokum, ucuz — hizli spool, kotu supurme
  | 'CAST'          // fabrika dokum kollektor
  | 'TUBULAR'       // boru kaynakli, esit olmayan uzunluk
  | 'EQUAL_LENGTH'  // esit uzunluk — en iyi supurme, gec spool
  | 'ZOOMIES'       // kisa acik borular (yaris) — minimum karsi basinc
  | 'INDIVIDUAL';   // silindir basina bagimsiz egzoz

/** Silindir blogu geometrisi ve dizilimi */
export interface LayoutSpec {
  cylinders: number;
  /** V motorlarda banka acisi (derece); sirali=0, boxer=180 */
  bankAngle: number;
  /** Atesleme araligi duzgun mu (V8 cross-plane gibi durumlar icin) */
  firingIntervals: number[];
}

// ============================================================
// GEOMETRI
// ============================================================

export interface Geometry {
  /** Silindir capi (m) */
  bore: number;
  /** Strok (m) */
  stroke: number;
  /** Biyel kolu merkez-merkez uzunlugu (m) */
  rodLength: number;
  /** Statik sikistirma orani (-) */
  compressionRatio: number;
  /** Piston tepesi ile blok ust yuzeyi arasi bosluk, TDC'de (m) */
  deckClearance: number;
  /** Krank ofseti / desaksiyel (m). Cogu motorda 0, bazilarinda +2-3mm */
  pinOffset: number;
  /** Yanma odasinin squish (quench) alan orani (0-1) */
  squishAreaRatio: number;
}

// ============================================================
// SUPAP MEKANIZMASI
// ============================================================

export interface CamProfile {
  /** Maksimum supap kalkisi (m) */
  lift: number;
  /** 0.050" kaldirma tabaninda sure (krank derecesi) */
  duration: number;
  /** Reklam edilen sure — gecis rampalari dahil (krank derecesi) */
  advertisedDuration: number;
  /** Lob merkez hatti, TDC'ye gore (krank derecesi) */
  centerline: number;
}

export interface Valvetrain_Spec {
  type: Valvetrain;
  intakeValvesPerCyl: number;
  exhaustValvesPerCyl: number;
  /** Emme supabi tabla capi (m) */
  intakeValveDia: number;
  /** Egzoz supabi tabla capi (m) */
  exhaustValveDia: number;
  intakeCam: CamProfile;
  exhaustCam: CamProfile;
  /** Lob ayrim acisi (kam derecesi) */
  lsa: number;
  /** Supap yayi basinci, kapalida (N) */
  springSeatPressure: number;
  /** Supap yayi basinci, tam kalkista (N) */
  springOpenPressure: number;
  /** Supap + retainer + itici esdeger kutlesi (kg) */
  valvetrainMass: number;
  /** Port akis katsayisi carpani — kafa kalitesi (0.8 stok ... 1.15 ported) */
  portFlowQuality: number;
  /** Swirl orani (-) */
  swirlRatio: number;
  /** Tumble orani (-) */
  tumbleRatio: number;
}

// ============================================================
// INDUKSIYON (EMME) SISTEMI
// ============================================================

export interface Induction {
  type: InductionType;
  /** Hedef manifold basinci, atmosfer uzeri (Pa). NA'da 0 */
  targetBoost: number;
  /** Kompresor izentropik verimi (0-1) */
  compressorEfficiency: number;
  /** Intercooler verimi (0-1). 0 = yok */
  intercoolerEfficiency: number;
  /** Turbo spool karakteri: bu RPM'de tam boost'a ulasir */
  fullBoostRpm: number;
  /** Wastegate ile sinirlanan maks basinc (Pa, mutlak) */
  boostLimit: number;
  /** Emme runner uzunlugu (m) — Helmholtz ayari */
  runnerLength: number;
  /** Emme runner capi (m) */
  runnerDiameter: number;
  /** Plenum hacmi (m^3) */
  plenumVolume: number;
  /** Gaz kelebegi acikligi (0-1) */
  throttlePosition: number;
  /** Egzoz sistemi akis kapasitesi (1.0 = stok, >1 daha az kisitli) */
  exhaustFlowCapacity: number;
  /** Egzoz primer boru uzunlugu (m) */
  primaryLength: number;
  /** Egzoz primer capi (m) */
  primaryDiameter: number;
  /** Egzoz manifold mimarisi */
  manifold: ManifoldType;

  // --- Turbo detaylari ---
  /** Turbin govdesi A/R orani — kucuk = hizli spool + yuksek karsi basinc */
  turbineAR: number;
  /** Kompresor carki capi (m) — uc hizi ve gerilme sinirini belirler */
  compressorWheelDia: number;
  /** Turbo mili + carklarin atalet momenti (kg·m²) — gecikmenin kaynagi */
  turboInertia: number;
  /**
   * Kompresorun en verimli calisma noktasi.
   * Gercek kompresor haritalarindaki "verim adasinin" merkezi.
   */
  compressorPeakPR: number;
  /** Verim adasinin merkezindeki duzeltilmis debi (kg/s) */
  compressorPeakFlow: number;
  /** Adanin tepe verimi (0-1) */
  compressorPeakEff: number;
}

// ============================================================
// YAKIT
// ============================================================

export interface FuelSpec {
  type: FuelType;
  name: string;
  /** Research Octane Number */
  ron: number;
  /** Motor Octane Number */
  mon: number;
  /** Stokiyometrik hava-yakit orani (kutlesel) */
  afrStoich: number;
  /** Alt isil deger (J/kg) */
  lhv: number;
  /** Buharlasma gizli isisi (J/kg) — sarj sogutma etkisi */
  latentHeat: number;
  /** Yogunluk (kg/m^3) */
  density: number;
  /** Laminer alev hizi referans degeri (m/s) @ 1 atm, 300K, phi=1 */
  laminarFlameSpeedRef: number;
  /** Stokiyometrik karisimda molekul basina C ve H atomlari */
  carbonAtoms: number;
  hydrogenAtoms: number;
  oxygenAtoms: number;
  /** Molar kutle (kg/mol) */
  molarMass: number;
}

// ============================================================
// YAKIT SISTEMI VE ATESLEME
// ============================================================

export interface FuelSystem {
  injection: InjectionType;
  /** Enjektor statik debisi (cc/dk @ referans basinc) */
  injectorFlowCC: number;
  /** Referans yakit basinci (Pa, manifolda gore) */
  injectorRefPressure: number;
  /** Enjektor olu zamani / latency (s) @ 13.8V */
  injectorDeadtime: number;
  /** Silindir basina enjektor sayisi */
  injectorsPerCyl: number;
  /** Yakit rayi basinci (Pa, manifolda gore) */
  railPressure: number;
  /** Sistem voltaji (V) — olu zamani etkiler */
  batteryVoltage: number;
  /** Hedef lambda haritasi yerine sabit hedef (1.0 = stokiyometrik) */
  targetLambda: number;
  /** Tam yukte zenginlestirme hedefi (lambda) */
  targetLambdaWOT: number;

  // --- Yakit sicakligi ve pompa ---
  /**
   * Yakit sicakligi (K).
   *
   * Sicak yakit: yogunlugu duser (ayni darbe genisligi daha AZ kutle
   * verir, karisim fakirlesir), buhar basinci yukselir (buhar kilidi
   * riski), ve atomizasyon degisir.
   */
  fuelTemp: number;
  /** Yakit pompasi debisi (L/saat), referans ray basincinda */
  pumpFlowLPH: number;
  /**
   * Pompanin kapali devre (deadhead) basinci (Pa).
   * Debi-basinc egrisi bu iki noktadan turetilir; basinc yukseldikce
   * debi duser.
   */
  pumpDeadheadPressure: number;
}

export interface Ignition {
  /** Ates ateslemesini MBT arayarak otomatik bul */
  autoMBT: boolean;
  /** autoMBT kapaliysa sabit avans (°BTDC) */
  fixedAdvance: number;
  /** Knock limitine gore geri cekilebilecek maks avans (derece) */
  maxRetard: number;
  /** Bobin dwell suresi (s) */
  dwellTime: number;
  /** Kivilcim enerjisi (mJ) — alev cekirdegi olusumu */
  sparkEnergy: number;
  /** Guvenlik payi: knock indeksi bu degeri asarsa avans cekilir (0-1) */
  knockThreshold: number;
}

// ============================================================
// MEKANIK / SURTUNME
// ============================================================

export interface Mechanical {
  /** Piston kutlesi, segman+pim dahil (kg) */
  pistonMass: number;
  /** Biyel kolu kutlesi (kg) */
  rodMass: number;
  /** Biyel kolunun donen kismi orani (~0.65) */
  rodRotatingFraction: number;
  /** Krank mili atalet momenti (kg·m^2) */
  crankInertia: number;
  /** Volan atalet momenti (kg·m^2) */
  flywheelInertia: number;
  /** Segman gerginligi carpani (1.0 = stok, 0.7 = dusuk gerginlik yaris) */
  ringTension: number;
  /** Ana yatak capi (m) */
  mainBearingDia: number;
  /** Biyel yatagi capi (m) */
  rodBearingDia: number;
  /** Yag viskozite sinifi — SAE (orn. 30 = 10W-30'un 30'u) */
  oilGrade: number;
  /** Yag sicakligi (K) */
  oilTemp: number;
  /** Sogutma suyu sicakligi (K) */
  coolantTemp: number;
  /** Aksesuar yuku (W) — alternator, direksiyon, klima */
  accessoryLoad: number;

  // --- Yataklar ve yaglama ---
  /**
   * Ana yatak capsal (diametral) bosluğu (m).
   *
   * Yag basinci bosluğun KUPUYLE ters orantilidir: boslugu %20 artirmak
   * basinci yariya indirir. Gevsek yatak = dusuk basinc, dusuk surtunme,
   * yuksek asinma. Siki yatak = yuksek surtunme ve isi.
   */
  mainBearingClearance: number;
  /** Biyel yatagi capsal boslugu (m) */
  rodBearingClearance: number;
  /** Yag pompasi kapasitesi (1.0 = stok) */
  oilPumpCapacity: number;
  /** Yag basinci tahliye (relief) valfi ayari (Pa) */
  oilReliefPressure: number;
}

// ============================================================
// ORTAM KOSULLARI
// ============================================================

export interface Ambient {
  /**
   * Atmosfer basinci (Pa).
   * `useAltitude` true ise rakimdan hesaplanir, elle girilen deger ezilir.
   */
  pressure: number;
  /** Ortam hava sicakligi (K) */
  temperature: number;
  /** Bagil nem (0-1) */
  humidity: number;
  /** Rakim (m) */
  altitude: number;
  /** Basinci rakimdan otomatik hesapla */
  useAltitude: boolean;
}

// ============================================================
// TAM MOTOR TANIMI
// ============================================================

export interface EngineConfig {
  id: string;
  name: string;
  layout: Layout;
  geometry: Geometry;
  valvetrain: Valvetrain_Spec;
  induction: Induction;
  fuel: FuelSpec;
  fuelSystem: FuelSystem;
  ignition: Ignition;
  mechanical: Mechanical;
  ambient: Ambient;
  /** Kirmizi cizgi (rpm) */
  redline: number;
  /** Rolanti (rpm) */
  idleRpm: number;
}

// ============================================================
// SIMULASYON CIKTILARI
// ============================================================

/** Krank acisina bagli tek cevrim izi */
export interface CycleTrace {
  /** Krank acisi dizisi (derece, -360 = emme TDC oncesi) */
  theta: Float64Array;
  /** Silindir hacmi (m^3) */
  volume: Float64Array;
  /** Silindir basinci (Pa) */
  pressure: Float64Array;
  /** Kutle-ortalamali gaz sicakligi (K) */
  temperature: Float64Array;
  /** Yanmis kutle fraksiyonu (0-1) */
  burnFraction: Float64Array;
  /** Anlik isi birakma hizi (J/deg) */
  heatRelease: Float64Array;
  /** Cidara isi transferi hizi (J/deg, pozitif = gazdan cidara) */
  heatTransfer: Float64Array;
  /** Emme supabi kalkisi (m) */
  intakeLift: Float64Array;
  /** Egzoz supabi kalkisi (m) */
  exhaustLift: Float64Array;
  /** Supaplardan kutle akisi (kg/s, pozitif = silindire giris) */
  intakeFlow: Float64Array;
  exhaustFlow: Float64Array;
  /** Silindirdeki toplam kutle (kg) */
  mass: Float64Array;
  /** Knock integrali (1.0'a ulasirsa vurunti) */
  knockIntegral: Float64Array;
  /** Piston hizi (m/s) */
  pistonVelocity: Float64Array;
  /** Silindir eteği yan kuvveti (N) */
  sideForce: Float64Array;
}

/** Tek bir RPM noktasinin tum sonuclari */
export interface OperatingPoint {
  rpm: number;
  /** Manifold mutlak basinci (Pa) */
  map: number;
  /** Manifoldda olculen emme havasi sicakligi (K) — VE referansi */
  iat: number;
  /** Silindire gercekten giren dolgu sicakligi (K) — port isitmasi dahil */
  chargeTemp: number;
  /** Hacimsel verim (0-1) */
  volumetricEfficiency: number;
  /** Silindir basina hava kutlesi, cevrim basina (kg) */
  airMassPerCycle: number;
  /** Toplam hava debisi (kg/s) */
  massAirFlow: number;
  /** Yakit debisi (kg/s) */
  fuelFlow: number;
  /** Gercek AFR */
  afr: number;
  lambda: number;
  /** Kullanilan ateslemeavansi (°BTDC) */
  sparkAdvance: number;
  /** MBT avansi (°BTDC) — knock sinirlamasi olmasaydi */
  mbtAdvance: number;
  /** Knock yuzunden cekilen avans (derece) */
  knockRetard: number;
  /** Knock riski (0-1) */
  knockRisk: number;
  /** Gosterge ortalama efektif basinci (Pa) */
  imep: number;
  /** Fren ortalama efektif basinci (Pa) */
  bmep: number;
  /** Sürtünme ortalama efektif basinci (Pa) */
  fmep: number;
  /** Pompalama ortalama efektif basinci (Pa, negatif = kayip) */
  pmep: number;
  /** Fren torku (N·m) */
  torque: number;
  /** Fren gucu (W) */
  power: number;
  /** Gosterge gucu (W) */
  indicatedPower: number;
  /** Surtunme gucu (W) */
  frictionPower: number;
  /** Tepe silindir basinci (Pa) */
  peakPressure: number;
  /** Tepe basincin olustugu krank acisi (°ATDC) */
  peakPressureAngle: number;
  /** Tepe gaz sicakligi (K) */
  peakTemperature: number;
  /** Egzoz gazi sicakligi (K) */
  egt: number;
  /** Yanma odasi cidar sicakligi (K) */
  chamberWallTemp: number;
  /** Termal verim (0-1) */
  thermalEfficiency: number;
  /** Mekanik verim (0-1) */
  mechanicalEfficiency: number;
  /** Ozgul yakit tuketimi (kg/J) */
  bsfc: number;
  /** Artik gaz fraksiyonu (0-1) */
  residualFraction: number;
  /** Ortalama piston hizi (m/s) */
  meanPistonSpeed: number;
  /** Tepe piston hizi (m/s) */
  peakPistonSpeed: number;
  /** Enjektor doluluk orani (0-1) */
  injectorDutyCycle: number;
  /** Enjektor darbe genisligi (s) */
  injectorPulseWidth: number;
  /** Dinamik sikistirma orani */
  dynamicCompressionRatio: number;
  /** Yanma suresi 0-10% (krank derecesi) */
  ignitionDelay: number;
  /** Yanma suresi 10-90% (krank derecesi) */
  burnDuration: number;
  /** Turbulanslı alev hizi (m/s) */
  flameSpeed: number;
  /** Supap yuzmesi baslangic RPM'i asildi mi */
  valveFloat: boolean;
  /** Maks yatak yuku (N) */
  peakBearingLoad: number;
  /** Maks etek yan kuvveti (N) */
  peakSideForce: number;
  /** Egzoz karsi basinci (Pa) */
  exhaustBackpressure: number;
  /**
   * Hapsetme/supurme verimi (0-1) = silindirdeki TAZE dolgu orani.
   * Cozucunun hesapladigi artik gaz fraksiyonundan dogrudan gelir,
   * ampirik bir korelasyondan degil.
   */
  scavengingEfficiency: number;
  /** Brut IMEP — pompalama kayiplari haric (Pa) */
  imepGross: number;
  /** Surtunme kaybinin bilesenlere dagilimi */
  friction: FrictionBreakdown;
  /** Emme sisteminin Helmholtz ayar devri (rpm) */
  intakeTunedRpm: number;

  // ---------- Yaglama ----------
  /** Yag galeri basinci (Pa, gauge) */
  oilPressure: number;
  /** Minimum yag film kalinligi, biyel yataginda (m) */
  minOilFilm: number;
  /**
   * Asinma indeksi (0-1). Film kalinligi yuzey purüzlülüğüne
   * yaklastikca yukselir; 1 = metal-metal temas rejimi.
   */
  wearIndex: number;

  // ---------- Yakit sistemi ----------
  /** Gereken yakit debisi (L/saat) */
  fuelDemandLPH: number;
  /** Pompanin bu basincta verebildigi debi (L/saat) */
  fuelSupplyLPH: number;
  /** Yakit sistemi emniyet payi (0-1). Negatif = yetersiz. */
  fuelHeadroom: number;
  /** Buhar kilidi payi (Pa). Negatif = buhar kilidi riski. */
  vaporLockMargin: number;
  /** Yakit damlacik ortalama capi — Sauter (m) */
  sauterMeanDiameter: number;

  // ---------- Turbo ----------
  /** Kompresorun bu noktadaki gercek izentropik verimi (0-1) */
  compressorEfficiency: number;
  /** Kompresor cark uc hizi (m/s) — gerilme siniri ~520 m/s */
  compressorTipSpeed: number;
  /** Turbo mili devri (rpm) */
  turboRpm: number;
  /** Surge sinirina yakinlik (0-1, 1 = surge) */
  surgeMargin: number;
  /** Turbin girisindeki basinc (Pa) */
  turbinePressure: number;
  /** Turbin giris sicakligi (K) — govde dayanim siniri ~1220 K */
  turbineInletTemp: number;
  /** Turbo yataklarina giden isi yuku (W) */
  turboHeatLoad: number;

  // ---------- Termal durum ----------
  /** Isinma faktoru (0 = tamamen soguk, 1 = calisma sicakliginda) */
  warmupFactor: number;
  /** Ortamdan gelen oksijen bulunurlugu (1.0 = kuru deniz seviyesi) */
  oxygenFactor: number;
  /** Ortam kosullarinin guce etkisi (1.0 = referans kosul) */
  densityAltitudeFactor: number;
  /** Yanma verimi (0-1) — zengin karisimda ve soguk motorda duser */
  combustionEfficiency: number;
  /** Cidarlara kaybedilen isi gucu (W) */
  wallHeatPower: number;
  /** Bu noktanin tam krank izi (opsiyonel — bellek icin sadece istenirse) */
  trace?: CycleTrace;
  /** Uyarilar */
  warnings: SimWarning[];
}

/**
 * Surtunme ve parazitik kayip bilesenleri, FMEP olarak (Pa).
 * Her kalem ayri tutulur ki "gucun nereye gittigi" gorulebilsin.
 */
export interface FrictionBreakdown {
  /** Segman yay gerginligi */
  ringTension: number;
  /** Gaz basinciyla segmanlarin cidara bastirilmasi */
  ringGasLoaded: number;
  /** Piston etegi */
  pistonSkirt: number;
  /** Ana + biyel yataklari */
  bearings: number;
  /** Supap mekanizmasi */
  valvetrain: number;
  /** Yag pompasi */
  oilPump: number;
  /** Su pompasi */
  waterPump: number;
  /** Alternator */
  alternator: number;
  /**
   * Krank yag calkalama (windage) kaybi — krank milinin yag sisi
   * icinde donmesi. Devrin kubuyle artar, yuksek devirde belirgindir.
   */
  windage: number;
  /** Mekanik korugu (supersarj) tahrik gucu. Turboda 0. */
  superchargerDrive: number;
  /** Toplam FMEP — pompalama kaybi HARIC (o PMEP olarak ayri) */
  total: number;
}

export type WarningSeverity = 'info' | 'caution' | 'danger';

export interface SimWarning {
  severity: WarningSeverity;
  /** i18n anahtari */
  key: string;
  /** Mesajdaki degiskenler */
  params?: Record<string, string | number>;
}

/** Tum RPM suprumesi sonucu */
export interface SweepResult {
  engine: EngineConfig;
  points: OperatingPoint[];
  peakPower: { rpm: number; value: number };
  peakTorque: { rpm: number; value: number };
  /** Statik hesaplanmis ozellikler */
  statics: EngineStatics;
}

/** RPM'den bagimsiz, geometriden turetilen ozellikler */
export interface EngineStatics {
  /** Silindir basina hacim (m^3) */
  displacementPerCyl: number;
  /** Toplam hacim (m^3) */
  totalDisplacement: number;
  /** Sikistirma hacmi (m^3) */
  clearanceVolume: number;
  /** Biyel/strok orani */
  rodStrokeRatio: number;
  /** Bore/stroke orani */
  boreStrokeRatio: number;
  /** Emme supabi kapanmasi (°ABDC) */
  ivcAngle: number;
  /** Dinamik sikistirma orani (IVC bazli) */
  dynamicCR: number;
  /** Etkin strok (m) */
  effectiveStroke: number;
  /** Supap yuzmesi esik RPM'i */
  valveFloatRpm: number;
  /** Ortalama piston hizi limitine gore onerilen redline */
  recommendedRedline: number;
  /** Toplam supap alani / piston alani orani */
  valveToPistonAreaRatio: number;
  /** Emme supabi perde alani @ maks kalkis (m^2) */
  intakeCurtainArea: number;
  /** Donen + gidip gelen esdeger atalet (kg·m^2) */
  totalRotatingInertia: number;
}
