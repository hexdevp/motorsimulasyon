/**
 * Canli sogutma ve yaglama termal modeli
 *
 * Onceki surumde su sicakligi ve yag basinci KURULUM DEGERINDEN
 * okunuyordu; yani surus boyunca hic degismiyordu. Halbuki bunlar
 * surusun en cok hissedilen geri bildirimlerindendir:
 *
 *   soguk kalkis → hararet yavas yukselir, motor tok calisir
 *   uzun tam gaz → su isinir, yag incelir, YAG BASINCI DUSER
 *   yavaslama    → radyatore hava girer, hararet duser
 *
 * Model iki kutleli: motor blogu (su) ve yag karteri. Ikisi birbirine
 * isi verir, ikisi de disariya kaybeder.
 */

import { clamp } from './gas';
import { oilViscosity } from './friction';

export interface ThermalMass {
  /** Sogutma suyu sicakligi (K) */
  coolant: number;
  /** Yag sicakligi (K) */
  oil: number;
}

export interface CoolingSpec {
  /** Sogutma devresindeki su + blok esdeger isi kapasitesi (J/K) */
  coolantCapacity: number;
  /** Yag + karter esdeger isi kapasitesi (J/K) */
  oilCapacity: number;
  /**
   * Radyatorun isi transfer katsayisi (W/K), duran havada.
   * Arac hizlandikca hava debisi artar ve bu deger yukselir.
   */
  radiatorUA: number;
  /** Fan devrede oldugunda eklenen UA (W/K) */
  fanUA: number;
  /** Termostatin acilmaya basladigi sicaklik (K) */
  thermostatOpen: number;
  /** Termostatin tam acildigi sicaklik (K) */
  thermostatFull: number;
  /** Fan devreye girme sicakligi (K) */
  fanOn: number;
  /** Yag-su isi degistirici katsayisi (W/K) */
  oilToCoolantUA: number;
  /** Yagin karter/hava yoluyla dogrudan kaybi (W/K) */
  oilAmbientUA: number;
}

/** Motor hacmine gore makul bir sogutma sistemi turetir */
export function coolingSpecFor(displacementL: number): CoolingSpec {
  const d = clamp(displacementL, 0.8, 9);
  return {
    // Su ceketi + etrafindaki metal kutlesi. Tum blogu saymak yanlis
    // olur: isinma sirasinda once su ve cevresindeki ince metal isinir,
    // blogun govdesi cok daha yavas takip eder. Kalibrasyon: rolantide
    // 20 → 82 °C yaklasik 7 dakika (gercek degerlerle uyumlu).
    coolantCapacity: 15000 * d,
    oilCapacity: 4500 * d,
    // Radyator tam yukteki isiyi atabilecek kadar buyuk olmali:
    // 3 L motor tam gazda sogutmaya ~125 kW verir; 70 K sicaklik
    // farkiyla bunu atmak icin ~1800 W/K gerekir. Kucuk bir UA,
    // motorun 40 saniyede kaynamasina yol acar.
    radiatorUA: 480 * d,
    fanUA: 220 * d,
    thermostatOpen: 355.15,   // 82 °C
    thermostatFull: 366.15,   // 93 °C
    fanOn: 371.15,            // 98 °C
    oilToCoolantUA: 42 * d,
    oilAmbientUA: 14 * d,
  };
}

export interface ThermalStep {
  /** Motorun sogutmaya verdigi isi (W) */
  heatToCoolant: number;
  /** Radyatorden atilan isi (W) */
  heatRejected: number;
  /** Termostat acikligi (0-1) */
  thermostat: number;
  /** Fan calisiyor mu */
  fanOn: boolean;
  /** Yaga giden surtunme isisi (W) */
  frictionHeat: number;
}

/**
 * Termal durumu bir adim ilerlet.
 *
 * @param fuelPower Yakitin getirdigi guc (W) — isinin kaynagi
 * @param frictionPower Mekanik surtunme gucu (W) — dogrudan yaga gider
 * @param speedMs Arac hizi (m/s) — radyatore giren hava
 * @param ambientK Ortam sicakligi (K)
 * @param running Motor calisiyor mu
 */
export function stepThermal(
  st: ThermalMass,
  spec: CoolingSpec,
  fuelPower: number,
  frictionPower: number,
  speedMs: number,
  ambientK: number,
  running: boolean,
  dt: number,
): ThermalStep {
  // ---------- Isi uretimi ----------
  // Yakit enerjisinin ~%18'i sogutma suyuna gecer. Bu oran, teshis
  // panelindeki enerji dengesiyle ayni olmalidir; %25 alinirsa 3 L bir
  // motor tam gazda 200 kW'lik sogutma yuku uretir ve hicbir radyator
  // bunu atamaz — model 40 saniyede kaynatir.
  const heatToCoolant = running ? fuelPower * 0.18 : 0;
  // Surtunme isisinin buyuk kismini yag tasir
  const frictionHeat = running ? frictionPower * 0.75 : 0;

  // ---------- Termostat ----------
  // Kapaliyken radyatore su gitmez; motor bu sayede HIZLI isinir.
  // Soguk motorun neden birkac dakikada calisma sicakligina ulastigi,
  // sonra orada SABITLENDIGI bu valfin isidir.
  const thermostat = clamp(
    (st.coolant - spec.thermostatOpen) / (spec.thermostatFull - spec.thermostatOpen),
    0, 1,
  );

  // ---------- Radyator ----------
  // Hava debisi hizla artar; UA ~ v^0.6 seklinde olceklenir.
  const ram = Math.pow(clamp(speedMs, 0, 70) / 25, 0.6);
  const fanActive = st.coolant > spec.fanOn && speedMs < 22;
  const UA = thermostat * (spec.radiatorUA * (0.35 + ram) + (fanActive ? spec.fanUA : 0));
  const heatRejected = UA * Math.max(st.coolant - ambientK, 0);

  // ---------- Yag <-> su ve yag <-> hava ----------
  const oilToCoolant = spec.oilToCoolantUA * (st.oil - st.coolant);
  const oilToAir = spec.oilAmbientUA * (1 + 0.5 * ram) * Math.max(st.oil - ambientK, 0);

  // ---------- Entegrasyon ----------
  const dCoolant = (heatToCoolant - heatRejected + oilToCoolant) / spec.coolantCapacity;
  const dOil = (frictionHeat - oilToCoolant - oilToAir) / spec.oilCapacity;

  st.coolant = clamp(st.coolant + dCoolant * dt, ambientK, 400);
  st.oil = clamp(st.oil + dOil * dt, ambientK, 430);

  return { heatToCoolant, heatRejected, thermostat, fanOn: fanActive, frictionHeat };
}

/**
 * Anlik yag basinci (Pa, gauge).
 *
 * Yaglama modulundeki denge ile ayni fizik: pompa debisi ile yatak
 * sizintisinin esitlendigi nokta. Fark su ki burada yag sicakligi
 * CANLI degisir — uzun tam gazdan sonra yag incelir ve basinc
 * gozle gorulur bicimde duser. Surus sirasinda gostergedeki hareketin
 * kaynagi budur.
 */
export function livePressure(
  rpm: number,
  oilTempK: number,
  oilGrade: number,
  conductanceRef: number,
  pumpCoeff: number,
  pumpCapacity: number,
  reliefPressure: number,
  running = true,
): number {
  if (!running || rpm < 30) return 0;
  const mu = oilViscosity(oilGrade, oilTempK);
  // Sizinti iletkenligi viskoziteyle ters orantili
  const conductance = conductanceRef / mu;
  const flow = pumpCoeff * rpm * pumpCapacity;
  return Math.min(flow / Math.max(conductance, 1e-15), reliefPressure);
}
