/**
 * Krank-acisi cozunurluklu cevrim cozucusu — simulasyonun kalbi
 *
 * COZUM ARALIGI: theta = −360° … +360°  (0° = atesleme TDC'si)
 *   −360 … −180 : emme zamani      (−360 = bindirme TDC'si)
 *   −180 …    0 : sikistirma
 *      0 …  180 : genisleme (guc)
 *    180 …  360 : egzoz            (+360 = bindirme TDC'si, cevrim kapanir)
 *
 * Atesleme TDC'sini merkeze almak, yanmanin (buji ~−25°, bitis ~+45°)
 * cozum araliginin ortasinda kalmasini saglar; sarma noktasinda
 * bolunmez.
 *
 * ENERJI DENKLEMI (tek bolge, acik sistem):
 *   m·cv·dT/dt = −p·dV/dt + Q̇_yanma − Q̇_cidar
 *                + ṁ_giris·h_giris − ṁ_cikis·h_silindir − u·(ṁ_giris − ṁ_cikis)
 *
 * Kimyasal enerji, bilesim degisimi uzerinden DEGIL, acik bir Q̇_yanma
 * terimiyle verilir (duyulur enerji formulasyonu). Bu, sayisal olarak
 * cok daha kararlidir ve isi birakma egrisini dogrudan gozlemlenebilir kilar.
 */

import type {
  EngineConfig, CycleTrace, OperatingPoint, SimWarning,
} from './types';
import {
  airComposition, combustionProducts, blendComposition, compressibleFlow,
  mixtureR, mixtureCv, mixtureGamma, sensibleInternalEnergy,
  sensibleEnthalpy, clamp, type Composition,
} from './gas';
import {
  makeKinematics, cylinderVolume, cylinderVolumeDeriv,
  meanPistonSpeed, pistonForces, reciprocatingMass, cylinderCount,
  dynamicCompressionRatio, type CrankKinematics,
} from './geometry';
import {
  intakeFlowArea, exhaustFlowArea, intakeLift, exhaustLift,
  ivcCycleAngle, valveFloatThreshold,
} from './valve';
import {
  wiebeBurnFraction, wiebeBurnRate, laminarFlameSpeed, turbulenceIntensity,
  turbulentFlameSpeed, burnDurations, knockIntegralStep, endGasStep,
  type KnockCalibration,
  effectiveOctane, chargeCoolingDrop,
} from './combustion';
import {
  woschniCoefficient, chamberArea, wallTemperatures, motoredPressure,
  exhaustGasTemperature, type WallTemps,
} from './heat';
import {
  computeBoost, exhaustBackpressure, chargeDensity, intakeTunedRpm,
  tuningVEMultiplier, portHeating,
} from './induction';
import { frictionBreakdown, frictionPower, bearingLoadAssessment, oilCondition, type FrictionBreakdown } from './friction';
import { resolveAmbient, oxygenFactor, densityAltitudeFactor } from './environment';
import { thermalState } from './thermal';
import { solveLubrication, oilPressureVerdict } from './lubrication';
import {
  solveCompressor, solveTurbine, turbineBackpressure, effectiveSpoolRpm,
  tipSpeedVerdict, MANIFOLDS,
} from './turbo';
import {
  fuelDensityAt, solveFuelSupply, vaporLockMargin, sauterMeanDiameter,
  commandedLambda,
} from './fuel';

const DEG2RAD = Math.PI / 180;

export interface SolverOptions {
  /** Entegrasyon adimi (krank derecesi) */
  step: number;
  /** Cevrim yakinsama iterasyon siniri */
  maxIterations: number;
  /** Yakinsama toleransi (bagil) */
  tolerance: number;
  /** Tam krank izini sakla (bellek maliyetli) */
  keepTrace: boolean;
  /**
   * Atesleme optimizasyonunun kac kez calistirilacagi.
   *
   * MBT aramasi + vurunti ikili aramasi, tek bir calisma noktasinin
   * maliyetinin ~%80'idir. Sinir kosullari oturduktan sonra bir kez daha
   * aramak dogrulugu artirir (2), ama harita uretimi gibi yuzlerce nokta
   * cozulen islerde tek gecis (1) yeterlidir ve ~2 kat hizlandirir.
   */
  ignitionPasses: number;
}

export const DEFAULT_OPTIONS: SolverOptions = {
  step: 0.5,
  maxIterations: 12,
  tolerance: 1e-4,
  keepTrace: false,
  ignitionPasses: 2,
};

/** Cevrim baslangic/bitis durumu — iterasyonla yakinsatilir */
interface CycleState {
  /** Silindirdeki toplam kutle (kg) */
  mass: number;
  /** Sicaklik (K) */
  temperature: number;
  /** Yanmis gaz kutlesi (kg) */
  burnedMass: number;
  /**
   * IVC anindaki artik gaz fraksiyonu (0-1).
   *
   * Neden ayri tasiniyor: cevrim BINDIRME TDC'sinde basliyor ve o anda
   * silindir hemen tamamen egzoz gazi dolu — oradaki yanmis-gaz orani
   * ~1.0'dir, artik gaz fraksiyonu DEGILDIR. Artik gaz, emme bittikten
   * sonra (IVC'de) silindirde kalan yanmis gaz oranidir ve tipik olarak
   * %3-12 arasindadir.
   *
   * Bu ayrimi kacirmak zincirleme hataya yol acar: sahte %90 artik gaz
   * laminer alev hizini 7 kat dusurur, yanma suresi 120°'ye cikar,
   * cozucu de bunu telafi icin ateslemeyi 55° avansa dayar.
   */
  residualFraction: number;
}

/** Cevrim cozumunun ham ciktisi */
export interface CycleResult {
  /** Gosterge isi, tum cevrim (J) — brut, pompalama dahil */
  indicatedWorkNet: number;
  /** Sadece sikistirma+genisleme isi (J) */
  indicatedWorkGross: number;
  /** Pompalama isi (J) — genelde negatif */
  pumpingWork: number;
  /** Cevrim basina IVC'de HAPSEDILEN taze hava kutlesi (kg) — is ureten kisim */
  trappedAirMass: number;
  /** Emme supabindan gecen brut hava (kg) — supurmede kacan dahil */
  grossAirThroughput: number;
  /** Hapsetme orani = hapsedilen / brut (0-1) */
  trappingRatio: number;
  /** Cevrim basina yakit kutlesi (kg) */
  fuelMass: number;
  /** Artik gaz fraksiyonu (0-1) */
  residualFraction: number;
  peakPressure: number;
  peakPressureAngle: number;
  peakTemperature: number;
  /** EVO anindaki sicaklik ve basinc */
  tempAtEVO: number;
  pressureAtEVO: number;
  /** Vurunti integralinin cevrim sonu degeri */
  knockIntegral: number;
  /**
   * Son gaz bolgesinin gordugu EN YUKSEK sicaklik (K).
   *
   * Vuruntuyu belirleyen sicaklik budur — kutle-ortalamali silindir
   * sicakligi degil. Tesihiste her etkenin agirligi Arrhenius
   * teriminden (3800/T) hesaplandigi icin bu deger disariya verilir.
   */
  peakEndGasTemp: number;
  /** Cidara giden toplam isi (J) */
  wallHeat: number;
  /** Cevrim ortalamasi isi akisi (W/m²) */
  meanHeatFlux: number;
  /** Yanma sonu durumu — bir sonraki iterasyona devredilir */
  endState: CycleState;
  /** Yanma suresi bilgileri */
  ignitionDelay: number;
  burnDuration: number;
  flameSpeed: number;
  /** Maks kuvvetler */
  peakSideForce: number;
  peakRodForce: number;
  peakPistonSpeed: number;
  /** Yanma verimi */
  combustionEfficiency: number;
  trace?: CycleTrace;
}

/** Cozucunun cevrim boyunca sabit tuttugu sinir kosullari */
interface BoundaryConditions {
  /** Manifold mutlak basinci (Pa) */
  intakePressure: number;
  /** Emme havasi sicakligi (K) */
  intakeTemp: number;
  /** Egzoz karsi basinci (Pa) */
  exhaustPressure: number;
  /** Egzoz manifold sicakligi (K) */
  exhaustTemp: number;
  /** Cidar sicakliklari */
  walls: WallTemps;
  /** Karter basinci (Pa) */
  crankcasePressure: number;
  /**
   * Emme runner rezonansindan gelen dinamik basinc carpani.
   *
   * 0D cozucu, emme borusundaki basinc DALGALARINI cozemez — bunun icin
   * 1D gaz dinamigi gerekir. Onun yerine dalga etkisi, emme olayi
   * boyunca manifold basincina uygulanan etkin bir carpan olarak
   * modellenir. Ayar devrinde ~1.12, uyumsuz devirlerde ~0.94 civari.
   */
  intakeRamFactor: number;
  /** Termal duruma bagli yanma verimi carpani (soguk motorda <1) */
  combustionEfficiencyFactor: number;
  /**
   * Cevrimde kullanilacak GERCEK lambda.
   *
   * Hedef lambdadan farkli olabilir: yakit pompasi talebi
   * karsilayamadiginda ray basinci duser, enjektorler daha az yakit
   * verir ve karisim istenmeden fakirlesir. Bu, yuksek devirde
   * pompanin darbogaza donusmesinin gozlemlenebilir sonucudur.
   */
  lambda: number;
  /**
   * Bindirme sirasinda supabin gordugu egzoz basinci carpani.
   * Iyi manifold (esit uzunluk, bireysel) genlesme dalgasiyla bu
   * basinci dusurur ve artik gazi disari ceker; log manifoldda tersi olur.
   */
  scavengePressureFactor: number;
}

/**
 * Tek bir cevrimi 720° boyunca entegre eder.
 *
 * Bu fonksiyon SAF'tir: verilen baslangic durumu ve sinir kosullariyla
 * bir cevrim cozer. Artik gaz ve cidar sicakligi gibi kendine bagimli
 * buyukluklerin yakinsamasi disaridaki `solveOperatingPoint` dongusunun isidir.
 */
export function integrateCycle(
  cfg: EngineConfig,
  k: CrankKinematics,
  rpm: number,
  sparkAdvanceBTDC: number,
  bc: BoundaryConditions,
  start: CycleState,
  opts: SolverOptions,
): CycleResult {
  const step = opts.step;
  const nSteps = Math.round(720 / step);
  const dtSec = step / (6 * Math.max(rpm, 1));
  const omega = (rpm * 2 * Math.PI) / 60;

  const fuel = cfg.fuel;
  const lambda = bc.lambda;
  const phi = 1 / lambda;
  const afr = fuel.afrStoich * lambda;

  // --- Bilesimler ---
  const unburnedComp = airComposition();
  const prod = combustionProducts(
    fuel.carbonAtoms, fuel.hydrogenAtoms, fuel.oxygenAtoms, phi,
    (fuel.lhv * fuel.molarMass) / 1000,
  );
  const burnedComp = prod.composition;
  // Termal durum (soguk motor) yanma verimini dusurur: soguk cidarlar
  // alevi sondurur ve kotu buharlasmis yakit tam yanmaz.
  const combEff = prod.combustionEfficiency * bc.combustionEfficiencyFactor;

  // Yakit buharinin ozgul isiya katkisi. Yakit kutle orani ~%6.4 olsa da
  // buhar cp'si havanin ~1.6 kati oldugu icin sikistirma sicakligini
  // gozle gorulur etkiler; ihmal edilirse TDC sicakligi ~%5 yuksek cikar.
  const fuelMassFraction = 1 / (1 + afr);
  const cpFuelVapor = 1750; // J/kg·K, benzin buhari mertebesi

  // --- Yanma zamanlamasi (alev hizindan turetilir) ---
  const Sp = meanPistonSpeed(cfg.geometry.stroke, rpm);
  const uPrime = turbulenceIntensity(
    Sp, cfg.valvetrain.swirlRatio, cfg.valvetrain.tumbleRatio,
    cfg.geometry.squishAreaRatio,
  );
  // Alev hizi, sikistirma sonu kosullarinda degerlendirilir.
  // Artik gaz orani bir onceki iterasyondan gelir (cevrim yakinsayana dek).
  const pEstimate = bc.intakePressure * Math.pow(cfg.geometry.compressionRatio, 1.32);
  const tEstimate = bc.intakeTemp * Math.pow(cfg.geometry.compressionRatio, 0.32);
  const residualGuess = clamp(start.residualFraction, 0, 0.45);
  const sL = laminarFlameSpeed(fuel, tEstimate, pEstimate, phi, residualGuess);
  const sT = turbulentFlameSpeed(sL, uPrime);
  // Cok supapli kafada buji merkeze yakin, 2 supaplida daha kenarda
  const plugOffset = cfg.valvetrain.intakeValvesPerCyl >= 2 ? 0.10 : 0.35;
  const burn = burnDurations(sT, cfg.geometry.bore, rpm, plugOffset);

  // Wiebe egrisi bujinin atesledigi anda baslar; cekirdek olusum
  // gecikmesi egrinin kendi seklinde zaten mevcuttur (bkz. burnDurations).
  const sparkAngle = -sparkAdvanceBTDC; // cozucu koordinatinda
  const burnStart = sparkAngle;
  const burnTotal = burn.total;

  const octane = effectiveOctane(fuel, cfg.induction.type !== 'NA');
  const recipMass = reciprocatingMass(cfg.mechanical);
  // Vurunti kalibrasyon carpanlari — kullanici ayarlayabilir
  const knockCal: KnockCalibration = {
    scale: cfg.ignition.knockScale,
    tempFactor: cfg.ignition.knockTempFactor,
    boostFactor: cfg.ignition.knockBoostFactor,
    lambdaFactor: cfg.ignition.knockLambdaFactor,
  };

  // --- Durum degiskenleri ---
  let m = start.mass;
  let T = start.temperature;
  let mBurned = start.burnedMass;
  let mFuelTrapped = 0;     // bu cevrimde hapsedilen yakit
  let mTrappedFresh = 0;    // IVC'de silindirde KALAN taze hava
  let mAirInducted = 0;     // emme supabindan gecen brut hava (supurme dahil)
  let mAirBackflow = 0;

  let workGross = 0;
  let workPumping = 0;
  let wallHeat = 0;
  let knockIntegral = 0;
  let peakEndGasTemp = 0;
  let peakP = 0, peakPAngle = 0, peakT = 0;
  let peakSideForce = 0, peakRodForce = 0, peakPistonSpeed = 0;
  let tempAtEVO = T, pressureAtEVO = bc.exhaustPressure;
  let evoRecorded = false;
  let areaAccum = 0;
  /** Bir onceki adimin emme debisi — runner kaybini gecikmeli hesaplamak icin */
  let mdotInLast = 0;
  const runnerDia = cfg.induction.runnerDiameter;

  // IVC durumu — son gaz sicakligi izentropu icin referans
  let T_ivc = T, p_ivc = bc.intakePressure, ivcRecorded = false;
  let residualAtIVC = residualGuess;
  /** Son gaz sicakligi — IVC'de baslatilir, sikisma+isi kaybiyla izlenir */
  let tEndGas = T;
  let pPrevStep = bc.intakePressure;
  const ivcSolverAngle = ivcCycleAngle(cfg.valvetrain) - 720; // → −108 civari

  const trace: CycleTrace | undefined = opts.keepTrace
    ? {
        theta: new Float64Array(nSteps + 1),
        volume: new Float64Array(nSteps + 1),
        pressure: new Float64Array(nSteps + 1),
        temperature: new Float64Array(nSteps + 1),
        burnFraction: new Float64Array(nSteps + 1),
        heatRelease: new Float64Array(nSteps + 1),
        heatTransfer: new Float64Array(nSteps + 1),
        intakeLift: new Float64Array(nSteps + 1),
        exhaustLift: new Float64Array(nSteps + 1),
        intakeFlow: new Float64Array(nSteps + 1),
        exhaustFlow: new Float64Array(nSteps + 1),
        mass: new Float64Array(nSteps + 1),
        knockIntegral: new Float64Array(nSteps + 1),
        pistonVelocity: new Float64Array(nSteps + 1),
        sideForce: new Float64Array(nSteps + 1),
      }
    : undefined;

  // Toplam yakit kutlesi, IVC'de hapsedilen havadan hesaplanir. Ancak
  // yanma IVC'den once baslamaz, dolayisiyla ilk gecis icin tahmin
  // kullanilip IVC'de duzeltilir.
  let fuelForBurn = (start.mass * (1 - residualGuess)) / afr;

  for (let i = 0; i <= nSteps; i++) {
    const theta = -360 + i * step;
    const V = cylinderVolume(k, theta);
    const dVdTheta = cylinderVolumeDeriv(k, theta);

    // --- Bilesim ve ozellikler ---
    const burnedFrac = clamp(mBurned / Math.max(m, 1e-12), 0, 1);
    const comp: Composition = blendComposition(unburnedComp, burnedComp, burnedFrac);
    const Rgas = mixtureR(comp);
    let cv = mixtureCv(comp, T);
    // Yanmamis kisimda yakit buhari cp'yi yukseltir
    const unburnedShare = 1 - burnedFrac;
    cv += unburnedShare * fuelMassFraction * (cpFuelVapor - Rgas - cv) * 0.55;
    cv = Math.max(cv, 300);

    const p = (m * Rgas * T) / Math.max(V, 1e-12);

    if (p > peakP) { peakP = p; peakPAngle = theta; }
    if (T > peakT) peakT = T;

    // --- Supap akislari ---
    const aIn = intakeFlowArea(theta, cfg.valvetrain);
    const aEx = exhaustFlowArea(theta, cfg.valvetrain);
    const gammaLocal = mixtureGamma(comp, T);

    let mdotIn = 0, mdotEx = 0;
    let hIn = 0;
    const mdotInPrev = mdotInLast;

    if (aIn > 0) {
      // Supabin gordugu etkin basinc = plenum basinci
      //   × rezonans kazanci  −  runner'daki dinamik basinc kaybi
      //
      // Kayip hizin KARESIYLE artar (Δp = K·ρ·v²/2). Bu terim olmadan
      // hacimsel verim yuksek devirde gercek disi bicimde yuksek kalir;
      // motorun neden bir devirden sonra "nefes alamadigi" tam olarak
      // budur. K = 1.25 giris kaybi + surtunme + dirsek kaybini kapsar.
      const runnerArea = (Math.PI / 4) * runnerDia * runnerDia;
      const rhoRunner = bc.intakePressure / (287 * Math.max(bc.intakeTemp, 100));
      // Bir onceki adimin debisi kullanilir (0.5° adimda ihmal edilebilir
      // gecikme, ortuk cozum gerektirmez)
      const vRunner = Math.abs(mdotInPrev) / (rhoRunner * runnerArea);
      const dpRunner = 1.25 * 0.5 * rhoRunner * vRunner * vRunner;
      const pIntakeEff = Math.max(
        bc.intakePressure * bc.intakeRamFactor - dpRunner,
        bc.intakePressure * 0.35,
      );
      if (pIntakeEff > p) {
        // Silindire dogru akis — yukari akis manifold
        mdotIn = compressibleFlow(1, aIn, pIntakeEff, p, bc.intakeTemp, 287, 1.4);
        hIn = sensibleEnthalpy(unburnedComp, bc.intakeTemp);
      } else {
        // Geri akis (reversion) — dusuk devirde buyuk kamlarin bedeli
        mdotIn = -compressibleFlow(1, aIn, p, pIntakeEff, T, Rgas, gammaLocal);
        hIn = sensibleEnthalpy(comp, T);
      }
    }

    if (aEx > 0) {
      // Bindirme sirasinda manifold mimarisi supabin gordugu basinci
      // degistirir: iyi bir sistem genlesme dalgasiyla emer, log
      // manifold ise basinc dalgasini geri gonderir.
      const inOverlap = aIn > 0;
      const pExhEff = inOverlap
        ? bc.exhaustPressure * bc.scavengePressureFactor
        : bc.exhaustPressure;
      if (p > pExhEff) {
        mdotEx = compressibleFlow(1, aEx, p, pExhEff, T, Rgas, gammaLocal);
      } else {
        // Egzozdan geri emme — bindirme sirasinda ic EGR yaratir
        mdotEx = -compressibleFlow(1, aEx, pExhEff, p, bc.exhaustTemp, Rgas, gammaLocal);
      }
    }

    // --- Yanma ---
    const xb = wiebeBurnFraction(theta, burnStart, burnTotal);
    const dxb = wiebeBurnRate(theta, burnStart, burnTotal) * step;
    const dQcomb = fuelForBurn * fuel.lhv * combEff * dxb;

    // --- Cidara isi transferi (Woschni) ---
    const phase =
      aIn > 0 || aEx > 0 ? 'GAS_EXCHANGE' : xb > 1e-4 && xb < 0.999 ? 'COMBUSTION' : 'COMPRESSION';
    const areas = chamberArea(k, cfg.geometry, theta);
    const pMot = motoredPressure(p_ivc, cylinderVolume(k, ivcSolverAngle), V, 1.33);
    const hConv = woschniCoefficient(
      cfg.geometry.bore, p, T, Sp, phase,
      k.sweptVolume, p_ivc, T_ivc, cylinderVolume(k, ivcSolverAngle), pMot,
      cfg.valvetrain.swirlRatio,
    );
    // Yuzey agirlikli cidar sicakligi
    const Twall =
      (areas.head * bc.walls.head +
        areas.piston * bc.walls.piston +
        areas.liner * bc.walls.liner) / Math.max(areas.total, 1e-9);
    const dQwall = hConv * areas.total * (T - Twall) * dtSec;
    wallHeat += dQwall;
    areaAccum += areas.total * step;

    // --- Is ---
    const dW = p * dVdTheta * step * DEG2RAD;
    // Gaz degisimi zamanlari (egzoz + emme) pompalama isini olusturur
    const isPumpingStroke = theta >= 180 || theta <= -180;
    if (isPumpingStroke) workPumping += dW; else workGross += dW;

    // --- Enerji denklemi ---
    //
    // Tum terimler DUYULUR enerjidir (olusum entalpisi haric); kimyasal
    // enerji zaten acik dQcomb terimiyle giriyor. u ve h ayni datumdan
    // olculur ve h − u = R·T bagintisi korunur — R·T, giren dolgunun
    // getirdigi akis isidir. (bkz. gas.ts / sensibleEnthalpy)
    const u = sensibleInternalEnergy(comp, T);
    const hCyl = u + Rgas * T;
    const dmIn = mdotIn * dtSec;
    const dmEx = mdotEx * dtSec;
    const dm = dmIn - dmEx;

    // Giris entalpisi: geri akista silindir gazi cikip geri geliyor
    const energyIn = dmIn >= 0 ? dmIn * hIn : dmIn * hCyl;
    const energyOut = dmEx >= 0 ? dmEx * hCyl
      : dmEx * sensibleEnthalpy(burnedComp, bc.exhaustTemp);

    const dU = -dW + dQcomb - dQwall + energyIn - energyOut - u * dm;
    const dT = dU / Math.max(m * cv, 1e-12);

    // --- Son gaz sicakligi ve vurunti integrali ---
    //
    // Son gaz (henuz yanmamis bolge) hem sikisarak isinir hem de cidara
    // isi verir. Kutle-ortalamali sicaklik degil, BU sicaklik vuruntiyu
    // belirler — ve iki terim de gereklidir (bkz. endGasStep).
    if (ivcRecorded) {
      const dp = p - pPrevStep;
      const unburnedMass = m * Math.max(1 - xb, 0);
      // Yanmamis bolge kuculdukce cidarla temas alani da kuculur (~V^(2/3))
      const endGasArea = areas.total * Math.pow(Math.max(1 - xb, 0.02), 2 / 3);
      const tauThermal = (unburnedMass * cv) / Math.max(hConv * endGasArea, 1e-6);
      tEndGas += endGasStep(tEndGas, p, dp, Twall, dtSec, 1.34, tauThermal);
      tEndGas = clamp(tEndGas, 250, 1600);
      if (tEndGas > peakEndGasTemp) peakEndGasTemp = tEndGas;

      // Yanmanin son %5'inde geriye anlamli bir son gaz kutlesi kalmaz;
      // o bolgede integral biriktirmek vuruntiyu suni olarak sisirir.
      if (xb < 0.95 && theta > -120 && theta < 90) {
        knockIntegral += knockIntegralStep(
          octane, p, tEndGas, dtSec, lambda, knockCal,
        );
      }
    }
    pPrevStep = p;

    // --- Kuvvetler ---
    const forces = pistonForces(k, theta, rpm, p, bc.crankcasePressure, recipMass);
    if (Math.abs(forces.sideForce) > Math.abs(peakSideForce)) peakSideForce = forces.sideForce;
    if (Math.abs(forces.rodForce) > Math.abs(peakRodForce)) peakRodForce = forces.rodForce;
    const vPist = Math.abs(cylinderVolumeDeriv(k, theta) / k.pistonArea) * omega;
    if (vPist > peakPistonSpeed) peakPistonSpeed = vPist;

    // --- Iz kaydi ---
    if (trace) {
      trace.theta[i] = theta;
      trace.volume[i] = V;
      trace.pressure[i] = p;
      trace.temperature[i] = T;
      trace.burnFraction[i] = xb;
      trace.heatRelease[i] = dQcomb / step;
      trace.heatTransfer[i] = dQwall / step;
      trace.intakeLift[i] = intakeLift(theta, cfg.valvetrain);
      trace.exhaustLift[i] = exhaustLift(theta, cfg.valvetrain);
      trace.intakeFlow[i] = mdotIn;
      trace.exhaustFlow[i] = mdotEx;
      trace.mass[i] = m;
      trace.knockIntegral[i] = knockIntegral;
      trace.pistonVelocity[i] = vPist;
      trace.sideForce[i] = forces.sideForce;
    }

    // --- EVO durumunu yakala ---
    if (!evoRecorded && exhaustLift(theta, cfg.valvetrain) > 1e-5 && theta > 0) {
      tempAtEVO = T; pressureAtEVO = p; evoRecorded = true;
    }

    // --- Kutle muhasebesi ---
    mdotInLast = mdotIn;
    if (dmIn > 0) mAirInducted += dmIn;
    else mAirBackflow += -dmIn;
    // Yanmis gaz kutlesi: yanma ile artar, egzozdan cikisla azalir
    const burnedOutFrac = clamp(mBurned / Math.max(m, 1e-12), 0, 1);
    mBurned += fuelForBurn * dxb * (1 + afr);
    if (dmEx > 0) mBurned -= dmEx * burnedOutFrac;
    else if (dmEx < 0) mBurned += -dmEx; // egzozdan geri gelen tamamen yanmis gaz
    mBurned = clamp(mBurned, 0, m + dm);

    // --- Durumu ilerlet ---
    m = Math.max(m + dm, 1e-9);
    T = clamp(T + dT, 200, 4000);

    // --- IVC yakalama: hapsedilen kutleyi ve yakiti sabitle ---
    //
    // HAPSEDILEN hava, emme supabindan GECEN havadan farklidir. Bindirme
    // sirasinda MAP egzoz basincindan yuksekse taze dolgunun bir kismi
    // silindirden gecip dogruca egzoza kacar (supurme). O hava is uretmez.
    // Hacimsel verimi akis integralinden hesaplamak, turbo motorlarda
    // %200'u asan fiziksel olarak imkansiz VE degerleri uretir — bu yuzden
    // referans daima IVC anindaki gercek silindir icerigidir.
    if (!ivcRecorded && theta >= ivcSolverAngle) {
      T_ivc = T; p_ivc = p; ivcRecorded = true;
      mTrappedFresh = Math.max(m - mBurned, 0);
      mFuelTrapped = mTrappedFresh / afr;
      fuelForBurn = mFuelTrapped;
      // Artik gaz fraksiyonu TAM BURADA olculur — cevrimin basinda degil
      residualAtIVC = clamp(mBurned / Math.max(m, 1e-12), 0, 0.6);
      // Son gaz izlemesi de IVC durumundan baslar
      tEndGas = T;
      pPrevStep = p;
    }
  }

  // Supurme orani: supaptan gecen brut havanin ne kadari silindirde kaldi.
  // 1'in altindaki degerler taze dolgunun egzoza kactigini gosterir.
  const grossThrough = Math.max(mAirInducted - mAirBackflow, 1e-15);
  const trappingRatio = clamp(mTrappedFresh / grossThrough, 0, 1);
  const meanArea = areaAccum / 720;
  const cycleTimeSec = 120 / Math.max(rpm, 1);
  const meanHeatFlux = wallHeat / (meanArea * cycleTimeSec);

  return {
    indicatedWorkNet: workGross + workPumping,
    indicatedWorkGross: workGross,
    pumpingWork: workPumping,
    trappedAirMass: mTrappedFresh,
    grossAirThroughput: grossThrough,
    trappingRatio,
    fuelMass: mFuelTrapped,
    residualFraction: residualAtIVC,
    peakPressure: peakP,
    peakPressureAngle: peakPAngle,
    peakTemperature: peakT,
    tempAtEVO, pressureAtEVO,
    knockIntegral,
    peakEndGasTemp: peakEndGasTemp || T,
    wallHeat,
    meanHeatFlux,
    endState: {
      mass: m, temperature: T, burnedMass: mBurned,
      residualFraction: residualAtIVC,
    },
    ignitionDelay: burn.delay,
    burnDuration: burn.duration,
    flameSpeed: sT,
    peakSideForce, peakRodForce, peakPistonSpeed,
    combustionEfficiency: combEff,
    trace,
  };
}

/**
 * Tek bir calisma noktasini (RPM) tam olarak cozer.
 *
 * IC ICE UC DONGU vardir ve hepsi gereklidir:
 *  1) Sinir kosulu dongusu — MAP, karsi basinc ve cidar sicakligi cevrimin
 *     sonucuna bagli, cevrim de onlara bagli. Sabit noktaya yakinsatilir.
 *  2) Cevrim periyodiklik dongusu — artik gaz, bir onceki cevrimden gelir.
 *  3) Atesleme optimizasyonu — MBT aranir, sonra vurunti sinirina cekilir.
 */
export function solveOperatingPoint(
  cfgInput: EngineConfig,
  rpm: number,
  opts: Partial<SolverOptions> = {},
): OperatingPoint {
  const o = { ...DEFAULT_OPTIONS, ...opts };

  // ---------- Ortam ve termal durum ----------
  // Rakim secili ise atmosfer basinci ondan turetilir; termal durum
  // (soguk/sicak motor) hedef lambdayi ve yanma verimini kaydirir.
  const ambient = resolveAmbient(cfgInput.ambient);
  const thermal = thermalState(cfgInput.mechanical.coolantTemp);
  const cfg: EngineConfig = {
    ...cfgInput,
    ambient,
    fuelSystem: {
      ...cfgInput.fuelSystem,
      // Soguk motor zenginlestirmesi HER IKI hedefe de uygulanir; yalnizca
      // kismi yuk hedefini kaydirmak, soguk motorda tam gaz karisimini
      // oldugundan fakir birakirdi.
      targetLambda: cfgInput.fuelSystem.targetLambda * thermal.lambdaMultiplier,
      targetLambdaWOT: cfgInput.fuelSystem.targetLambdaWOT * thermal.lambdaMultiplier,
    },
  };

  const k = makeKinematics(cfg.geometry);
  const nCyl = cylinderCount(cfg.layout);
  const totalDisp = k.sweptVolume * nCyl;
  const warnings: SimWarning[] = [];
  const manifold = MANIFOLDS[cfg.induction.manifold];
  const oxyFactor = oxygenFactor(ambient.pressure, ambient.temperature, ambient.humidity);
  const densityFactor = densityAltitudeFactor(ambient);

  // --- Baslangic tahminleri ---
  let map = cfg.ambient.pressure;
  let iat = cfg.ambient.temperature + 10;
  // Yakit buharlasmasiyla sogutulmus manifold sicakligi (VE referansi)
  let iatEffective = iat;
  // Port isitmasi da eklendikten sonra silindire giren gercek dolgu sicakligi
  let chargeTemp = iat;
  let backpressure = cfg.ambient.pressure * 1.08;
  let egt = 900;
  let walls = wallTemperatures(cfg.mechanical, 120e3);
  let maf = 0.02 * nCyl * (rpm / 3000);

  let cycle: CycleResult | null = null;
  let tunedRpm = 0;
  let compressor: ReturnType<typeof solveCompressor> | null = null;
  let superchargerPower = 0;
  /** Cevrimde kullanilan gercek lambda — pompa yetersizse hedeften sapar */
  let lambdaActual = cfg.fuelSystem.targetLambda;
  let state: CycleState = {
    mass: (cfg.ambient.pressure * k.sweptVolume) / (287 * 350),
    temperature: 400,
    burnedMass: 0,
    residualFraction: 0.06, // makul baslangic tahmini; iterasyonla duzelir
  };
  let spark = cfg.ignition.autoMBT ? 25 : cfg.ignition.fixedAdvance;
  let mbtAdvance = spark;
  let knockRetard = 0;
  /**
   * Vurunti yuzunden kesilen basinc orani (1 = kesinti yok).
   *
   * Gercek bir ECU'nun vuruntuya karsi IKI kozu vardir ve sirasi
   * bellidir: once ateslemeyi geri ceker, o da yetmezse BASINCI KESER
   * (wastegate'i acar). Ikinci koz modelde yoktu; bu yuzden hizli yanan,
   * MBT'si zaten dusuk olan modern motorlar (kucuk cap + yuksek turbulans
   * = MBT 8-10°) geri cekecek yer bulamayip cozumsuz kaliyordu. Oysa
   * gercekte o motorlar basinc dusurerek kendilerini korur.
   *
   * Bu yalnizca bir "duzeltme" degil, ogretici de: dusuk oktan yakit
   * koydugunda ya da basinci fazla actiginda model artik "vurunti var"
   * demekle kalmiyor, GUCUN NE KADAR DUSTUGUNU de gosteriyor.
   */
  let boostTrim = 1;
  let needIgnitionResearch = false;

  // Iterasyon sayisi, basinc kesme adimlarina da yer birakmalidir:
  // trim 1.00'dan 0.35'e 0.08'lik adimlarla inerse 8 adim gerekir ve
  // her adim bir dis iterasyon harcar.
  for (let outer = 0; outer < 16; outer++) {
    // 1) Sinir kosullarini guncelle
    //
    // Turbo motorlarda spool devri A/R oranindan, turbo ataletinden ve
    // manifold mimarisinden etkilenir; kucuk A/R + agir olmayan cark +
    // kisa log manifold = erken spool.
    const spoolRpm = effectiveSpoolRpm(
      cfg.induction.fullBoostRpm, cfg.induction.turbineAR,
      cfg.induction.turboInertia, manifold,
    );
    const boost = computeBoost(
      {
        ...cfg.induction,
        fullBoostRpm: spoolRpm,
        // Vurunti kontrol edilemiyorsa wastegate acilir
        targetBoost: cfg.induction.targetBoost * boostTrim,
        boostLimit: ambient.pressure +
          (cfg.induction.boostLimit - ambient.pressure) * boostTrim,
      },
      ambient, rpm, maf,
    );
    map = boost.map;
    superchargerPower = boost.compressorPower;

    // Kompresor verimi SABIT degil — basinc orani ve debiye bagli.
    // Adanin disinda calismak cikis havasini onemli olcude isitir.
    if (cfg.induction.type !== 'NA' && map > ambient.pressure * 1.01) {
      compressor = solveCompressor(
        maf, ambient.temperature, ambient.pressure, map / ambient.pressure,
        cfg.induction.compressorWheelDia, cfg.induction.compressorPeakPR,
        cfg.induction.compressorPeakFlow, cfg.induction.compressorPeakEff,
      );
      const ic = clamp(cfg.induction.intercoolerEfficiency, 0, 0.95);
      iat = compressor.outletTemp - ic * (compressor.outletTemp - ambient.temperature);
    } else {
      compressor = null;
      iat = boost.iat;
    }

    // Yakit buharlasmasi dolguyu sogutur.
    //
    // GERCEKTE YANAN karisim kullanilir, kismi yuk hedefi degil: tam yukte
    // ECU zenginlestirir, fazla yakit buharlasirken dolgudan gizli isi
    // ceker ve son gaz sicakligini dusurur. Turbo motorlarda vuruntuyu
    // bastirmanin birincil mekanizmasi budur. lambdaActual pompa
    // yetersizligini de icerir; pompa yetisemeyip karisim fakirlesirse
    // sogutma da azalir ve vurunti riski hakli olarak yukselir.
    const cooling = chargeCoolingDrop(
      cfg.fuel, cfg.fuel.afrStoich * lambdaActual, 1010,
      cfg.fuelSystem.injection === 'DIRECT',
    );
    iatEffective = Math.max(iat - cooling, 200);

    // Port isitmasi: dolgu, sicak emme portundan ve supaptan gecerken
    // isinir. Soguk motorda port da soguktur, isitma azalir — bu yuzden
    // soguk motorun hacimsel verimi bir miktar YUKSEKTIR.
    const intakeDurationDeg = cfg.valvetrain.intakeCam.advertisedDuration;
    const mdotPerCylEvent = (maf * 720) / (nCyl * Math.max(intakeDurationDeg, 1));
    const portWallTemp = cfg.mechanical.coolantTemp + 25;
    const portGain =
      portHeating(mdotPerCylEvent, portWallTemp, iatEffective, cfg.geometry.bore) *
      thermal.portHeatingMultiplier;
    chargeTemp = iatEffective + portGain;

    // Egzoz karsi basinci: turboda turbin govdesi belirleyicidir,
    // dogal emiste boru sistemi.
    backpressure = cfg.induction.type === 'TURBO'
      ? turbineBackpressure(
          maf, ambient.pressure, egt, cfg.induction.turbineAR, manifold,
          cfg.induction.exhaustFlowCapacity,
        )
      : ambient.pressure +
        (exhaustBackpressure(
          maf, ambient.pressure, egt, cfg.induction.exhaustFlowCapacity,
          cfg.induction.primaryDiameter, nCyl,
        ) - ambient.pressure) * manifold.backpressure;

    tunedRpm = intakeTunedRpm(
      cfg.induction, k.sweptVolume, cfg.geometry.compressionRatio, iatEffective,
    );
    const ramFactor = tuningVEMultiplier(rpm, tunedRpm, 0.12);

    // ECU'nun bu yukte KOMUT ETTIGI lambda. Manifold basincina bagli
    // oldugu icin dis dongude, MAP oturduktan sonra hesaplanir.
    // Tam yuk zenginlestirmesi vuruntuyu bastirmanin birincil aracidir;
    // bunu atlamak turbo motorlari olduklarindan cok daha vuruntulu
    // gosterirdi.
    const lambdaCommand = commandedLambda(
      cfg.fuelSystem.targetLambda, cfg.fuelSystem.targetLambdaWOT,
      map, ambient.pressure, cfg.ignition.boostEnrichment,
    );

    // Yakit beslemesi: pompa talebi karsilayamazsa ray basinci duser,
    // enjektorler daha az yakit verir ve karisim ISTENMEDEN fakirlesir.
    // Bu geri besleme olmadan pompa darbogazi hicbir sey degistirmez.
    const afrTarget = cfg.fuel.afrStoich * lambdaCommand;
    const railG = cfg.fuelSystem.railPressure +
      (cfg.induction.type !== 'NA' ? Math.max(map - ambient.pressure, 0) : 0);
    const supplyEst = solveFuelSupply(
      cfg.fuel, cfg.fuelSystem.fuelTemp, (maf * 0.92) / afrTarget, railG,
      cfg.fuelSystem.pumpFlowLPH, cfg.fuelSystem.injectorRefPressure,
      cfg.fuelSystem.pumpDeadheadPressure,
    );
    lambdaActual = clamp(
      lambdaCommand / Math.max(supplyEst.leanoutFactor, 0.35),
      0.55, 1.45,
    );

    const bc: BoundaryConditions = {
      intakePressure: map,
      intakeTemp: chargeTemp,
      exhaustPressure: backpressure,
      exhaustTemp: egt,
      walls,
      crankcasePressure: ambient.pressure * 0.98,
      intakeRamFactor: ramFactor,
      combustionEfficiencyFactor: thermal.combustionEfficiencyMultiplier,
      lambda: lambdaActual,
      // Iyi bir manifold, bindirme sirasinda supaba genlesme dalgasi
      // gonderip artik gazi disari ceker — supabin gordugu etkin egzoz
      // basincini dusurur.
      scavengePressureFactor: Math.pow(1 / manifold.scavenging, 0.35),
    };

    // 2) Atesleme avansini bul. Sinir kosullari oturduktan sonra bir kez
    //    daha aranir; her dis iterasyonda tekrarlamak gereksiz pahali.
    if (outer === 0 || needIgnitionResearch || (outer === 2 && o.ignitionPasses > 1)) {
      needIgnitionResearch = false;
      mbtAdvance = findMBT(cfg, k, rpm, bc, state, o);
      spark = cfg.ignition.autoMBT ? mbtAdvance : cfg.ignition.fixedAdvance;

      // Vurunti sinirlamasi.
      //
      // Knock integrali avansla MONOTON artar (daha erken atesleme =
      // son gaz daha uzun sure yuksek basinc/sicaklikta bekler), bu
      // yuzden ikili arama gecerlidir ve 0.5°'lik lineer taramaya gore
      // ~4 kat daha az cevrim cozumu gerektirir.
      //
      // Adim boyutu, NIHAI cozumle AYNI olmali. MBT aramasi kaba adimla
      // yapilabilir (orada sadece isin nerede tepe yaptigi onemli), ama
      // vurunti integrali adim boyutuna duyarlidir: kaba adimla sinirda
      // bulunan avans, ince adimla cozuldugunde esigi asar ve raporda
      // "%100'un uzerinde vurunti riski" gibi tutarsiz degerler cikar.
      const probe: SolverOptions = { ...o, maxIterations: 4, keepTrace: false };
      const knockAt = (adv: number) =>
        convergeCycle(cfg, k, rpm, adv, bc, state, probe).knockIntegral;

      knockRetard = 0;
      const limit = cfg.ignition.knockThreshold;
      if (knockAt(spark) > limit) {
        const floor = Math.max(spark - cfg.ignition.maxRetard, 1);
        if (knockAt(floor) > limit) {
          // Maksimum geri cekmeye ragmen vurunti var — motor bu noktada
          // guvenli calisamaz. Uyari asagida uretilir.
          knockRetard = spark - floor;
          spark = floor;
        } else {
          let lo = floor, hi = spark;
          for (let it = 0; it < 7; it++) {
            const mid = (lo + hi) / 2;
            if (knockAt(mid) > limit) hi = mid; else lo = mid;
          }
          knockRetard = spark - lo;
          spark = lo;
        }
      }
    }

    // 3) Cevrimi periyodiklige yakinsat
    cycle = convergeCycle(cfg, k, rpm, spark, bc, state, o);
    state = cycle.endState;

    // 4) Turetilmis buyukluklerle sinir kosullarini guncelle.
    //    Karsi basinc ve kompresor yuku, supaptan GECEN brut debiye
    //    baglidir (hapsedilen kismina degil).
    const newMaf = (cycle.grossAirThroughput * nCyl * rpm) / (2 * 60);
    const newWalls = wallTemperatures(cfg.mechanical, cycle.meanHeatFlux);
    const newEgt = exhaustGasTemperature(
      cycle.tempAtEVO, cycle.pressureAtEVO, backpressure, 1.33, 0.18,
    );

    const converged =
      Math.abs(newMaf - maf) / Math.max(newMaf, 1e-9) < 5e-3 &&
      Math.abs(newEgt - egt) / Math.max(newEgt, 1) < 5e-3;

    // Yumusatilmis guncelleme — salinimi onler.
    // Basinc kesme kontrolunden ONCE yapilir: aksi halde kesme adiminda
    // "continue" edildiginde sinir kosullari hic guncellenmez ve dongu
    // hicbir zaman yakinsamaz.
    maf = maf + 0.6 * (newMaf - maf);
    egt = egt + 0.6 * (newEgt - egt);
    walls = newWalls;

    // --- Ikinci koz: basinc kesme ---
    //
    // Atesleme geri cekme yetkisi tukendigi HALDE vurunti devam ediyorsa
    // wastegate acilir. "Yetki tukendi" iki turlu olur: ya izin verilen
    // maksimum rotara ulasildi, ya da avans fiziksel tabana (1° BTDC)
    // dayandi — hizli yanan motorlarda ikincisi once gelir.
    const knockUncontrolled =
      cycle.knockIntegral > cfg.ignition.knockThreshold * 1.02 &&
      (knockRetard >= cfg.ignition.maxRetard - 0.5 || spark <= 1.5);
    if (
      cfg.induction.type !== 'NA' &&
      knockUncontrolled &&
      boostTrim > 0.36 &&
      map > ambient.pressure * 1.02
    ) {
      boostTrim = Math.max(boostTrim - 0.08, 0.35);
      needIgnitionResearch = true;
      continue; // basinc degisti; sinir kosullari bastan otursun
    }

    if (converged && outer >= 2) break;
  }

  if (!cycle) throw new Error('Cevrim cozulemedi');

  // --- Son cevrimi iz ile tekrar cozup ciktilari uret ---
  const finalBC: BoundaryConditions = {
    intakePressure: map,
    intakeTemp: chargeTemp,
    exhaustPressure: backpressure,
    exhaustTemp: egt,
    walls,
    crankcasePressure: ambient.pressure * 0.98,
    intakeRamFactor: tuningVEMultiplier(rpm, tunedRpm, 0.12),
    combustionEfficiencyFactor: thermal.combustionEfficiencyMultiplier,
    lambda: lambdaActual,
    scavengePressureFactor: Math.pow(1 / manifold.scavenging, 0.35),
  };

  // Nihai vurunti duzeltmesi.
  //
  // Atesleme aramasi, sinir kosullari henuz tam oturmadan yapilir; dis
  // dongu ilerledikce MAP, EGT ve cidar sicakliklari biraz daha kayar.
  // Bu kucuk kayma vurunti integralini esigin uzerine tasiyabilir ve
  // raporda "sinirlanmis olmasina ragmen %109 vurunti riski" gibi kendi
  // icinde celiskili bir sonuc dogurur. Burada NIHAI kosullarla son bir
  // kez kontrol edip gerekirse avansi kirpiyoruz.
  {
    // MUTLAK AVANS TABANI.
    //
    // Bu taban olmadan dongu avansi TDC'nin otesine, negatif degerlere
    // itebiliyordu (olculdu: B58'de −3.8°, yani ust olu noktadan SONRA
    // atesleme). Benzinli bir motor tam gazda boyle calismaz; ECU
    // vuruntuyu bastiramasa bile ateslemeyi TDC sonrasina goturmez,
    // basinci keser veya yakiti zenginlestirir.
    //
    // Ikili arama zaten bu tabani kullaniyordu (floor = max(spark −
    // maxRetard, 1)); son duzeltme dongusu onu tanimadigi icin 12 × 0.4°
    // daha asagi inebiliyordu.
    const SPARK_FLOOR = 1;
    let guard = 0;
    while (
      cycle.knockIntegral > cfg.ignition.knockThreshold &&
      knockRetard < cfg.ignition.maxRetard &&
      spark > SPARK_FLOOR &&
      guard++ < 12
    ) {
      const next = Math.max(spark - 0.4, SPARK_FLOOR);
      knockRetard += spark - next;
      spark = next;
      cycle = convergeCycle(cfg, k, rpm, spark, finalBC, state, o);
    }
  }

  if (o.keepTrace) {
    cycle = integrateCycle(cfg, k, rpm, spark, finalBC, state, { ...o, keepTrace: true });
  }

  // ============ TURETILMIS BUYUKLUKLER ============

  // --- Hacimsel verim ---
  //
  // Referans olarak MANIFOLD kosullari alinir (ortam degil). Boylece VE,
  // "silindir ne kadar iyi doldu" sorusunun cevabi olur ve hem NA hem
  // turbo motorda 0.80-1.05 bandinda anlamli kalir. Ortam referansi
  // kullanilsaydi turbo motorda VE %170 cikardi ve dolum kalitesi
  // hakkinda hicbir sey soylemezdi.
  //
  // Referans, KURU manifold kosuludur (IAT sensorunun gordugu): basinc
  // MAP, sicaklik yakit eklenmeden onceki IAT. Sektor tanimi budur.
  //
  // Yakit buharlasmasinin sogutmasi paydaya konmaz; boylece port
  // enjeksiyonun sagladigi kucuk VE kazanci sonucta GORUNUR kalir.
  // Sogutmayi hem simulasyona hem referansa uygulamak onu gorunmez yapardi.
  const manifoldDensity = chargeDensity(map, iat, cfg.ambient.humidity);
  const ve = cycle.trappedAirMass / (k.sweptVolume * manifoldDensity);

  // MAF sensorunun gorecegi debi: supaptan GECEN brut hava
  const massAirFlow = (cycle.grossAirThroughput * nCyl * rpm) / (2 * 60);
  // Yakit ise silindirde KALAN havaya gore olculur — kacip giden hava
  // yanmaya katilmaz.
  const trappedAirFlow = (cycle.trappedAirMass * nCyl * rpm) / (2 * 60);
  // Raporlanan lambda, HEDEF degil GERCEKLESEN degerdir — pompa
  // yetersiz kaldiginda ikisi ayrisir ve fark burada gorunur.
  const lambda = lambdaActual;
  const afr = cfg.fuel.afrStoich * lambda;
  const fuelFlow = trappedAirFlow / afr;

  // --- Ortalama efektif basinclar ---
  const imepGross = cycle.indicatedWorkGross / k.sweptVolume;
  const pmep = cycle.pumpingWork / k.sweptVolume;
  const imepNet = cycle.indicatedWorkNet / k.sweptVolume;

  const Sp = meanPistonSpeed(cfg.geometry.stroke, rpm);

  // --- Yaglama sistemi ---
  // Yag basinci pompa debisi ile yatak sizintisinin dengelendigi
  // noktada olusur; yatak boslugunun kubuyle ters orantilidir.
  const lube = solveLubrication(cfg, rpm, cycle.peakRodForce);

  const friction: FrictionBreakdown = frictionBreakdown(
    cfg, k, rpm, cycle.peakPressure, Sp, cycle.peakSideForce,
    lube.pressure, lube.pumpFlow, superchargerPower,
  );
  const fmep = friction.total;
  const bmep = imepNet - fmep;

  const torque = (bmep * totalDisp) / (4 * Math.PI);
  const power = (torque * rpm * 2 * Math.PI) / 60;
  const indicatedPower = (imepNet * totalDisp * rpm) / (2 * 60);
  const fricPower = frictionPower(fmep, totalDisp, rpm);

  // --- Verimler ---
  const fuelPower = fuelFlow * cfg.fuel.lhv;
  const thermalEff = fuelPower > 0 ? power / fuelPower : 0;
  const mechEff = indicatedPower > 0 ? power / indicatedPower : 0;
  const bsfc = power > 0 ? fuelFlow / power : 0;

  // --- Yakit besleme dengesi ---
  // Pompa debisi basincla duser; turbo motorda ray basinci manifold
  // basinciyla yukseldigi icin pompa cift taraflı zorlanir.
  const railGauge = cfg.fuelSystem.railPressure +
    (cfg.induction.type !== 'NA' ? Math.max(map - ambient.pressure, 0) : 0);
  const supply = solveFuelSupply(
    cfg.fuel, cfg.fuelSystem.fuelTemp, fuelFlow, railGauge,
    cfg.fuelSystem.pumpFlowLPH, cfg.fuelSystem.injectorRefPressure,
    cfg.fuelSystem.pumpDeadheadPressure,
  );

  // --- Enjektor ---
  // Enjektor SABIT HACIM olcer; sicak yakitin yogunlugu dustugu icin
  // ayni darbe genisligi daha az KUTLE verir.
  const fuelDensity = fuelDensityAt(cfg.fuel, cfg.fuelSystem.fuelTemp);
  const injectorFlowKgS =
    (cfg.fuelSystem.injectorFlowCC / 60 / 1e6) * fuelDensity *
    Math.sqrt(supply.actualRailPressure / cfg.fuelSystem.injectorRefPressure);
  const fuelPerCylPerCycle = fuelFlow / nCyl / (rpm / 2 / 60);
  const openTime = fuelPerCylPerCycle /
    Math.max(injectorFlowKgS * cfg.fuelSystem.injectorsPerCyl, 1e-12);
  const deadtime = injectorDeadtime(cfg.fuelSystem.injectorDeadtime, cfg.fuelSystem.batteryVoltage);
  const pulseWidth = openTime + deadtime;
  const cycleTime = 120 / rpm;
  const dutyCycle = pulseWidth / cycleTime;

  // Buhar kilidi: kritik nokta ray degil, pompanin EMME tarafidir
  const vaporMargin = vaporLockMargin(
    cfg.fuel, cfg.fuelSystem.fuelTemp, ambient.pressure * 0.92,
  );
  const smd = sauterMeanDiameter(
    cfg.fuel, cfg.fuelSystem.fuelTemp,
    cfg.fuelSystem.injection === 'DIRECT' ? railGauge * 40 : railGauge,
    chargeDensity(map, iat, ambient.humidity),
  );

  // --- Turbin durumu ---
  const turbine = cfg.induction.type === 'TURBO'
    ? solveTurbine(
        massAirFlow, egt, backpressure, ambient.pressure,
        compressor?.power ?? 0, manifold,
      )
    : null;

  // --- Supap yuzmesi ---
  const floatRpm = valveFloatThreshold(
    cfg.valvetrain.intakeCam,
    cfg.valvetrain.springOpenPressure,
    cfg.valvetrain.valvetrainMass,
  );

  // --- Supurme / hapsetme verimi ---
  // Cozucu artik gazi zaten kutle muhasebesinden buluyor, dolayisiyla
  // ampirik bir supurme korelasyonuna gerek yok: taze dolgu orani
  // dogrudan (1 − artik gaz fraksiyonu)'dur.
  const scavEff = clamp(1 - cycle.residualFraction, 0, 1);

  const dcr = dynamicCompressionRatio(k, ivcCycleAngle(cfg.valvetrain) - 720);

  // ============ UYARILAR ============
  //
  // VURUNTI RISKI — ne olctugu onemli.
  //
  // Onceki tanim (integral / esik) yaniltiyordu: cozucu avansi ikili
  // aramayla TAM esige oturttugu icin, vuruntu sinirinda calisan HER
  // motor tanimi geregi 1.00 gosteriyordu. Yani dogru sekilde rotar
  // uygulanmis, tamamen saglikli bir fabrika motoru "vurunti tehlikesi"
  // uyarisi veriyordu. Fabrika avansi zaten vurunti sinirinda secilir;
  // tam gazda dusuk devirde birkac derece avans cekmek her uretim
  // motorunun normal davranisidir, ariza degildir.
  //
  // Yeni tanim, motorun vuruntuya karsi ELINDEKI SAVUNMA PAYININ ne
  // kadarini tukettigini olcer:
  //
  //   0.00        MBT'de, sinirlama yok, integral esigin cok altinda
  //   0.50        Tam kalibrasyon sinirinda (fabrika motoru icin NORMAL)
  //   0.50-1.00   Sinirli; rotar yetkisinin bu kadarlik kismi tukendi
  //   > 1.00      Yetki bitti, hala esigin ustunde — GERCEK detonasyon
  //
  // Boylece "vurunti sinirlayicisi calisiyor" (normal) ile "vurunti
  // kontrol edilemiyor" (tehlike) birbirinden ayrilir. Sinirin iki
  // yaninda deger sureklidir: sinirlanmamis motor esige yaklastikca
  // 0.50'ye cikar, yeni sinirlanmis motor da 0.50'den baslar.
  const knockProximity = cycle.knockIntegral / Math.max(cfg.ignition.knockThreshold, 1e-6);
  const retardAuthority = cfg.ignition.maxRetard > 0.1
    ? clamp(knockRetard / cfg.ignition.maxRetard, 0, 1)
    : 0;
  // Rotar yetkisi tukendigi halde integral hala esigin ustundeyse asim
  const knockOvershoot = Math.max(knockProximity - 1, 0);
  const knockRisk = clamp(
    knockRetard > 0.05
      ? Math.max(retardAuthority, 0.5) + knockOvershoot
      : 0.5 * clamp(knockProximity, 0, 1),
    0, 1.5,
  );
  if (knockRisk > 0.95) {
    warnings.push({ severity: 'danger', key: 'knockImminent', params: { rpm } });
  } else if (knockRisk > 0.7) {
    warnings.push({ severity: 'caution', key: 'knockRisk', params: { rpm } });
  }
  if (knockRetard > 0.05) {
    warnings.push({
      severity: 'caution', key: 'knockRetardApplied',
      params: { deg: knockRetard.toFixed(1) },
    });
  }
  if (rpm > floatRpm) {
    warnings.push({ severity: 'danger', key: 'valveFloat', params: { rpm: Math.round(floatRpm) } });
  } else if (rpm > floatRpm * 0.93) {
    warnings.push({ severity: 'caution', key: 'valveFloatNear', params: { rpm: Math.round(floatRpm) } });
  }
  if (Sp > 25) {
    warnings.push({ severity: 'danger', key: 'pistonSpeedCritical', params: { speed: Sp.toFixed(1) } });
  } else if (Sp > 21) {
    warnings.push({ severity: 'caution', key: 'pistonSpeedHigh', params: { speed: Sp.toFixed(1) } });
  }
  if (dutyCycle > 0.90) {
    warnings.push({ severity: 'danger', key: 'injectorMaxed', params: { duty: (dutyCycle * 100).toFixed(0) } });
  } else if (dutyCycle > 0.80) {
    warnings.push({ severity: 'caution', key: 'injectorHigh', params: { duty: (dutyCycle * 100).toFixed(0) } });
  }
  const egtC = egt - 273.15;
  if (egtC > 950) {
    warnings.push({ severity: 'danger', key: 'egtCritical', params: { egt: egtC.toFixed(0) } });
  } else if (egtC > 870) {
    warnings.push({ severity: 'caution', key: 'egtHigh', params: { egt: egtC.toFixed(0) } });
  }
  const bearing = bearingLoadAssessment(cycle.peakRodForce, cfg.mechanical.rodBearingDia);
  if (bearing.severity === 'critical') {
    warnings.push({ severity: 'danger', key: 'bearingLoadCritical',
      params: { mpa: (bearing.projectedPressure / 1e6).toFixed(0) } });
  } else if (bearing.severity === 'high') {
    warnings.push({ severity: 'caution', key: 'bearingLoadHigh',
      params: { mpa: (bearing.projectedPressure / 1e6).toFixed(0) } });
  }
  const oil = oilCondition(cfg.mechanical.oilTemp);
  if (oil === 'breakdown') warnings.push({ severity: 'danger', key: 'oilBreakdown' });
  else if (oil === 'hot') warnings.push({ severity: 'caution', key: 'oilHot' });

  // --- Yaglama uyarilari ---
  const oilVerdict = oilPressureVerdict(lube.pressure, rpm);
  if (oilVerdict === 'critical') {
    warnings.push({ severity: 'danger', key: 'oilPressureCritical',
      params: { bar: (lube.pressure / 1e5).toFixed(1) } });
  } else if (oilVerdict === 'low') {
    warnings.push({ severity: 'caution', key: 'oilPressureLow',
      params: { bar: (lube.pressure / 1e5).toFixed(1) } });
  }
  if (lube.wearIndex > 0.75) {
    warnings.push({ severity: 'danger', key: 'boundaryLubrication',
      params: { um: (lube.minFilm * 1e6).toFixed(2) } });
  } else if (lube.wearIndex > 0.4) {
    warnings.push({ severity: 'caution', key: 'mixedLubrication',
      params: { um: (lube.minFilm * 1e6).toFixed(2) } });
  }

  // --- Yakit sistemi uyarilari ---
  if (supply.headroom < 0) {
    warnings.push({ severity: 'danger', key: 'fuelPumpMaxed',
      params: { lph: supply.demandLPH.toFixed(0) } });
  } else if (supply.headroom < 0.12) {
    warnings.push({ severity: 'caution', key: 'fuelPumpMargin',
      params: { pct: (supply.headroom * 100).toFixed(0) } });
  }
  if (vaporMargin < 0) {
    warnings.push({ severity: 'danger', key: 'vaporLock',
      params: { temp: (cfg.fuelSystem.fuelTemp - 273.15).toFixed(0) } });
  } else if (vaporMargin < 15000) {
    warnings.push({ severity: 'caution', key: 'vaporLockNear',
      params: { temp: (cfg.fuelSystem.fuelTemp - 273.15).toFixed(0) } });
  }

  // --- Turbo uyarilari ---
  if (compressor) {
    if (compressor.surgeMargin > 0.25) {
      warnings.push({ severity: 'danger', key: 'compressorSurge' });
    } else if (compressor.surgeMargin > 0.05) {
      warnings.push({ severity: 'caution', key: 'compressorSurgeNear' });
    }
    if (compressor.chokeMargin > 0.2) {
      warnings.push({ severity: 'caution', key: 'compressorChoke' });
    }
    const tip = tipSpeedVerdict(compressor.tipSpeed);
    if (tip === 'critical') {
      warnings.push({ severity: 'danger', key: 'tipSpeedCritical',
        params: { speed: compressor.tipSpeed.toFixed(0) } });
    } else if (tip === 'high') {
      warnings.push({ severity: 'caution', key: 'tipSpeedHigh',
        params: { speed: compressor.tipSpeed.toFixed(0) } });
    }
    if (compressor.efficiency < 0.60) {
      warnings.push({ severity: 'caution', key: 'compressorOffMap',
        params: { eff: (compressor.efficiency * 100).toFixed(0) } });
    }
  }
  if (turbine) {
    if (turbine.thermalStress > 1.0) {
      warnings.push({ severity: 'danger', key: 'turbineTempCritical',
        params: { temp: (turbine.inletTemp - 273.15).toFixed(0) } });
    } else if (turbine.thermalStress > 0.92) {
      warnings.push({ severity: 'caution', key: 'turbineTempHigh',
        params: { temp: (turbine.inletTemp - 273.15).toFixed(0) } });
    }
    // Turbin oncesi basincin manifold basincini asmasi pompalama
    // kaybini buyutur ve artik gazi artirir
    if (backpressure > map * 1.6) {
      warnings.push({ severity: 'caution', key: 'backpressureHigh',
        params: { ratio: (backpressure / map).toFixed(2) } });
    }
  }

  // --- Termal durum uyarilari ---
  if (thermal.status === 'cold') {
    warnings.push({ severity: 'info', key: 'engineCold',
      params: { temp: (cfg.mechanical.coolantTemp - 273.15).toFixed(0) } });
  } else if (thermal.status === 'warming') {
    warnings.push({ severity: 'info', key: 'engineWarming',
      params: { temp: (cfg.mechanical.coolantTemp - 273.15).toFixed(0) } });
  } else if (thermal.status === 'overheat') {
    warnings.push({ severity: 'danger', key: 'engineOverheat',
      params: { temp: (cfg.mechanical.coolantTemp - 273.15).toFixed(0) } });
  }

  // --- Ortam uyarilari ---
  if (ambient.altitude > 1200 && ambient.useAltitude) {
    warnings.push({ severity: 'info', key: 'altitudeEffect',
      params: {
        alt: ambient.altitude.toFixed(0),
        pct: ((1 - densityFactor) * 100).toFixed(0),
      } });
  }
  if (oxyFactor < 0.965) {
    warnings.push({ severity: 'info', key: 'humidityEffect',
      params: { pct: ((1 - oxyFactor) * 100).toFixed(1) } });
  }
  if (cycle.peakPressureAngle > 20 || cycle.peakPressureAngle < 8) {
    warnings.push({ severity: 'info', key: 'peakPressureAngle',
      params: { deg: cycle.peakPressureAngle.toFixed(1) } });
  }

  return {
    rpm,
    map, iat, chargeTemp,
    volumetricEfficiency: ve,
    airMassPerCycle: cycle.trappedAirMass,
    massAirFlow,
    fuelFlow,
    afr, lambda,
    sparkAdvance: spark,
    mbtAdvance,
    knockRetard,
    knockRisk,
    endGasTemp: cycle.peakEndGasTemp,
    knockBoostCut: (cfg.induction.targetBoost * (1 - boostTrim)) / 1e5,
    imep: imepNet,
    bmep,
    fmep,
    pmep,
    torque,
    power,
    indicatedPower,
    frictionPower: fricPower,
    peakPressure: cycle.peakPressure,
    peakPressureAngle: cycle.peakPressureAngle,
    peakTemperature: cycle.peakTemperature,
    egt,
    chamberWallTemp: walls.head,
    thermalEfficiency: thermalEff,
    mechanicalEfficiency: mechEff,
    bsfc,
    residualFraction: cycle.residualFraction,
    meanPistonSpeed: Sp,
    peakPistonSpeed: cycle.peakPistonSpeed,
    injectorDutyCycle: dutyCycle,
    injectorPulseWidth: pulseWidth,
    dynamicCompressionRatio: dcr,
    ignitionDelay: cycle.ignitionDelay,
    burnDuration: cycle.burnDuration,
    flameSpeed: cycle.flameSpeed,
    valveFloat: rpm > floatRpm,
    peakBearingLoad: Math.abs(cycle.peakRodForce),
    peakSideForce: Math.abs(cycle.peakSideForce),
    exhaustBackpressure: backpressure,
    scavengingEfficiency: scavEff,
    trace: cycle.trace,
    warnings,
    imepGross,
    friction,
    intakeTunedRpm: tunedRpm,

    // Yaglama
    oilPressure: lube.pressure,
    minOilFilm: lube.minFilm,
    wearIndex: lube.wearIndex,

    // Yakit sistemi
    fuelDemandLPH: supply.demandLPH,
    fuelSupplyLPH: supply.supplyLPH,
    fuelHeadroom: supply.headroom,
    vaporLockMargin: vaporMargin,
    sauterMeanDiameter: smd,

    // Turbo
    compressorEfficiency: compressor?.efficiency ?? 0,
    compressorTipSpeed: compressor?.tipSpeed ?? 0,
    turboRpm: compressor?.shaftRpm ?? 0,
    surgeMargin: compressor?.surgeMargin ?? 0,
    turbinePressure: turbine?.inletPressure ?? backpressure,
    turbineInletTemp: turbine?.inletTemp ?? egt,
    turboHeatLoad: turbine?.bearingHeat ?? 0,

    // Termal / ortam
    warmupFactor: thermal.warmup,
    oxygenFactor: oxyFactor,
    densityAltitudeFactor: densityFactor,
    combustionEfficiency: cycle.combustionEfficiency,
    // Cevrim basina cidar isisi → guc (tum silindirler)
    wallHeatPower: (cycle.wallHeat * nCyl * rpm) / (2 * 60),
  };
}

/** Cevrimi periyodik hale gelene kadar tekrarlar (artik gaz yakinsamasi) */
function convergeCycle(
  cfg: EngineConfig,
  k: CrankKinematics,
  rpm: number,
  spark: number,
  bc: BoundaryConditions,
  start: CycleState,
  o: SolverOptions,
): CycleResult {
  let state = start;
  let result = integrateCycle(cfg, k, rpm, spark, bc, state, { ...o, keepTrace: false });
  for (let i = 1; i < o.maxIterations; i++) {
    const prevMass = state.mass;
    const prevTemp = state.temperature;
    state = result.endState;
    const dM = Math.abs(state.mass - prevMass) / Math.max(state.mass, 1e-12);
    const dT = Math.abs(state.temperature - prevTemp) / Math.max(state.temperature, 1);
    if (dM < o.tolerance && dT < o.tolerance) break;
    result = integrateCycle(cfg, k, rpm, spark, bc, state, { ...o, keepTrace: false });
  }
  return result;
}

/**
 * MBT (Maximum Brake Torque) ateslemesini arar.
 *
 * Fiziksel beklenti: tepe silindir basinci TDC'den 12-16° SONRA olusmali.
 * Cok erken atesleme sikistirmaya karsi is yapar (ve vurunti getirir),
 * cok gec atesleme genisleme isini kacirir. Kaba tarama + ince arama.
 */
function findMBT(
  cfg: EngineConfig,
  k: CrankKinematics,
  rpm: number,
  bc: BoundaryConditions,
  start: CycleState,
  o: SolverOptions,
): number {
  const fast: SolverOptions = { ...o, step: Math.max(o.step, 1.0), maxIterations: 3, keepTrace: false };
  const work = (adv: number) => convergeCycle(cfg, k, rpm, adv, bc, start, fast).indicatedWorkNet;

  // Kaba tarama — is/avans egrisi tek tepelidir, bu yuzden 7 nokta yeter
  let bestAdv = 22, bestWork = -Infinity;
  for (let adv = 6; adv <= 48; adv += 7) {
    const w = work(adv);
    if (w > bestWork) { bestWork = w; bestAdv = adv; }
  }
  // Tepenin etrafinda ince arama
  for (const d of [-4.5, -2.5, 2.5, 4.5]) {
    const adv = bestAdv + d;
    if (adv < 1 || adv > 55) continue;
    const w = work(adv);
    if (w > bestWork) { bestWork = w; bestAdv = adv; }
  }
  for (const d of [-1.2, 1.2]) {
    const adv = bestAdv + d;
    if (adv < 1 || adv > 55) continue;
    const w = work(adv);
    if (w > bestWork) { bestWork = w; bestAdv = adv; }
  }
  return clamp(bestAdv, 1, 55);
}

/**
 * Enjektor olu zamani — besleme voltajina bagli.
 * 13.8V referansta verilen deger, 12V'ta belirgin uzar. Marsta veya
 * zayif aku ile karisimin fakirlesmesinin sebebi budur.
 */
export function injectorDeadtime(baseDeadtime: number, voltage: number): number {
  const v = clamp(voltage, 8, 16);
  return baseDeadtime * Math.pow(13.8 / v, 1.35);
}

/** Bir noktanin krank izini (P-V, basinc egrisi) uretir */
export function traceOperatingPoint(cfg: EngineConfig, rpm: number): OperatingPoint {
  return solveOperatingPoint(cfg, rpm, { keepTrace: true, step: 0.25 });
}

export { makeKinematics, cylinderVolume };
