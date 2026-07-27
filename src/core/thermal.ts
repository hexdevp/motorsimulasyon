/**
 * Motor termal durumu — soguk motor ve isinma
 *
 * "90°C" tek bir sayi degil, bir DURUMDUR. Soguk bir motor sicak
 * motordan farkli calisir ve bu fark tek bir yerden degil, dort ayri
 * mekanizmadan gelir:
 *
 *   1. Yag viskoz → surtunme artar          (friction.ts, oilTemp uzerinden)
 *   2. Yakit buharlasmaz → zenginlestirme gerekir
 *   3. Soguk cidarlar alevi sonduruyor → yanma verimi duser
 *   4. Soguk cidar dolguyu daha az isitir → hacimsel verim ARTAR
 *
 * Dorduncusu ters yonde calisir: soguk motorun VE'si biraz daha
 * yuksektir. Yine de net etki belirgin guc ve verim kaybidir, cunku
 * ilk uc mekanizma agir basar.
 */

import { clamp } from './gas';

export interface ThermalState {
  /** Isinma faktoru: 0 = tamamen soguk, 1 = calisma sicakliginda */
  warmup: number;
  /** Hedef lambdaya uygulanacak carpan (<1 = zenginlestirme) */
  lambdaMultiplier: number;
  /** Yanma verimine uygulanacak carpan */
  combustionEfficiencyMultiplier: number;
  /** Port isitmasina uygulanacak carpan */
  portHeatingMultiplier: number;
  /** Kullanicinin gorecegi durum etiketi */
  status: 'cold' | 'warming' | 'normal' | 'hot' | 'overheat';
}

/**
 * Sogutma suyu sicakligindan termal durum.
 *
 * Isinma egrisi 20°C'de tamamen soguk, 88°C'de tam isinmis kabul edilir;
 * arasi yumusak gecistir (gercek ECU'lardaki ISINMA ZENGINLESTIRME
 * tablolarinin sekli de budur).
 */
export function thermalState(coolantTempK: number): ThermalState {
  const c = coolantTempK - 273.15;
  const warmup = clamp((c - 20) / (88 - 20), 0, 1);
  const cold = 1 - warmup;

  // Soguk zenginlestirme: yakitin buyuk kismi port ve silindir
  // cidarlarinda sivi film olarak kalir, yanmaya katilmaz. Telafi icin
  // ECU fazladan yakit verir — soguk motorun cok yakit yakmasinin sebebi.
  //
  // Carpan olcusu onemli: zaten zengin calisan bir motorda (tam gaz
  // lambda 0.85) agresif bir carpan lambdayi 0.6'ya, yani tutusma
  // sinirinin disina iter. Gercek soguk calisma lambdasi 0.75-0.85
  // bandindadir; %15'lik carpan bunu verir.
  const lambdaMultiplier = 1 - 0.15 * cold;

  // Soguk cidar alev sondurme (quenching) bolgesini buyutur; ayrica
  // kotu atomize olmus yakit tam yanmaz.
  const combustionEfficiencyMultiplier = 1 - 0.14 * cold;

  // Soguk port dolguyu isitmaz — bu VE'yi ARTIRIR
  const portHeatingMultiplier = 0.25 + 0.75 * warmup;

  let status: ThermalState['status'];
  if (c > 112) status = 'overheat';
  else if (c > 100) status = 'hot';
  else if (c >= 82) status = 'normal';
  else if (c >= 45) status = 'warming';
  else status = 'cold';

  return {
    warmup, lambdaMultiplier, combustionEfficiencyMultiplier,
    portHeatingMultiplier, status,
  };
}

export const THERMAL_LABEL: Record<ThermalState['status'], [string, string]> = {
  cold: ['Soğuk', 'Cold'],
  warming: ['Isınıyor', 'Warming up'],
  normal: ['Normal', 'Normal'],
  hot: ['Sıcak', 'Hot'],
  overheat: ['Aşırı ısınma', 'Overheating'],
};

/**
 * Volan ataletinin gozlemlenebilir etkileri.
 *
 * Atalet zaten simulasyonda vardi ama sonucu gorunmuyordu. Iki somut
 * metrik cikariyoruz:
 *
 *   1. Bosta devir alma suresi — hafif volan hizli tirmanir
 *   2. Rolanti devir dalgalanmasi — her ateslemede krank bir "tekme"
 *      alir; atalet bu tekmeyi yutar. Hafif volanda rolanti titrek olur.
 */
export function flywheelEffects(
  totalInertia: number,
  peakTorque: number,
  idleTorquePerFiring: number,
  idleRpm: number,
  redline: number,
  cylinders: number,
) {
  // Bosta (yuksuz) rolantiden kirmizi cizgiye cikis suresi.
  // Ortalama tork tepe torkun ~%72'si kabul edilir.
  const omegaSpan = ((redline - idleRpm) * 2 * Math.PI) / 60;
  const revUpTime = (totalInertia * omegaSpan) / Math.max(peakTorque * 0.72, 1);

  // Rolantide bir atesleme darbesinin ürettiği hiz degisimi.
  // Darbe suresi ~ bir ateslemenin krank acisi araligi.
  const firingIntervalSec = 120 / (idleRpm * cylinders);
  const deltaOmega = (idleTorquePerFiring * firingIntervalSec) / Math.max(totalInertia, 1e-4);
  const idleVariationRpm = (deltaOmega * 60) / (2 * Math.PI);

  return {
    revUpTime,
    idleVariationRpm,
    /** Rolanti kararlilik degerlendirmesi */
    idleStability:
      idleVariationRpm > 90 ? 'unstable' : idleVariationRpm > 45 ? 'marginal' : 'stable',
  } as const;
}
