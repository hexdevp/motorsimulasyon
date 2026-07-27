/**
 * Motor ve arac sesi — Web Audio ile sentez
 *
 * Ses kaydi KULLANILMAZ; her sey simulasyonun ciktisindan uretilir.
 * Bu sayede motoru degistirdiginizde ses de degisir — silindir sayisi,
 * dizilim ve krank tipi dogrudan tinlamayi belirler.
 *
 * TEMEL FIKIR: dort zamanli bir motorda her silindir iki turda bir
 * ateslenir. Yani ateslemeler krank frekansinin
 *     mertebe = silindir_sayisi / 2
 * katinda olur. I4'te 2., I6'da 3., V8'de 4. mertebe baskindir —
 * "V8 sesi" ile "sirali altili sesi" arasindaki fark budur.
 *
 * Cross-plane V8'in o meshur gurultusu ise yarim mertebeden gelir:
 * krank dizilimi yuzunden her bankada atesleme araliklari esit degildir,
 * bu da 0.5 mertebede guclu bir bilesen yaratir.
 */

import { clamp } from '../core/gas';

export interface EngineSoundProfile {
  cylinders: number;
  /** Ateslemenin krank frekansina orani (silindir/2) */
  order: number;
  /** Harmonik agirliklari — [0.5x, 1x, 2x, 3x, 4x] mertebeler */
  harmonics: number[];
  /** Egzoz gurultusu (noise) miktari */
  roughness: number;
  /** Bozulma (distortion) miktari — sertlik */
  drive: number;
  /** Turbo var mi */
  turbo: boolean;
  redline: number;
  idleRpm: number;
  /** Toplam hacim (L) — sesin DERINLIGINI belirler */
  displacement: number;
  /**
   * Egzoz darbesinin keskinligi (0.06 keskin/rasp, 0.20 yumusak).
   * Buyuk hacimli motorlarda darbe daha yayvan ve derindir.
   */
  pulseSharpness: number;
}

/**
 * Motor tanimindan ses profili turetir.
 * Dizilim ve krank tipi, harmonik dagilimini belirler.
 */
export function soundProfile(
  layout: string, cylinders: number, turbo: boolean, redline: number,
  idleRpm: number, displacement = 3.0,
): EngineSoundProfile {
  const order = cylinders / 2;
  let harmonics: number[];
  let roughness = 0.30;
  let drive = 0.35;

  if (layout === 'V8') {
    // Cross-plane: guclu yarim mertebe → o bogук gurultu
    harmonics = [0.85, 1.0, 0.55, 0.30, 0.42];
    roughness = 0.42; drive = 0.52;
  } else if (layout.startsWith('V1')) {
    // V10/V12: yuksek mertebe baskin, temiz ve tiz
    harmonics = [0.12, 0.70, 0.85, 0.55, 0.75];
    roughness = 0.22; drive = 0.30;
  } else if (layout === 'I6') {
    // Tam dengeli — puruzsuz, temel mertebe baskin
    harmonics = [0.10, 1.0, 0.62, 0.34, 0.20];
    roughness = 0.24; drive = 0.30;
  } else if (layout === 'B4' || layout === 'B6') {
    // Boxer: esit olmayan egzoz uzunluklari → belirgin yarim mertebe
    harmonics = [0.68, 1.0, 0.40, 0.26, 0.15];
    roughness = 0.44; drive = 0.42;
  } else if (layout === 'I3') {
    harmonics = [0.55, 1.0, 0.45, 0.22, 0.12];
    roughness = 0.40; drive = 0.40;
  } else if (layout === 'I5') {
    harmonics = [0.45, 1.0, 0.52, 0.30, 0.18];
    roughness = 0.34; drive = 0.38;
  } else if (layout === 'V6') {
    harmonics = [0.35, 1.0, 0.58, 0.32, 0.22];
    roughness = 0.32; drive = 0.36;
  } else {
    // I4
    harmonics = [0.22, 1.0, 0.58, 0.30, 0.16];
    roughness = 0.34; drive = 0.40;
  }
  // --- Hacim karakteri ---
  // Buyuk hacimli motorlar daha DERIN duyulur: alt mertebeler agirlik
  // kazanir, ust mertebeler geri ceker. 3 L referans alinmistir.
  const depth = clamp(displacement / 3.0, 0.45, 2.6);
  harmonics = harmonics.map((h, i) => {
    if (i <= 1) return h * (0.80 + 0.30 * depth);   // 0.5x ve 1x
    return h / (0.75 + 0.42 * depth);                // 2x, 3x, 4x
  });
  // Buyuk motorun egzoz darbesi daha yayvan
  const pulseSharpness = clamp(0.070 + 0.030 * depth, 0.055, 0.17);
  return {
    cylinders, order, harmonics, roughness, drive, turbo, redline, idleRpm,
    displacement, pulseSharpness,
  };
}

export interface AudioFrame {
  rpm: number;
  throttle: number;
  /** Motorun urettigi torkun tepe torka orani (0-1) — yuk hissi */
  load: number;
  running: boolean;
  cranking: boolean;
  crankRpm: number;
  /** Manifold basinci, atmosfer uzeri (bar) */
  boost: number;
  /** Lastik kayma hizi (m/s) */
  wheelSlip: number;
  brake: number;
  speedKmh: number;
  /** Debriyaj kayma hizi (rad/s) */
  clutchSlip: number;
  revLimiter: boolean;
}

/** Devir rolantiye yakin mi (purüz titremesi icin) */
function rpm0Frac(rpm: number, idleRpm: number): boolean {
  return rpm < idleRpm * 2.2;
}

/** Yumusak parametre gecisi — tiklama sesini onler */
function glide(param: AudioParam, value: number, now: number, tau = 0.03) {
  param.setTargetAtTime(value, now, tau);
}

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private profile: EngineSoundProfile;

  // Motor sesi zinciri
  private oscs: OscillatorNode[] = [];
  private oscGains: GainNode[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private shaper!: WaveShaperNode;

  // Gurultu kaynaklari
  private noiseBuf!: AudioBuffer;
  private exhaustNoise!: AudioBufferSourceNode;
  private exhaustGain!: GainNode;
  private exhaustFilter!: BiquadFilterNode;

  private roadNoise!: AudioBufferSourceNode;
  private roadGain!: GainNode;
  private roadFilter!: BiquadFilterNode;

  private tireSrc!: AudioBufferSourceNode;
  private tireGain!: GainNode;
  private tireFilter!: BiquadFilterNode;

  private scrubSrc!: AudioBufferSourceNode;
  private scrubGain!: GainNode;
  private scrubFilter!: BiquadFilterNode;

  private brakeSrc!: AudioBufferSourceNode;
  private brakeGain!: GainNode;
  private brakeFilter!: BiquadFilterNode;

  // Emme
  private intakeOsc!: OscillatorNode;
  private intakeGain!: GainNode;
  private intakeFilter!: BiquadFilterNode;

  // Turbo
  private turboOsc!: OscillatorNode;
  private turboGain!: GainNode;

  // Mars
  private starterOsc!: OscillatorNode;
  private starterGain!: GainNode;
  private starterLfo!: OscillatorNode;

  private started = false;
  private lastBoost = 0;
  private enabled = true;
  private popsEnabled = true;
  /** Gaz kesme sonrasi patlama uretilecek sure (s) */
  private popWindow = 0;
  private nextPop = 0;
  private lastThrottle = 0;

  constructor(profile: EngineSoundProfile) {
    this.profile = profile;
  }

  /** Tarayici kurallari geregi ilk ses ancak kullanici etkilesiminden sonra baslar */
  async start(): Promise<boolean> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return true;
    }
    try {
      const Ctor = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      await this.ctx.resume();
      this.build();
      this.started = true;
      return true;
    } catch {
      return false;
    }
  }

  private makeNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Kahverengi gurultu (brown noise) — beyaz gurultudan daha dolgun,
    // egzoz ve yol sesi icin daha dogru bir taban.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  /**
   * Egzoz DARBESI dalga bicimi.
   *
   * Bir motorun sesi surekli bir ton degil, darbe dizisidir: her
   * atesleme egzozdan kisa ve sert bir basinc darbesi olarak cikar.
   * Testere disi veya kare dalga bunu veremez — "sentezleyici" gibi
   * duyulur. Genligi ustel azalan bir harmonik serisi ise zaman
   * duzleminde tam olarak boyle bir darbe uretir.
   *
   * decay kucuk → keskin, rasp'li darbe (kucuk hacimli, yuksek devirli)
   * decay buyuk → yayvan, derin darbe (buyuk hacimli)
   */
  private makePulseWave(decay: number): PeriodicWave {
    const N = 40;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      // Ustel azalim + hafif faz kaymasi → asimetrik, dogal darbe
      real[n] = Math.exp(-n * decay) * (n % 2 === 0 ? 0.82 : 1);
      imag[n] = Math.exp(-n * decay) * 0.35 * Math.sin(n * 0.7);
    }
    return this.ctx!.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  /** Sertlik/bozulma egrisi */
  private makeCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const k = amount * 40;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  private loopSource(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    this.noiseBuf = this.makeNoiseBuffer();

    // ---------- Motor: harmonik osilatorler ----------
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this.makeCurve(this.profile.drive);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.7;

    this.engineGain.connect(this.shaper);
    this.shaper.connect(this.engineFilter);
    this.engineFilter.connect(this.master);

    // Mertebeler: 0.5x, 1x, 2x, 3x, 4x (atesleme mertebesine gore)
    const pulse = this.makePulseWave(this.profile.pulseSharpness);
    const orders = [0.5, 1, 2, 3, 4];
    orders.forEach((_, i) => {
      const o = ctx.createOscillator();
      // Temel ve yarim mertebe darbe dalgasi (motorun karakteri buradan
      // gelir); ust harmonikler daha basit dalgalarla renk katar.
      if (i <= 1) o.setPeriodicWave(pulse);
      else o.type = i === 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g);
      g.connect(this.engineGain);
      o.start();
      this.oscs.push(o);
      this.oscGains.push(g);
    });

    // ---------- Yol / ruzgar ----------
    this.roadNoise = this.loopSource(this.noiseBuf);
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 700;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.roadNoise.connect(this.roadFilter);
    this.roadFilter.connect(this.roadGain);
    this.roadGain.connect(this.master);

    // ---------- Emme hornu ----------
    // Emme sisteminin rezonansi, gaz acikken duyulan "emme sesi"dir.
    // Egzozdan bagimsiz bir renk katar; olmadan ses yalnizca egzoz
    // tonundan ibaret kalir ve duz duyulur.
    this.intakeOsc = ctx.createOscillator();
    this.intakeOsc.type = 'triangle';
    this.intakeOsc.frequency.value = 120;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 400;
    this.intakeFilter.Q.value = 2.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intakeOsc.connect(this.intakeFilter);
    this.intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.master);
    this.intakeOsc.start();

    // ---------- Lastik civiltisi ----------
    this.tireSrc = this.loopSource(this.noiseBuf);
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1100;
    this.tireFilter.Q.value = 7;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    this.tireSrc.connect(this.tireFilter);
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.master);

    // ---------- Lastik surunme gurultusu ----------
    this.scrubSrc = this.loopSource(this.noiseBuf);
    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'bandpass';
    this.scrubFilter.frequency.value = 300;
    this.scrubFilter.Q.value = 1.1;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    this.scrubSrc.connect(this.scrubFilter);
    this.scrubFilter.connect(this.scrubGain);
    this.scrubGain.connect(this.master);

    // ---------- Fren civiltisi ----------
    this.brakeSrc = this.loopSource(this.noiseBuf);
    this.brakeFilter = ctx.createBiquadFilter();
    this.brakeFilter.type = 'bandpass';
    this.brakeFilter.frequency.value = 3400;
    this.brakeFilter.Q.value = 14;
    this.brakeGain = ctx.createGain();
    this.brakeGain.gain.value = 0;
    this.brakeSrc.connect(this.brakeFilter);
    this.brakeFilter.connect(this.brakeGain);
    this.brakeGain.connect(this.master);

    // ---------- Turbo islugu ----------
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 2000;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.master);
    this.turboOsc.start();

    // ---------- Mars ----------
    this.starterOsc = ctx.createOscillator();
    this.starterOsc.type = 'sawtooth';
    this.starterOsc.frequency.value = 55;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    this.starterOsc.connect(this.starterGain);
    this.starterGain.connect(this.master);
    this.starterOsc.start();
    // Marsin "gır gır" dalgalanmasi
    this.starterLfo = ctx.createOscillator();
    this.starterLfo.type = 'square';
    this.starterLfo.frequency.value = 9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 22;
    this.starterLfo.connect(lfoGain);
    lfoGain.connect(this.starterOsc.frequency);
    this.starterLfo.start();
  }

  setProfile(p: EngineSoundProfile) {
    this.profile = p;
    if (this.started) {
      this.shaper.curve = this.makeCurve(p.drive);
      const pulse = this.makePulseWave(p.pulseSharpness);
      this.oscs.slice(0, 2).forEach((o) => o.setPeriodicWave(pulse));
    }
  }

  /** Egzoz patlamalari acik mi */
  setPops(on: boolean) { this.popsEnabled = on; }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.started) {
      glide(this.master.gain, on ? 0.9 : 0, this.ctx!.currentTime, 0.05);
    }
  }

  setVolume(v: number) {
    if (this.started) glide(this.master.gain, this.enabled ? v : 0, this.ctx!.currentTime, 0.05);
  }

  /** Her karede cagrilir — tum parametreleri gunceller */
  update(f: AudioFrame) {
    if (!this.started || !this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const p = this.profile;

    // Mars devir cevirirken sesi ondan al
    const effRpm = f.running ? f.rpm : f.cranking ? f.crankRpm : 0;
    const crankFreq = Math.max(effRpm, 0) / 60;
    const fireFreq = crankFreq * p.order;

    // ---------- Osilator frekanslari ----------
    // Rolantide her atesleme birbirinin ayni degildir; kucuk bir
    // frekans titremesi bu duzensizligi verir ve ses "canli" duyulur.
    const jitter = (f.running || f.cranking) && rpm0Frac(effRpm, p.idleRpm)
      ? 1 + (Math.random() - 0.5) * 0.012
      : 1;
    const orders = [0.5, 1, 2, 3, 4];
    orders.forEach((mult, i) => {
      const freq = clamp(fireFreq * mult * jitter, 12, 8000);
      glide(this.oscs[i].frequency, freq, now, 0.02);
    });

    // ---------- Genlikler ----------
    const rpmFrac = clamp(effRpm / p.redline, 0, 1.2);
    // Yuk arttikca alt harmonikler guclenir (motor "zorlaniyor" hissi)
    const loadBoost = 0.45 + 0.85 * clamp(f.load, 0, 1);
    const running = f.running || f.cranking;
    const baseGain = running ? (0.055 + 0.16 * rpmFrac) * loadBoost : 0;

    orders.forEach((_, i) => {
      let a = p.harmonics[i] * baseGain;
      // Yuksek harmonikler yuksek devirde one cikar
      if (i >= 2) a *= 0.55 + 0.75 * rpmFrac;
      // Gaz kesikken (motor freni) ses incelir
      if (!f.cranking) a *= 0.45 + 0.65 * clamp(f.throttle, 0, 1);
      glide(this.oscGains[i].gain, a, now, 0.03);
    });

    // Marsta motor sesi cok kisik, mars sesi baskin
    if (f.cranking) {
      glide(this.starterGain.gain, 0.10, now, 0.02);
      glide(this.engineGain.gain, 0.35, now, 0.03);
    } else {
      glide(this.starterGain.gain, 0, now, 0.05);
      glide(this.engineGain.gain, 1.0, now, 0.05);
    }

    // ---------- Filtre: gaz ve devirle acilir ----------
    // Buyuk hacimli motorlarda ust harmonikler daha erken kesilir → bogук
    const depth = clamp(p.displacement / 3.0, 0.45, 2.6);
    const cutoff = running
      ? clamp((320 + effRpm * 0.42 + f.throttle * 2600 + rpmFrac * 1400)
              / (0.72 + 0.30 * depth), 180, 9000)
      : 300;
    glide(this.engineFilter.frequency, cutoff, now, 0.04);

    // Rev limiter: kesik kesik
    if (f.revLimiter) {
      const chop = Math.sin(now * 90) > 0 ? 0.25 : 1.0;
      glide(this.engineGain.gain, chop, now, 0.005);
    }

    // ---------- Egzoz gurultusu ----------
    const exh = running
      ? p.roughness * (0.12 + 0.5 * clamp(f.throttle, 0, 1)) * (0.4 + 0.9 * rpmFrac)
      : 0;
    glide(this.exhaustGain.gain, exh, now, 0.04);
    glide(this.exhaustFilter.frequency, clamp(140 + fireFreq * 1.6, 90, 2600), now, 0.05);

    // ---------- Emme hornu ----------
    // Gaz aciklikla dogrudan orantili — kelebek kapaliyken emme sessizdir.
    const intakeAmt = running ? clamp(f.throttle, 0, 1) * (0.25 + 0.75 * rpmFrac) : 0;
    glide(this.intakeGain.gain, intakeAmt * 0.055, now, 0.05);
    glide(this.intakeOsc.frequency, clamp(fireFreq * 0.5, 15, 400), now, 0.03);
    glide(this.intakeFilter.frequency, clamp(260 + effRpm * 0.16, 200, 1800), now, 0.06);

    // ---------- Yol / ruzgar ----------
    const spd = Math.abs(f.speedKmh);
    glide(this.roadGain.gain, clamp(spd / 260, 0, 0.30), now, 0.12);
    glide(this.roadFilter.frequency, clamp(260 + spd * 7, 200, 2600), now, 0.15);

    // ---------- Lastik ----------
    //
    // Iki ayri bilesen var ve ikisi farkli sey anlatir:
    //   CIYIRTI  — lastigin yola karsi titresimi, dar bantli, tiz.
    //              Kayma basladiginda hemen duyulur.
    //   GURULTU  — sirtin yolda surunmesi, genis bantli, boguk.
    //              Kayma buyudukce baskin hale gelir.
    // Tek bir ses kullanmak, hafif kaymayla tam patinaji ayirt
    // edilemez kilar; surucunun ihtiyaci olan geri bildirim tam da bu ayrimdir.
    const slip = Math.abs(f.wheelSlip);
    const squeal = clamp((slip - 0.35) / 3.2, 0, 1);
    const scrub = clamp((slip - 1.8) / 9, 0, 1);
    // Cıyırti kaymayla hizla girer, sonra doyar
    glide(this.tireGain.gain, Math.pow(squeal, 0.6) * 0.30, now, 0.04);
    // Kayma buyudukce frekans yukselir ve rezonans keskinlesir
    glide(this.tireFilter.frequency, clamp(760 + slip * 90, 700, 2300), now, 0.06);
    glide(this.tireFilter.Q, clamp(9 - scrub * 5, 3, 9), now, 0.08);
    // Genis bantli surunme gurultusu
    glide(this.scrubGain.gain, scrub * 0.26, now, 0.06);
    glide(this.scrubFilter.frequency, clamp(240 + slip * 30, 200, 900), now, 0.10);

    // ---------- Fren ----------
    // Fren civiltisi dusuk hizda ve sert frende belirir
    const brakeSq = f.brake > 0.55 && spd > 3 && spd < 55
      ? clamp((f.brake - 0.55) / 0.45, 0, 1) * clamp((55 - spd) / 40, 0, 1)
      : 0;
    glide(this.brakeGain.gain, brakeSq * 0.12, now, 0.06);

    // ---------- Egzoz patlamalari (gaz kesme) ----------
    //
    // Gaz kesildiginde silindirlere yakit gitmeye devam eder (veya
    // yanmamis karisim egzoza kacar) ve sicak egzozda tutusur. Yuksek
    // devirden ani gaz kesmede duyulan o cıtırti budur. Turbo ve
    // zengin calisan motorlarda daha belirgindir.
    if (this.popsEnabled && p.turbo !== undefined) {
      const lifted = this.lastThrottle > 0.55 && f.throttle < 0.12;
      if (lifted && f.running && rpmFrac > 0.42) {
        this.popWindow = 0.35 + Math.random() * 0.55;
        this.nextPop = 0;
      }
      if (this.popWindow > 0) {
        this.popWindow -= 0.016;
        this.nextPop -= 0.016;
        if (this.nextPop <= 0) {
          const strength = 0.10 + 0.22 * rpmFrac * (p.turbo ? 1.25 : 1);
          this.crackle(strength);
          this.nextPop = 0.03 + Math.random() * 0.10;
        }
      }
    }
    this.lastThrottle = f.throttle;

    // ---------- Turbo ----------
    if (p.turbo) {
      const boost = Math.max(f.boost, 0);
      glide(this.turboGain.gain, clamp(boost * 0.06, 0, 0.09), now, 0.06);
      glide(this.turboOsc.frequency,
        clamp(1400 + boost * 2600 + rpmFrac * 2200, 800, 8000), now, 0.06);
      // Basinc aniden duserse blow-off
      if (this.lastBoost - boost > 0.28 && f.throttle < 0.2) this.blowOff();
      this.lastBoost = boost;
    }
  }

  // ============================================================
  // TEK SEFERLIK SESLER
  // ============================================================

  private burst(
    freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = 'bandpass',
  ) {
    if (!this.started || !this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  private thump(freq: number, gain: number, dur: number) {
    if (!this.started || !this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + dur + 0.02);
  }

  /** Egzoz cıtırtisi — tek bir kucuk patlama */
  private crackle(strength: number) {
    const f = 260 + Math.random() * 520;
    this.burst(f, 1.6, strength, 0.045 + Math.random() * 0.05, 'bandpass');
    if (Math.random() < 0.35) this.thump(60 + Math.random() * 40, strength * 0.5, 0.06);
  }

  /** Vites degisimi — mekanik tik + hafif tok ses */
  shift(up: boolean) {
    this.burst(up ? 2600 : 2100, 6, 0.16, 0.055, 'bandpass');
    this.thump(up ? 120 : 95, 0.10, 0.085);
  }

  /** Blow-off valfi — gaz kesildiginde basincin bosalmasi */
  blowOff() {
    this.burst(1600, 1.4, 0.20, 0.30, 'bandpass');
  }

  /** Egzozdan patlama */
  backfire() {
    this.burst(420, 1.0, 0.42, 0.16, 'lowpass');
    this.thump(70, 0.28, 0.13);
  }

  /** Motor stall ettiginde */
  stall() {
    this.thump(55, 0.22, 0.35);
  }

  dispose() {
    if (!this.ctx) return;
    try {
      this.oscs.forEach((o) => o.stop());
      this.turboOsc.stop(); this.starterOsc.stop(); this.starterLfo.stop();
      this.intakeOsc.stop();
      this.exhaustNoise.stop(); this.roadNoise.stop();
      this.tireSrc.stop(); this.scrubSrc.stop(); this.brakeSrc.stop();
      this.ctx.close();
    } catch { /* zaten kapali */ }
    this.ctx = null;
    this.started = false;
  }
}
