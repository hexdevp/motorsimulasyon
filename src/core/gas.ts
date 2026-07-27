/**
 * Gaz termodinamigi — NASA 7-terimli polinomlar (Gordon & McBride)
 *
 * Neden bu kadar ugrasiyoruz: basit simulasyonlar gamma=1.4 sabiti kullanir.
 * Gercekte yanma sonrasi 2500 K'de gamma ~1.25'e duser. Bu fark genisleme
 * isini %8-10 degistirir — yani tork tahmininin dogrudan icine isiyor.
 * Sicakliga bagli cp/cv olmadan "gercekci simulasyon" iddiasi bos olur.
 *
 * cp/R  = a1 + a2·T + a3·T² + a4·T³ + a5·T⁴
 * h/RT  = a1 + a2·T/2 + a3·T²/3 + a4·T³/4 + a5·T⁴/5 + a6/T
 * s/R   = a1·lnT + a2·T + a3·T²/2 + a4·T³/3 + a5·T⁴/4 + a7
 */

/** Universal gaz sabiti (J/mol·K) */
export const R_UNIVERSAL = 8.31446;

export type SpeciesName = 'N2' | 'O2' | 'CO2' | 'H2O' | 'CO' | 'H2' | 'AR';

interface NasaCoeffs {
  /** Molar kutle (kg/mol) */
  M: number;
  /** 300-1000 K araligi */
  low: [number, number, number, number, number, number, number];
  /** 1000-5000 K araligi */
  high: [number, number, number, number, number, number, number];
}

const SPECIES: Record<SpeciesName, NasaCoeffs> = {
  N2: {
    M: 0.0280134,
    low: [3.298677, 1.4082404e-3, -3.963222e-6, 5.641515e-9, -2.444854e-12, -1020.8999, 3.950372],
    high: [2.92664, 1.4879768e-3, -5.68476e-7, 1.0097038e-10, -6.753351e-15, -922.7977, 5.980528],
  },
  O2: {
    M: 0.0319988,
    low: [3.212936, 1.1274864e-3, -5.75615e-7, 1.3138773e-9, -8.768554e-13, -1005.249, 6.034738],
    high: [3.697578, 6.135197e-4, -1.258842e-7, 1.775281e-11, -1.1364354e-15, -1233.9301, 3.189166],
  },
  CO2: {
    M: 0.0440095,
    low: [2.275724, 9.922072e-3, -1.040911e-5, 6.866686e-9, -2.11728e-12, -48373.14, 10.188488],
    high: [4.453623, 3.140168e-3, -1.27841e-6, 2.393996e-10, -1.6690333e-14, -48966.96, -0.9553959],
  },
  H2O: {
    M: 0.01801528,
    low: [3.386842, 3.474982e-3, -6.354696e-6, 6.968581e-9, -2.506588e-12, -30208.11, 2.590232],
    high: [2.672145, 3.056293e-3, -8.73026e-7, 1.200996e-10, -6.391618e-15, -29899.21, 6.862817],
  },
  CO: {
    M: 0.0280101,
    low: [3.262451, 1.511941e-3, -3.881755e-6, 5.581944e-9, -2.474951e-12, -14310.539, 4.848897],
    high: [3.025078, 1.442689e-3, -5.630828e-7, 1.0185813e-10, -6.910952e-15, -14268.35, 6.108218],
  },
  H2: {
    M: 0.00201588,
    low: [3.298124, 8.249442e-4, -8.143015e-7, -9.475434e-11, 4.134872e-13, -1012.521, -3.294094],
    high: [2.991423, 7.000644e-4, -5.633829e-8, -9.231578e-12, 1.5827519e-15, -835.034, -1.35511],
  },
  AR: {
    M: 0.039948,
    low: [2.5, 0, 0, 0, 0, -745.375, 4.366],
    high: [2.5, 0, 0, 0, 0, -745.375, 4.366],
  },
};

const SPECIES_ORDER: SpeciesName[] = ['N2', 'O2', 'CO2', 'H2O', 'CO', 'H2', 'AR'];

/** Mol fraksiyonlari — indeksler SPECIES_ORDER ile ayni */
export type Composition = Float64Array;

export function newComposition(): Composition {
  return new Float64Array(SPECIES_ORDER.length);
}

export const IDX = {
  N2: 0, O2: 1, CO2: 2, H2O: 3, CO: 4, H2: 5, AR: 6,
} as const;

/** Kuru havanin molar bilesimi */
export function airComposition(): Composition {
  const c = newComposition();
  c[IDX.N2] = 0.7808;
  c[IDX.O2] = 0.2095;
  c[IDX.AR] = 0.0093;
  c[IDX.CO2] = 0.0004;
  return c;
}

/** Tek tur icin cp/R — sicaklik araligina gore dogru katsayi setini secer */
function cpOverR(sp: NasaCoeffs, T: number): number {
  const a = T < 1000 ? sp.low : sp.high;
  return a[0] + a[1] * T + a[2] * T * T + a[3] * T * T * T + a[4] * T * T * T * T;
}

/** Tek tur icin h/(R·T) */
function hOverRT(sp: NasaCoeffs, T: number): number {
  const a = T < 1000 ? sp.low : sp.high;
  return (
    a[0] +
    (a[1] * T) / 2 +
    (a[2] * T * T) / 3 +
    (a[3] * T * T * T) / 4 +
    (a[4] * T * T * T * T) / 5 +
    a[5] / T
  );
}

/** Karisimin ortalama molar kutlesi (kg/mol) */
export function mixtureMolarMass(x: Composition): number {
  let M = 0;
  for (let i = 0; i < SPECIES_ORDER.length; i++) {
    M += x[i] * SPECIES[SPECIES_ORDER[i]].M;
  }
  return M;
}

/** Karisimin ozgul gaz sabiti (J/kg·K) */
export function mixtureR(x: Composition): number {
  return R_UNIVERSAL / mixtureMolarMass(x);
}

/** Karisimin ozgul isisi, sabit basincta (J/kg·K) */
export function mixtureCp(x: Composition, T: number): number {
  // NASA polinomlari 200-5000 K icin gecerli; disina tasarsak sinira kenetle
  const Tc = clamp(T, 200, 5000);
  let cpMolar = 0;
  for (let i = 0; i < SPECIES_ORDER.length; i++) {
    if (x[i] === 0) continue;
    cpMolar += x[i] * cpOverR(SPECIES[SPECIES_ORDER[i]], Tc) * R_UNIVERSAL;
  }
  return cpMolar / mixtureMolarMass(x);
}

/** Karisimin ozgul isisi, sabit hacimde (J/kg·K) */
export function mixtureCv(x: Composition, T: number): number {
  return mixtureCp(x, T) - mixtureR(x);
}

/** Ozgul isi orani gamma = cp/cv */
export function mixtureGamma(x: Composition, T: number): number {
  const cp = mixtureCp(x, T);
  return cp / (cp - mixtureR(x));
}

/** Karisimin ozgul entalpisi (J/kg) — olusum entalpisi dahil */
export function mixtureEnthalpy(x: Composition, T: number): number {
  const Tc = clamp(T, 200, 5000);
  let hMolar = 0;
  for (let i = 0; i < SPECIES_ORDER.length; i++) {
    if (x[i] === 0) continue;
    hMolar += x[i] * hOverRT(SPECIES[SPECIES_ORDER[i]], Tc) * R_UNIVERSAL * Tc;
  }
  return hMolar / mixtureMolarMass(x);
}

/** Karisimin ozgul ic enerjisi (J/kg) — olusum enerjisi DAHIL */
export function mixtureInternalEnergy(x: Composition, T: number): number {
  return mixtureEnthalpy(x, T) - mixtureR(x) * clamp(T, 200, 5000);
}

/** Duyulur enerjilerin sifir kabul edildigi referans sicaklik (K) */
export const T_SENSIBLE_REF = 298.15;

/**
 * DUYULUR ic enerji (J/kg) — referans sicaklikta sifir.
 *
 *   u_duyulur(T) = ∫_{T_ref}^{T} cv dT
 *
 * Neden olusum entalpisi disarida birakiliyor:
 * NASA polinomlari mutlak entalpiyi verir ve icinde olusum entalpisi
 * vardir (CO2 icin −393.5 kJ/mol, H2O icin −241.8 kJ/mol). Yanmis gazin
 * mutlak ic enerjisi bu yuzden −3 MJ/kg mertebesindedir; havaninki ise
 * −0.09 MJ/kg. Cozucude yanma enerjisi zaten ACIK bir Q_yanma terimiyle
 * verildiginden, bu devasa sabitleri enerji denkleminde tasimak yalnizca
 * hataya davetiye cikarir: bilesim degistikce datum kayar ve giren taze
 * dolgunun entalpisi yanmis gazin datumuyla olculur.
 */
export function sensibleInternalEnergy(x: Composition, T: number): number {
  return mixtureInternalEnergy(x, T) - mixtureInternalEnergy(x, T_SENSIBLE_REF);
}

/**
 * DUYULUR entalpi (J/kg) — duyulur ic enerjiyle AYNI datumdan.
 *
 *   h = u + R·T
 *
 * R·T terimi AKIS ISIDIR: silindire giren dolgunun pistonu itmek icin
 * getirdigi enerji. Entalpiyi kendi ayri referansindan (h(T_ref)) olcup
 * ic enerjiyi baska referanstan olcmek, aradaki R·T_ref ≈ 85.6 kJ/kg'lik
 * farki sessizce yok eder; sonucta emme stroku boyunca dolgu manifold
 * sicakliginin altina soguyup hacimsel verim ~%10 sisirilir.
 */
export function sensibleEnthalpy(x: Composition, T: number): number {
  return sensibleInternalEnergy(x, T) + mixtureR(x) * clamp(T, 200, 5000);
}

/**
 * Yanma urunlerinin bilesimi.
 *
 * Fakir/stokiyometrik (phi<=1) tam yanma varsayar.
 * Zengin (phi>1) durumda su-gaz kaymasi (water-gas shift) dengesi cozulur:
 *   CO2 + H2  <-->  CO + H2O,   K = [CO][H2O]/[CO2][H2] ~ 3.5
 * Bu, zengin karisimda CO ve H2 olusumunu — dolayisiyla yanma veriminin
 * dusmesini — dogru yakalar. Zengin calismada gucun neden bir yerden sonra
 * DUSTUGUNU aciklayan sey budur.
 *
 * @param x Yakittaki C atomu sayisi
 * @param y Yakittaki H atomu sayisi
 * @param z Yakittaki O atomu sayisi
 * @param phi Esdegerlik orani (1 = stokiyometrik, >1 zengin)
 * @param molarLHV Yakitin molar alt isil degeri (kJ/mol). Verilmezse
 *        bilesenlerin yanma isilarindan tahmin edilir (~%2 sapma).
 */
export function combustionProducts(
  x: number,
  y: number,
  z: number,
  phi: number,
  molarLHV?: number,
): { composition: Composition; combustionEfficiency: number } {
  const comp = newComposition();
  // Stokiyometrik O2 ihtiyaci (mol O2 / mol yakit)
  const aStoich = x + y / 4 - z / 2;
  // Gercekte saglanan O2
  const aSupplied = aStoich / phi;
  // Havadan gelen N2 ve Ar (O2 basina) — kuru hava oranlari
  const n2PerO2 = 0.7808 / 0.2095;
  const arPerO2 = 0.0093 / 0.2095;
  const co2PerO2 = 0.0004 / 0.2095;

  let nCO2: number, nCO: number, nH2O: number, nH2: number, nO2: number;

  if (phi <= 1.0) {
    // Fakir veya stokiyometrik: tum yakit tam yanar, artan O2 kalir
    nCO2 = x;
    nCO = 0;
    nH2O = y / 2;
    nH2 = 0;
    nO2 = aSupplied - aStoich;
  } else {
    // Zengin: oksijen yetmez. Su-gaz kaymasi dengesi.
    nO2 = 0;
    const K = 3.5;
    // Karbon:   x = nCO2 + nCO
    // Hidrojen: y = 2·nH2O + 2·nH2
    // Oksijen:  2·aSupplied + z = 2·nCO2 + nCO + nH2O
    // Denge:    K = (nCO · nH2O) / (nCO2 · nH2)
    //
    // nCO = c olarak alip digerlerini c cinsinden yazip
    // dengeyi ikinci derece denkleme indirgiyoruz.
    const oxAvail = 2 * aSupplied + z;
    // c = nCO alalim. Korunum denklemlerinden:
    //   nCO2 = x - c
    //   nH2O = oxAvail - 2(x-c) - c = (oxAvail - 2x) + c  =  q + c
    //   nH2  = y/2 - nH2O                                 =  p - c
    // burada  p = y/2 - oxAvail + 2x   ve   q = y/2 - p = oxAvail - 2x
    const p = y / 2 - oxAvail + 2 * x;
    const q = y / 2 - p;
    // Denge: K(x-c)(p-c) = c(q+c)
    //   K·x·p - K(x+p)·c + K·c²  =  q·c + c²
    //   c²(K-1) - c[K(x+p) + q] + K·x·p = 0
    const A = K - 1;
    const B = -(K * (x + p) + q);
    const C = K * x * p;
    if (Math.abs(A) < 1e-12) {
      nCO = -C / B;
    } else {
      const disc = Math.max(0, B * B - 4 * A * C);
      // Fiziksel kok: 0 <= c <= min(x, p)
      const r1 = (-B - Math.sqrt(disc)) / (2 * A);
      const r2 = (-B + Math.sqrt(disc)) / (2 * A);
      const hi = Math.min(x, Math.max(p, 0));
      nCO = r1 >= 0 && r1 <= hi ? r1 : r2;
    }
    nCO = clamp(nCO, 0, Math.min(x, Math.max(p, 0)));
    nCO2 = x - nCO;
    nH2O = oxAvail - 2 * nCO2 - nCO;
    nH2 = y / 2 - nH2O;
    // Sayisal guvenlik
    nH2O = Math.max(0, nH2O);
    nH2 = Math.max(0, nH2);
  }

  const nN2 = aSupplied * n2PerO2;
  const nAr = aSupplied * arPerO2;
  const nCO2air = aSupplied * co2PerO2;

  const total = nCO2 + nCO2air + nCO + nH2O + nH2 + nO2 + nN2 + nAr;
  comp[IDX.CO2] = (nCO2 + nCO2air) / total;
  comp[IDX.CO] = nCO / total;
  comp[IDX.H2O] = nH2O / total;
  comp[IDX.H2] = nH2 / total;
  comp[IDX.O2] = nO2 / total;
  comp[IDX.N2] = nN2 / total;
  comp[IDX.AR] = nAr / total;

  // Yanma verimi: CO ve H2 olarak egzozdan cikan yanmamis kimyasal enerji.
  // CO → CO2 icin 283 kJ/mol, H2 → H2O icin 242 kJ/mol geride kalir.
  //
  // Zengin karisimda bu kayip kacinilmazdir: oksijen yetmez. Kaba kural
  // olarak yanma verimi ~1/phi'ye yaklasir (phi=1.2 icin ~0.83) ve denge
  // kimyasi bu tavanin biraz altinda kalir. Zengin calisan bir motorun
  // neden guc kaybettiginin ve egzozdan neden CO aktiginin sebebi budur.
  const fuelEnergy = molarLHV ?? 393.5 * x + 120.9 * y; // kJ/mol yakit
  const lostEnergy = 283.0 * nCO + 242.0 * nH2;
  const combustionEfficiency = clamp(1 - lostEnergy / Math.max(fuelEnergy, 1e-9), 0.4, 1.0);

  return { composition: comp, combustionEfficiency };
}

/**
 * Iki bilesimi kutlesel olarak karistir (yanma ilerlerken kullanilir).
 * @param f İkinci bilesimin MOL fraksiyonu
 */
export function blendComposition(a: Composition, b: Composition, f: number): Composition {
  const out = newComposition();
  const g = clamp(f, 0, 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = a[i] * (1 - g) + b[i] * g;
  }
  return out;
}

/**
 * Tikanik (choked) ve tikanik olmayan sikistirilabilir akis.
 * Supap ve gaz kelebeginden gecen kutle akisinin temel denklemi.
 *
 * @param Cd Akis katsayisi
 * @param area Geometrik akis alani (m^2)
 * @param pUp Yukari akis basinci (Pa)
 * @param pDown Asagi akis basinci (Pa)
 * @param Tup Yukari akis sicakligi (K)
 * @param R Ozgul gaz sabiti (J/kg·K)
 * @param gamma Ozgul isi orani
 * @returns Kutle akisi (kg/s), pozitif
 */
export function compressibleFlow(
  Cd: number,
  area: number,
  pUp: number,
  pDown: number,
  Tup: number,
  R: number,
  gamma: number,
): number {
  if (area <= 0 || pUp <= pDown || pUp <= 0) return 0;
  const pr = pDown / pUp;
  // Kritik basinc orani — bunun altinda akis ses hizina tikanir
  const prCrit = Math.pow(2 / (gamma + 1), gamma / (gamma - 1));
  const base = (Cd * area * pUp) / Math.sqrt(R * Math.max(Tup, 1));

  if (pr <= prCrit) {
    // Tikanik akis: asagi akis basinci artik onemli degil
    return base * Math.sqrt(gamma) * Math.pow(2 / (gamma + 1), (gamma + 1) / (2 * (gamma - 1)));
  }
  // Tikanik olmayan akis
  const term = Math.pow(pr, 2 / gamma) - Math.pow(pr, (gamma + 1) / gamma);
  return base * Math.sqrt(((2 * gamma) / (gamma - 1)) * Math.max(term, 0));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}
