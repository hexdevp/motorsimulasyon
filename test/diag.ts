/**
 * Teshis: tek bir calisma noktasinda cevrimin ic durumunu dok.
 * Calistir: npx tsx test/diag.ts
 */
import { solveOperatingPoint } from '../src/core/cycle';
import { getPreset } from '../src/core/presets';
import { makeKinematics, cylinderVolume, meanPistonSpeed } from '../src/core/geometry';
import { ivcCycleAngle, ivcABDC, valveOverlap, intakeLift, exhaustLift } from '../src/core/valve';
import { chargeDensity, intakeTunedRpm, tuningVEMultiplier } from '../src/core/induction';
import {
  laminarFlameSpeed, turbulenceIntensity, turbulentFlameSpeed, burnDurations,
} from '../src/core/combustion';

function diag(id: string, rpm: number) {
  const cfg = getPreset(id);
  const k = makeKinematics(cfg.geometry);
  const p = solveOperatingPoint(cfg, rpm, { keepTrace: true, step: 0.25 });
  const tr = p.trace!;

  console.log(`\n########## ${cfg.name} @ ${rpm} rpm ##########`);

  // --- Supap zamanlamasi ---
  const ivcSolver = ivcCycleAngle(cfg.valvetrain) - 720;
  console.log(`\n[SUPAP]`);
  console.log(`  IVC              : ${ivcABDC(cfg.valvetrain).toFixed(1)} ABDC  (cozucu acisi ${ivcSolver.toFixed(1)})`);
  console.log(`  Bindirme         : ${valveOverlap(cfg.valvetrain).toFixed(1)} krank derece`);
  console.log(`  V(IVC)/Vd        : ${(cylinderVolume(k, ivcSolver) / k.sweptVolume).toFixed(4)}`);

  // --- IVC durumu ---
  let iIVC = 0;
  for (let i = 0; i < tr.theta.length; i++) if (tr.theta[i] <= ivcSolver) iIVC = i;
  const pIVC = tr.pressure[iIVC], TIVC = tr.temperature[iIVC], mIVC = tr.mass[iIVC];
  const vIVC = tr.volume[iIVC];
  const rhoIVC = mIVC / vIVC;
  const rhoMan = chargeDensity(p.map, p.iat, cfg.ambient.humidity);

  // Emme stroku boyunca durum
  const at = (target: number) => {
    let idx = 0;
    for (let i = 0; i < tr.theta.length; i++) if (tr.theta[i] <= target) idx = i;
    return idx;
  };
  console.log(`\n[EMME STROKU BOYUNCA]`);
  console.log(`  aci      p(bar)   T(K)    m(mg)   emmeAkis(kg/s)`);
  for (const th of [-360, -320, -280, -240, -200, -180, -160, -140, -120, ivcSolver]) {
    const i = at(th);
    console.log(
      `  ${th.toFixed(0).padStart(5)}  ${(tr.pressure[i] / 1e5).toFixed(3).padStart(7)}` +
      `  ${tr.temperature[i].toFixed(1).padStart(6)}  ${(tr.mass[i] * 1e6).toFixed(1).padStart(7)}` +
      `  ${tr.intakeFlow[i].toFixed(4).padStart(8)}`,
    );
  }

  console.log(`\n[IVC DURUMU]`);
  console.log(`  MAP              : ${(p.map / 1e5).toFixed(3)} bar`);
  console.log(`  IAT (manifold)   : ${(p.iat - 273.15).toFixed(1)} C = ${p.iat.toFixed(1)} K`);
  console.log(`  Dolgu sicakligi  : ${p.chargeTemp.toFixed(1)} K  (port isitmasi +${(p.chargeTemp - p.iat).toFixed(1)} K)`);
  console.log(`  p_IVC            : ${(pIVC / 1e5).toFixed(3)} bar   (p_IVC/MAP = ${(pIVC / p.map).toFixed(3)})`);
  console.log(`  T_IVC            : ${TIVC.toFixed(1)} K`);
  console.log(`  m_IVC toplam     : ${(mIVC * 1e6).toFixed(2)} mg`);
  console.log(`  yogunluk_IVC     : ${rhoIVC.toFixed(4)} kg/m3`);
  console.log(`  yogunluk_manifold: ${rhoMan.toFixed(4)} kg/m3   (oran = ${(rhoIVC / rhoMan).toFixed(3)})`);
  console.log(`  hapsedilen taze  : ${(p.airMassPerCycle * 1e6).toFixed(2)} mg`);
  console.log(`  artik gaz frak.  : ${(p.residualFraction * 100).toFixed(1)} %`);
  console.log(`  VE (raporlanan)  : ${(p.volumetricEfficiency * 100).toFixed(1)} %`);
  console.log(`  -> beklenen VE   : ${((cylinderVolume(k, ivcSolver) / k.sweptVolume) * (rhoIVC / rhoMan) * (1 - p.residualFraction) * 100).toFixed(1)} %`);

  // --- Yanma ---
  const Sp = meanPistonSpeed(cfg.geometry.stroke, rpm);
  const uP = turbulenceIntensity(Sp, cfg.valvetrain.swirlRatio, cfg.valvetrain.tumbleRatio, cfg.geometry.squishAreaRatio);
  const pEst = p.map * Math.pow(cfg.geometry.compressionRatio, 1.32);
  const tEst = p.iat * Math.pow(cfg.geometry.compressionRatio, 0.32);
  const sL = laminarFlameSpeed(cfg.fuel, tEst, pEst, 1 / cfg.fuelSystem.targetLambda, p.residualFraction);
  const sT = turbulentFlameSpeed(sL, uP);
  const bd = burnDurations(sT, cfg.geometry.bore, rpm, 0.10);
  console.log(`\n[YANMA]`);
  console.log(`  Ort. piston hizi : ${Sp.toFixed(2)} m/s`);
  console.log(`  u' (turbulans)   : ${uP.toFixed(2)} m/s`);
  console.log(`  S_L (laminer)    : ${sL.toFixed(3)} m/s`);
  console.log(`  S_T (turbulansli): ${sT.toFixed(2)} m/s`);
  console.log(`  Gecikme (0-10%)  : ${bd.delay.toFixed(1)} derece`);
  console.log(`  Toplam Wiebe     : ${bd.total.toFixed(1)} derece`);
  console.log(`  Avans (MBT)      : ${p.mbtAdvance.toFixed(1)} BTDC`);
  console.log(`  Avans (kullanilan): ${p.sparkAdvance.toFixed(1)} BTDC  (knock cekmesi ${p.knockRetard.toFixed(1)})`);
  console.log(`  Pmax             : ${(p.peakPressure / 1e5).toFixed(1)} bar @ ${p.peakPressureAngle.toFixed(1)} ATDC`);

  // --- Emme ayari ---
  const tuned = intakeTunedRpm(cfg.induction, k.sweptVolume, cfg.geometry.compressionRatio, p.iat);
  console.log(`\n[EMME AYARI]`);
  console.log(`  Ayar devri       : ${tuned.toFixed(0)} rpm`);
  console.log(`  Ram carpani      : ${tuningVEMultiplier(rpm, tuned, 0.12).toFixed(3)}`);

  // --- Kutle akisi profili ---
  console.log(`\n[EMME OLAYI - kutle akisi]`);
  let netIn = 0, grossIn = 0, back = 0;
  const dt = 0.25 / (6 * rpm);
  for (let i = 0; i < tr.theta.length; i++) {
    if (tr.intakeFlow[i] > 0) grossIn += tr.intakeFlow[i] * dt;
    else back += -tr.intakeFlow[i] * dt;
    netIn += tr.intakeFlow[i] * dt;
  }
  console.log(`  Brut giris       : ${(grossIn * 1e6).toFixed(2)} mg`);
  console.log(`  Geri akis        : ${(back * 1e6).toFixed(2)} mg`);
  console.log(`  Net              : ${(netIn * 1e6).toFixed(2)} mg`);

  // Bindirme sirasinda egzoza kacan
  let blowthrough = 0;
  for (let i = 0; i < tr.theta.length; i++) {
    const th = tr.theta[i];
    if (intakeLift(th, cfg.valvetrain) > 0 && exhaustLift(th, cfg.valvetrain) > 0 && tr.exhaustFlow[i] > 0) {
      blowthrough += tr.exhaustFlow[i] * dt;
    }
  }
  console.log(`  Bindirmede egzoza: ${(blowthrough * 1e6).toFixed(2)} mg`);

  console.log(`\n[SONUC]  Tork ${p.torque.toFixed(1)} Nm | Guc ${(p.power / 745.7).toFixed(1)} HP | EGT ${(p.egt - 273.15).toFixed(0)} C | verim ${(p.thermalEfficiency * 100).toFixed(1)}%`);
}

diag('ls3', 3500);
diag('k20a', 6000);
