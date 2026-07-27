/** Canli su ısisi ve yag basinci gercekten degisiyor mu */
import { buildTorqueMap, lookupTorque, lookupPoint } from '../src/core/sweep';
import { getPreset } from '../src/core/presets';
import { vehicleFor, initialVehicleState, stepVehicle } from '../src/core/drivetrain';
import { initialDriverState, stepDriver } from '../src/core/driverModel';
import { coolingSpecFor, stepThermal, livePressure } from '../src/core/coolingSystem';
import { leakConductanceRef, pumpCoefficientFor } from '../src/core/lubrication';
import { cylinderCount } from '../src/core/geometry';

const cfg = getPreset('2jz-gte');
const v = vehicleFor('2jz-gte');
const map = buildTorqueMap(cfg);
const RAD = 9.5493;
const dispL = (Math.PI/4)*cfg.geometry.bore**2*cfg.geometry.stroke*cylinderCount(cfg.layout)*1000;
const cool = coolingSpecFor(dispL);
const cond = leakConductanceRef(cfg), pumpK = pumpCoefficientFor(cfg);
let pass=0, fail=0;
const ok=(n:string,c:boolean,d='')=>{if(c){pass++;console.log(`  OK   ${n}`)}else{fail++;console.log(`  FAIL ${n} ${d}`)}};

function run(seconds:number, throttle:boolean, startCoolantC:number, gear=3, speedKmh=0) {
  const s = initialVehicleState(cfg.idleRpm);
  s.speed = speedKmh/3.6; s.wheelOmega = s.speed/v.wheelRadius;
  const d = initialDriverState(); d.gear = gear;
  const th = { coolant: startCoolantC+273.15, oil: startCoolantC+273.15 };
  const samples: {t:number;cool:number;oil:number;bar:number;rpm:number}[] = [];
  const dt = 0.02;
  for (let t=0;t<seconds;t+=dt){
    const inputRpm = Math.abs(s.wheelOmega*v.gearRatios[d.gear-1]*v.finalDrive)*RAD;
    stepDriver(d,{autoClutch:true,idleRpm:cfg.idleRpm,maxGear:6,startDelay:0.9},
      {throttle,brake:false,clutch:false,handbrake:false,starter:false},
      s.engineOmega*RAD,inputRpm,s.running,dt);
    const r = stepVehicle(s,v,{throttle:d.throttle,brake:d.brake,clutch:d.clutch,
      handbrake:d.handbrake,gear:d.gear},(rp,tt)=>lookupTorque(map,rp,tt),
      map.inertia,cfg.idleRpm,cfg.redline,dt);
    const pt = lookupPoint(map,r.rpm);
    const fuelPower = r.state.running
      ? Math.max(pt.power,0)/Math.max(pt.thermalEfficiency,0.05)*(d.throttle*0.85+0.15) : 0;
    stepThermal(th,cool,fuelPower,pt.frictionPower,r.state.speed,cfg.ambient.temperature,r.state.running,dt);
    const bar = livePressure(r.rpm,th.oil,cfg.mechanical.oilGrade,cond,pumpK,
      cfg.mechanical.oilPumpCapacity,cfg.mechanical.oilReliefPressure,r.state.running)/1e5;
    if (Math.abs(t%20)<dt) samples.push({t,cool:th.coolant-273.15,oil:th.oil-273.15,bar,rpm:r.rpm});
  }
  return {th, samples};
}

console.log('=== SOGUK MOTOR ISINMASI (rolanti, 3 dk) ===');
{
  const {th,samples} = run(180,false,20,0);
  samples.forEach(x=>console.log(`  ${x.t.toFixed(0).padStart(3)}s  su ${x.cool.toFixed(1).padStart(5)}C  yag ${x.oil.toFixed(1).padStart(5)}C  ${x.bar.toFixed(2)} bar`));
  ok('Su ısısı yükseliyor', th.coolant-273.15 > 33, `${(th.coolant-273.15).toFixed(1)}C`);
  ok('Rölantide ısınma YAVAŞ (gerçekçi)', th.coolant-273.15 < 60, `${(th.coolant-273.15).toFixed(1)}C`);
  // Surusle isinma rolantiden belirgin HIZLI olmali
  const driven = run(180,true,20,3,90).th;
  console.log(`  sürüşle 180s sonra: su ${(driven.coolant-273.15).toFixed(1)}C`);
  ok('Sürüşte çok daha hızlı ısınır', driven.coolant > th.coolant + 15,
    `rölanti ${(th.coolant-273.15).toFixed(0)}C vs sürüş ${(driven.coolant-273.15).toFixed(0)}C`);
}

console.log('\n=== TAM GAZ YUK (sicak motor, 40 s) ===');
{
  const a = run(1,true,90,3,120).th;
  const b = run(40,true,90,3,120).th;
  console.log(`  1s: su ${(a.coolant-273.15).toFixed(1)}C yag ${(a.oil-273.15).toFixed(1)}C`);
  console.log(`  40s: su ${(b.coolant-273.15).toFixed(1)}C yag ${(b.oil-273.15).toFixed(1)}C`);
  ok('Yuk altinda su ısinir', b.coolant > a.coolant, `${(a.coolant-273.15).toFixed(1)} → ${(b.coolant-273.15).toFixed(1)}`);
  ok('Radyatör yükü karşılıyor (kaynamıyor)', b.coolant-273.15 < 108, `${(b.coolant-273.15).toFixed(1)}C`);
  ok('Yag suyla birlikte isinir', b.oil > a.oil);
}

console.log('\n=== YAG BASINCI SICAKLIKLA DEGISIYOR MU ===');
{
  for (const oc of [40, 90, 120]) {
    const p3000 = livePressure(3000, oc+273.15, cfg.mechanical.oilGrade, cond, pumpK, 1, cfg.mechanical.oilReliefPressure)/1e5;
    const p800  = livePressure(800,  oc+273.15, cfg.mechanical.oilGrade, cond, pumpK, 1, cfg.mechanical.oilReliefPressure)/1e5;
    console.log(`  yag ${String(oc).padStart(3)}C → rolanti ${p800.toFixed(2)} bar, 3000rpm ${p3000.toFixed(2)} bar`);
  }
  const cold = livePressure(800, 313.15, cfg.mechanical.oilGrade, cond, pumpK, 1, cfg.mechanical.oilReliefPressure);
  const hot  = livePressure(800, 393.15, cfg.mechanical.oilGrade, cond, pumpK, 1, cfg.mechanical.oilReliefPressure);
  ok('Sıcak yağda basınç düşer', hot < cold*0.6, `${(cold/1e5).toFixed(2)} → ${(hot/1e5).toFixed(2)} bar`);
  ok('Motor dururken basınç sıfır',
    livePressure(0,373.15,cfg.mechanical.oilGrade,cond,pumpK,1,5e5,false) === 0);
}

console.log(`\n${'='.repeat(46)}\nSONUC: ${pass} basarili, ${fail} basarisiz`);
if (fail) process.exit(1);
