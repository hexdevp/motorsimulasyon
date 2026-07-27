/**
 * Ortam kosullari — rakim, sicaklik, nem
 *
 * Bir motorun ayni gun icinde farkli guc uretmesinin sebebi burasidir.
 * Uc etki birbirinden BAGIMSIZ calisir ve carpilir:
 *
 *   1. Basinc (rakim)   → dogrudan yogunluk
 *   2. Sicaklik         → dogrudan yogunluk (ters)
 *   3. Nem              → hem yogunlugu HAFIF dusurur hem OKSIJENI seyreltir
 *
 * Ucuncusu sik karistirilir: nemli hava kuru havadan HAFIFTIR (su
 * buharinin molar kutlesi 18, havanınki 29), ama asil guc kaybi
 * yogunluktan degil, su buharinin yer kaplayip oksijeni SEYRELTMESINDEN
 * gelir. Yanabilen sey oksijendir.
 */

import type { Ambient } from './types';
import { clamp } from './gas';

/** Deniz seviyesi standart atmosfer basinci (Pa) */
export const P_SEA_LEVEL = 101325;
/** Standart referans sicaklik (K) — guc duzeltme faktorlerinin tabani */
export const T_REFERENCE = 293.15;

/**
 * Rakimdan atmosfer basinci — barometrik formul (ISA troposfer).
 *
 *   p = p0 · (1 − 2.25577e−5 · h)^5.25588
 *
 * Denver (1600 m) icin 83.5 kPa verir; deniz seviyesinin %82'si.
 * Dogal emisli bir motor orada dogrudan ~%18 guc kaybeder.
 */
export function pressureAtAltitude(altitudeM: number, seaLevelPa = P_SEA_LEVEL): number {
  const h = clamp(altitudeM, -500, 11000);
  return seaLevelPa * Math.pow(1 - 2.25577e-5 * h, 5.25588);
}

/** Rakimla ortalama sicaklik dususu (ISA: 6.5 K/km) */
export function temperatureAtAltitude(altitudeM: number, seaLevelK = 288.15): number {
  return seaLevelK - 0.0065 * clamp(altitudeM, -500, 11000);
}

/** Doymus su buhari basinci (Pa) — Tetens formulu */
export function saturationVaporPressure(tempK: number): number {
  const tC = tempK - 273.15;
  return 610.78 * Math.exp((17.27 * tC) / (tC + 237.3));
}

/**
 * Oksijen bulunurlugu carpani (1.0 = kuru hava).
 *
 * Su buhari, karisimdaki kismi basincin bir bolumunu isgal eder ve o
 * kadar oksijen "eksilir":
 *
 *   f_O2 = (p_toplam − p_buhar) / p_toplam
 *
 * 35°C ve %90 nemde p_buhar ≈ 5.0 kPa → oksijen %5 azalir. Sicak ve
 * nemli bir gunde dinamoda ~%4-5 guc kaybinin sebebi budur; yalnizca
 * yogunluk duzeltmesine bakan hesaplar bunu kacirir.
 */
export function oxygenFactor(pressurePa: number, tempK: number, humidity: number): number {
  const pVapor = clamp(humidity, 0, 1) * saturationVaporPressure(tempK);
  return clamp((pressurePa - pVapor) / Math.max(pressurePa, 1), 0.80, 1.0);
}

/**
 * Yogunluk-rakim guc faktoru (1.0 = 20°C, deniz seviyesi, kuru).
 *
 * Dogal emisli bir motorun gucu bu carpanla yaklasik dogrusal degisir.
 * Turbo motorlarda etki daha karmasiktir: kompresor kayip basinci
 * telafi edebilir, ama bunun icin daha yuksek basinc oraninda calismak
 * zorunda kalir — bu da sicakligi ve turbo yukunu artirir.
 */
export function densityAltitudeFactor(amb: Ambient): number {
  const pVapor = clamp(amb.humidity, 0, 1) * saturationVaporPressure(amb.temperature);
  const pDry = Math.max(amb.pressure - pVapor, 1);
  const rho = pDry / (287.058 * amb.temperature) + pVapor / (461.495 * amb.temperature);
  const rhoRef = P_SEA_LEVEL / (287.058 * T_REFERENCE);
  return (rho / rhoRef) * oxygenFactor(amb.pressure, amb.temperature, amb.humidity);
}

/** Ortam kosullarini rakima gore tutarli hale getirir */
export function resolveAmbient(amb: Ambient): Ambient {
  if (!amb.useAltitude) return amb;
  return { ...amb, pressure: pressureAtAltitude(amb.altitude) };
}

// ============================================================
// KONUM PRESETLERI
// ============================================================

export interface LocationPreset {
  id: string;
  name: string;
  nameEn: string;
  /** Rakim (m) */
  altitude: number;
  /** Tipik hava sicakligi (°C) */
  tempC: number;
  /** Tipik bagil nem (0-1) */
  humidity: number;
  note: string;
  noteEn: string;
}

export const LOCATIONS: LocationPreset[] = [
  {
    id: 'sea-level', name: 'Deniz Seviyesi (standart)', nameEn: 'Sea Level (standard)',
    altitude: 0, tempC: 20, humidity: 0.4,
    note: 'Referans koşul — tüm karşılaştırmaların tabanı.',
    noteEn: 'Reference condition — the baseline for all comparisons.',
  },
  {
    id: 'istanbul', name: 'İstanbul', nameEn: 'Istanbul',
    altitude: 40, tempC: 24, humidity: 0.70,
    note: 'Deniz seviyesi ama nemli — nem oksijeni seyreltir.',
    noteEn: 'Sea level but humid — moisture dilutes oxygen.',
  },
  {
    id: 'ankara', name: 'Ankara', nameEn: 'Ankara',
    altitude: 890, tempC: 27, humidity: 0.30,
    note: 'Orta rakım, kuru. Basınç ~91 kPa.',
    noteEn: 'Moderate altitude, dry. Pressure ~91 kPa.',
  },
  {
    id: 'denver', name: 'Denver', nameEn: 'Denver',
    altitude: 1600, tempC: 25, humidity: 0.35,
    note: 'Basınç ~83.5 kPa. NA motorlar ~%18 güç kaybeder, turbo daha yüksek basınç oranında çalışmak zorunda kalır.',
    noteEn: 'Pressure ~83.5 kPa. NA engines lose ~18%; a turbo must run a higher pressure ratio to compensate.',
  },
  {
    id: 'erzurum', name: 'Erzurum', nameEn: 'Erzurum',
    altitude: 1900, tempC: 15, humidity: 0.45,
    note: 'Yüksek rakım ama serin — soğuk hava kaybın bir kısmını telafi eder.',
    noteEn: 'High altitude but cool — the cold air recovers part of the loss.',
  },
  {
    id: 'mexico-city', name: 'Mexico City', nameEn: 'Mexico City',
    altitude: 2240, tempC: 22, humidity: 0.45,
    note: 'Basınç ~77 kPa. Turbo motorların NA motorlara karşı avantajının en görünür olduğu yer.',
    noteEn: 'Pressure ~77 kPa. Where the turbo advantage over NA is most visible.',
  },
  {
    id: 'la-paz', name: 'La Paz', nameEn: 'La Paz',
    altitude: 3640, tempC: 12, humidity: 0.30,
    note: 'Basınç ~65 kPa. NA motor gücünün üçte birini kaybeder.',
    noteEn: 'Pressure ~65 kPa. An NA engine loses a third of its power.',
  },
  {
    id: 'pikes-peak', name: "Pikes Peak (zirve)", nameEn: 'Pikes Peak (summit)',
    altitude: 4300, tempC: 5, humidity: 0.25,
    note: 'Basınç ~59 kPa. Yarışçıların turbo ve büyük wastegate tercih etmesinin sebebi.',
    noteEn: 'Pressure ~59 kPa. Why competitors run turbos with large wastegates.',
  },
  {
    id: 'death-valley', name: 'Ölüm Vadisi (sıcak gün)', nameEn: 'Death Valley (hot day)',
    altitude: -60, tempC: 48, humidity: 0.10,
    note: 'Deniz seviyesinin altında ama çok sıcak — yoğunluk 1600 m rakımdaki kadar düşük.',
    noteEn: 'Below sea level but very hot — density as low as at 1600 m altitude.',
  },
  {
    id: 'cold-day', name: 'Soğuk kış günü', nameEn: 'Cold winter day',
    altitude: 100, tempC: -8, humidity: 0.60,
    note: 'Yoğun hava — güç artar ama vuruntu payı da açılır.',
    noteEn: 'Dense air — more power, and more knock margin too.',
  },
];

export function applyLocation(amb: Ambient, loc: LocationPreset): Ambient {
  return {
    ...amb,
    altitude: loc.altitude,
    temperature: loc.tempC + 273.15,
    humidity: loc.humidity,
    useAltitude: true,
    pressure: pressureAtAltitude(loc.altitude),
  };
}
