/**
 * Motor kesiti cizim fonksiyonlari (saf canvas, bagimlilik yok)
 *
 * Cizim tamamen SIMULASYON VERISINDEN surulur:
 *   piston konumu → krank kinematiginin kapali form cozumu
 *   supap kalkisi → kam profili
 *   gaz rengi     → cevrim izindeki gercek sicaklik
 *   alev yaricapi → Wiebe yanmis kutle fraksiyonu
 *   ok boylari    → gercek kutle debisi ve yan kuvvet
 *
 * Yani animasyon dekoratif degil; ekranda gordugunuz sey cozucunun
 * hesapladigi seydir.
 */

import type { EngineConfig } from '../core/types';
import type { CrankKinematics } from '../core/geometry';

const DEG = Math.PI / 180;

/** Cizim icin gereken, cevrim boyunca degismeyen olculer (metre) */
export interface DrawGeometry {
  bore: number;
  a: number;          // krank yaricapi
  rodLength: number;
  pinOffset: number;
  /** Pim ekseninden piston tepesine mesafe */
  compressionHeight: number;
  /** Krank merkezinden blok ust yuzeyine */
  deckHeight: number;
  /** Kafadaki yanma odasi bosluğunun yuksekligi */
  chamberHeight: number;
  deckClearance: number;
  intakeValveDia: number;
  exhaustValveDia: number;
  maxLift: number;
  /** Supaplarin dusey ile yaptigi aci (radyan) */
  valveAngle: number;
}

export function makeDrawGeometry(cfg: EngineConfig, k: CrankKinematics): DrawGeometry {
  const compressionHeight = 0.55 * cfg.geometry.bore;
  const deckHeight = k.a + cfg.geometry.rodLength + compressionHeight + cfg.geometry.deckClearance;
  // Sikistirma hacminin piston-blok bosluğu disinda kalan kismi kafadadir
  const chamberHeight = Math.max(
    k.clearanceVolume / k.pistonArea - cfg.geometry.deckClearance,
    0.004,
  );
  return {
    bore: cfg.geometry.bore,
    a: k.a,
    rodLength: cfg.geometry.rodLength,
    pinOffset: cfg.geometry.pinOffset,
    compressionHeight,
    deckHeight,
    chamberHeight,
    deckClearance: cfg.geometry.deckClearance,
    intakeValveDia: cfg.valvetrain.intakeValveDia,
    exhaustValveDia: cfg.valvetrain.exhaustValveDia,
    maxLift: cfg.valvetrain.intakeCam.lift,
    valveAngle: cfg.valvetrain.intakeValvesPerCyl >= 2 ? 14 * DEG : 6 * DEG,
  };
}

/** Cevrimin belirli bir anindaki durum */
export interface FrameState {
  theta: number;
  pressure: number;
  temperature: number;
  burnFraction: number;
  intakeLift: number;
  exhaustLift: number;
  intakeFlow: number;
  exhaustFlow: number;
  knockIntegral: number;
  sideForce: number;
  maxPressure: number;
  maxFlow: number;
  maxSideForce: number;
}

export interface Layers {
  combustion: boolean;
  valves: boolean;
  forces: boolean;
  thermo: boolean;
}

/**
 * Gaz sicakligindan renk.
 * Soğuk dolgu koyu mavi-gri, yanma sonrasi beyaza yakin sari.
 */
export function tempColor(T: number, alpha = 1): string {
  const stops: [number, [number, number, number]][] = [
    [280, [38, 48, 62]],
    [500, [58, 72, 92]],
    [900, [128, 78, 44]],
    [1400, [196, 88, 36]],
    [1900, [238, 140, 30]],
    [2400, [252, 205, 66]],
    [3000, [255, 246, 214]],
  ];
  const t = Math.max(stops[0][0], Math.min(T, stops[stops.length - 1][0]));
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[i + 1];
  const f = (t - t0) / (t1 - t0 || 1);
  const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** Piston pimi yuksekligi (krank merkezinden, metre) */
export function pinHeight(g: DrawGeometry, thetaDeg: number): number {
  const t = thetaDeg * DEG;
  const s = g.a * Math.sin(t) - g.pinOffset;
  return g.a * Math.cos(t) + Math.sqrt(g.rodLength * g.rodLength - s * s);
}

/** Biyel acisi (radyan, dusey ile) */
export function rodAngleAt(g: DrawGeometry, thetaDeg: number): number {
  const t = thetaDeg * DEG;
  return Math.asin((g.a * Math.sin(t) - g.pinOffset) / g.rodLength);
}

interface Transform {
  /** metre → piksel */
  scale: number;
  /** krank merkezinin piksel konumu */
  cx: number;
  cy: number;
}

/** Motoru tuvale sigdiran donusum */
function fitTransform(g: DrawGeometry, w: number, h: number): Transform {
  const topY = g.deckHeight + g.chamberHeight + 0.055 * g.bore;
  const bottomY = -(g.a + 0.55 * g.bore);
  const totalH = topY - bottomY;
  const totalW = g.bore * 2.5;
  const scale = Math.min((w * 0.94) / totalW, (h * 0.94) / totalH);
  return {
    scale,
    cx: w / 2 - g.pinOffset * scale,
    cy: h / 2 + ((topY + bottomY) / 2) * scale,
  };
}

/** Ana cizim fonksiyonu */
export function drawCylinder(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  g: DrawGeometry,
  s: FrameState,
  layers: Layers,
  lang: 'tr' | 'en',
  sparkAdvance: number,
) {
  const T = fitTransform(g, w, h);
  const X = (x: number) => T.cx + x * T.scale;
  const Y = (y: number) => T.cy - y * T.scale;
  const S = (v: number) => v * T.scale;

  ctx.clearRect(0, 0, w, h);

  const axis = g.pinOffset;              // silindir ekseni
  const halfBore = g.bore / 2;
  const pinY = pinHeight(g, s.theta);
  const crownY = pinY + g.compressionHeight;
  const chamberTop = g.deckHeight + g.chamberHeight;

  // ---------- Blok ve gomlek ----------
  const wallT = S(0.012 * (g.bore / 0.086));
  ctx.fillStyle = '#232c38';
  ctx.fillRect(X(axis - halfBore) - wallT, Y(g.deckHeight), wallT, S(g.deckHeight + g.a * 0.4));
  ctx.fillRect(X(axis + halfBore), Y(g.deckHeight), wallT, S(g.deckHeight + g.a * 0.4));

  // ---------- Yanma odasi gazi ----------
  const gasTop = Y(chamberTop);
  const gasBottom = Y(crownY);
  const gasH = Math.max(gasBottom - gasTop, 1);
  if (layers.thermo) {
    ctx.fillStyle = tempColor(s.temperature);
    ctx.fillRect(X(axis - halfBore), gasTop, S(g.bore), gasH);
    // Basinc yogunlugu: yuksek basincta hafif ic parlama
    const pFrac = Math.min(s.pressure / Math.max(s.maxPressure, 1), 1);
    if (pFrac > 0.15) {
      const grad = ctx.createLinearGradient(0, gasTop, 0, gasTop + gasH);
      grad.addColorStop(0, `rgba(255,255,255,${0.10 * pFrac})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(X(axis - halfBore), gasTop, S(g.bore), gasH);
    }
  } else {
    ctx.fillStyle = '#1a222c';
    ctx.fillRect(X(axis - halfBore), gasTop, S(g.bore), gasH);
  }

  // ---------- Alev cephesi ----------
  // Buji, yanma odasinin ust-merkezindedir. Alev oradan kuresel yayilir;
  // yaricap yanmis HACIM fraksiyonunun kup kokuyle buyur.
  const plugX = axis;
  const plugY = chamberTop - g.chamberHeight * 0.25;
  if (layers.combustion && s.burnFraction > 1e-3) {
    const maxR = Math.hypot(halfBore, chamberTop - crownY) * 1.05;
    const r = maxR * Math.cbrt(Math.min(s.burnFraction, 1));
    ctx.save();
    ctx.beginPath();
    ctx.rect(X(axis - halfBore), gasTop, S(g.bore), gasH);
    ctx.clip();
    const rp = S(r);
    const grad = ctx.createRadialGradient(X(plugX), Y(plugY), rp * 0.25, X(plugX), Y(plugY), rp);
    grad.addColorStop(0, 'rgba(255,248,220,0.95)');
    grad.addColorStop(0.55, 'rgba(255,186,64,0.80)');
    grad.addColorStop(1, 'rgba(240,110,30,0.15)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(X(plugX), Y(plugY), rp, 0, Math.PI * 2);
    ctx.fill();
    // Alev cephesi cizgisi
    ctx.strokeStyle = 'rgba(255,240,200,0.85)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Son gaz bolgesi: alev cephesinin disinda kalan, henuz yanmamis kisim.
    // Vurunti integrali yukseldikce kirmiziya doner — otomatik tutusma
    // tam olarak BURADA olur.
    if (s.knockIntegral > 0.35 && s.burnFraction < 0.97) {
      const glow = Math.min((s.knockIntegral - 0.35) / 0.65, 1);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255,40,30,${0.16 + 0.34 * glow})`;
      ctx.beginPath();
      ctx.rect(X(axis - halfBore), gasTop, S(g.bore), gasH);
      ctx.arc(X(plugX), Y(plugY), rp, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    }
    ctx.restore();
  }

  // ---------- Kafa ve supaplar ----------
  ctx.fillStyle = '#2f3a49';
  ctx.beginPath();
  ctx.rect(X(axis - halfBore) - wallT, Y(chamberTop + 0.045 * g.bore),
    S(g.bore) + wallT * 2, S(0.045 * g.bore));
  ctx.fill();

  const drawValve = (
    side: -1 | 1, dia: number, lift: number, color: string, flow: number,
  ) => {
    const ang = side * g.valveAngle;
    const seatX = axis + side * (halfBore * 0.45);
    const seatY = chamberTop;
    ctx.save();
    ctx.translate(X(seatX), Y(seatY));
    ctx.rotate(ang);

    // Sap
    const stemW = S(0.008 * (g.bore / 0.086));
    const liftPx = S(lift);
    ctx.fillStyle = '#8b98a9';
    ctx.fillRect(-stemW / 2, -S(0.16 * g.bore) + liftPx, stemW, S(0.16 * g.bore));

    // Tabla
    const headW = S(dia);
    const headH = S(0.018 * (g.bore / 0.086));
    ctx.fillStyle = lift > 1e-5 ? color : '#6b7887';
    ctx.beginPath();
    ctx.moveTo(-headW / 2, liftPx);
    ctx.lineTo(headW / 2, liftPx);
    ctx.lineTo(headW / 2 - headH, liftPx + headH);
    ctx.lineTo(-headW / 2 + headH, liftPx + headH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ---------- Akis oklari ----------
    if (layers.valves && lift > 1e-5 && Math.abs(flow) > 1e-4) {
      const mag = Math.min(Math.abs(flow) / Math.max(s.maxFlow, 1e-6), 1);
      const n = 1 + Math.round(mag * 3);
      const into = flow > 0;
      ctx.strokeStyle = into ? '#3fb950' : '#f85149';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < n; i++) {
        const ax = X(seatX + side * (i - (n - 1) / 2) * g.bore * 0.09);
        const y0 = Y(seatY + 0.055 * g.bore);
        const y1 = Y(seatY - 0.075 * g.bore);
        const from = into ? y0 : y1;
        const to = into ? y1 : y0;
        ctx.beginPath();
        ctx.moveTo(ax, from);
        ctx.lineTo(ax, to);
        ctx.stroke();
        // Ok ucu
        const dir = Math.sign(to - from);
        ctx.beginPath();
        ctx.moveTo(ax, to);
        ctx.lineTo(ax - 3.5, to - dir * 6);
        ctx.lineTo(ax + 3.5, to - dir * 6);
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  drawValve(-1, g.intakeValveDia, s.intakeLift, '#3fb950', s.intakeFlow);
  drawValve(1, g.exhaustValveDia, s.exhaustLift, '#f85149', -s.exhaustFlow);

  // Bindirme vurgusu: iki supap da acikken
  if (layers.valves && s.intakeLift > 1e-5 && s.exhaustLift > 1e-5) {
    ctx.strokeStyle = 'rgba(163,113,247,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(X(axis - halfBore) - 3, Y(chamberTop) - 3, S(g.bore) + 6, S(g.chamberHeight) + 6);
    ctx.setLineDash([]);
    ctx.fillStyle = '#a371f7';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lang === 'tr' ? 'BİNDİRME' : 'OVERLAP', X(axis), Y(chamberTop) - 9);
  }

  // ---------- Buji ----------
  ctx.strokeStyle = '#d7dee8';
  ctx.lineWidth = S(0.006 * (g.bore / 0.086));
  ctx.beginPath();
  ctx.moveTo(X(plugX), Y(chamberTop + 0.04 * g.bore));
  ctx.lineTo(X(plugX), Y(plugY));
  ctx.stroke();
  // Ateslemede kivilcim
  const sparkTheta = -sparkAdvance;
  if (s.theta >= sparkTheta - 3 && s.theta <= sparkTheta + 6) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(X(plugX), Y(plugY), S(0.02 * g.bore), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,200,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(plugX), Y(plugY), S(0.045 * g.bore), 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---------- Piston ----------
  const pistonH = 0.78 * g.bore;
  ctx.fillStyle = '#b8c2ce';
  ctx.fillRect(X(axis - halfBore), Y(crownY), S(g.bore), S(pistonH));
  // Tepe cizgisi
  ctx.fillStyle = '#d7dee8';
  ctx.fillRect(X(axis - halfBore), Y(crownY), S(g.bore), S(0.02 * g.bore));
  // Segmanlar
  ctx.fillStyle = '#5d6875';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(X(axis - halfBore), Y(crownY - (0.06 + i * 0.055) * g.bore),
      S(g.bore), S(0.016 * g.bore));
  }

  // ---------- Yan kuvvet ----------
  if (layers.forces && Math.abs(s.sideForce) > 1) {
    const mag = Math.min(Math.abs(s.sideForce) / Math.max(s.maxSideForce, 1), 1);
    const dir = Math.sign(s.sideForce);
    const len = S(g.bore * 0.42) * mag;
    const yMid = Y(crownY - pistonH * 0.55);
    const startX = X(axis + dir * halfBore);
    ctx.strokeStyle = '#f0a03a';
    ctx.fillStyle = '#f0a03a';
    ctx.lineWidth = 2 + 2.5 * mag;
    ctx.beginPath();
    ctx.moveTo(startX, yMid);
    ctx.lineTo(startX + dir * len, yMid);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(startX + dir * len, yMid);
    ctx.lineTo(startX + dir * (len - 8), yMid - 5);
    ctx.lineTo(startX + dir * (len - 8), yMid + 5);
    ctx.closePath();
    ctx.fill();
    // Basinc tarafi vurgusu
    ctx.fillStyle = `rgba(240,160,58,${0.25 + 0.35 * mag})`;
    ctx.fillRect(X(axis + (dir > 0 ? halfBore - 0.06 * g.bore : -halfBore)),
      Y(crownY - 0.1 * g.bore), S(0.06 * g.bore), S(pistonH * 0.75));
  }

  // ---------- Pim, biyel, krank ----------
  const crankX = g.a * Math.sin(s.theta * DEG);
  const crankY = g.a * Math.cos(s.theta * DEG);

  // Krank dairesi (yorunge)
  ctx.strokeStyle = '#2a3441';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(X(0), Y(0), S(g.a), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Karsi agirlik
  ctx.fillStyle = '#3d4a5c';
  ctx.beginPath();
  ctx.arc(X(0), Y(0), S(g.a * 0.92), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a3441';
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  ctx.arc(X(0), Y(0), S(g.a * 0.92),
    Math.atan2(-(crankY), crankX) - 2.5, Math.atan2(-(crankY), crankX) + 2.5);
  ctx.closePath();
  ctx.fill();

  // Biyel
  ctx.strokeStyle = '#8b98a9';
  ctx.lineWidth = S(0.055 * g.bore);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(X(crankX), Y(crankY));
  ctx.lineTo(X(axis), Y(pinY));
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Krank pimi ve ana muylu
  ctx.fillStyle = '#d7dee8';
  ctx.beginPath();
  ctx.arc(X(crankX), Y(crankY), S(0.075 * g.bore), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b7887';
  ctx.beginPath();
  ctx.arc(X(0), Y(0), S(0.10 * g.bore), 0, Math.PI * 2);
  ctx.fill();
  // Piston pimi
  ctx.fillStyle = '#5d6875';
  ctx.beginPath();
  ctx.arc(X(axis), Y(pinY), S(0.055 * g.bore), 0, Math.PI * 2);
  ctx.fill();

  // ---------- TDC ve avans acisi gostergesi ----------
  if (layers.forces) {
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(0), Y(g.a * 1.42));
    ctx.stroke();
    ctx.fillStyle = '#f85149';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TDC', X(0), Y(g.a * 1.42) - 5);

    // Atesleme avansi isini
    const sa = -sparkAdvance * DEG;
    ctx.strokeStyle = '#d29922';
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(g.a * 1.32 * Math.sin(sa)), Y(g.a * 1.32 * Math.cos(sa)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d29922';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${sparkAdvance.toFixed(0)}°`,
      X(g.a * 1.5 * Math.sin(sa)), Y(g.a * 1.5 * Math.cos(sa)));

    // Krank kolu isini
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(crankX * 1.18), Y(crankY * 1.18));
    ctx.stroke();
  }
}

export interface MultiCylState {
  index: number;
  theta: number;
  /** Silindir ekseninin dusey ile acisi (derece) */
  axisAngle: number;
  color: string;
  firing: boolean;
  /** Emme supabi kalkisi (m) */
  intakeLift: number;
  /** Egzoz supabi kalkisi (m) */
  exhaustLift: number;
  /** Yanmis kutle fraksiyonu (0-1) — alev cephesi bundan cizilir */
  burnFraction: number;
}

/**
 * Cok silindirli sematik gorunum.
 *
 * Yerlesim gercek mimariye sadiktir: V ve boxer motorlarda iki banka
 * ORTAK KRANK MERKEZINI paylasir; bankalari ayri satirlara koyup
 * dondurmek hem geometriyi yanlis gosterir hem de tuval kenarinda
 * kirpilmaya yol acar. Dolayisiyla:
 *
 *   sirali  → n adet dusey silindir, yan yana
 *   V       → n/2 adet V cifti, her cift tek krank merkezinden ±θ/2
 *   boxer   → n/2 adet karsilikli cift, yataya ±90°
 *
 * Boylece V8'in V'si, boxer'in karsilikli hareketi ve I6'nin duz
 * dizilimi bir bakista ayirt edilir.
 */
export function drawMultiCylinder(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  g: DrawGeometry,
  cylinders: MultiCylState[],
  bankAngle: number,
) {
  ctx.clearRect(0, 0, w, h);
  const n = cylinders.length;
  const isPaired = bankAngle > 0;
  const cells = isPaired ? Math.ceil(n / 2) : n;
  const cellW = w / cells;

  // Krank merkezinden silindir tepesine kadar olan uzanim
  const reach = g.deckHeight + g.chamberHeight;
  const half = g.bore / 2;
  const tilt = (bankAngle / 2) * DEG;

  // Dondurulmus silindirin kaplayacagi alan — olcek bunu tuvale sigdirir
  const extentX = isPaired
    ? reach * Math.sin(tilt) + half * Math.cos(tilt) + half * 0.4
    : half * 1.5;
  const extentYUp = isPaired
    ? Math.max(reach * Math.cos(tilt) + half * Math.sin(tilt), g.a * 1.2)
    : reach;
  const extentYDown = g.a * 1.25;

  const scale = Math.min(
    (cellW * 0.46) / extentX,
    (h * 0.80) / (extentYUp + extentYDown),
  );

  // Krank merkezinin dikey konumu: asagida yer birakarak ortala
  const crankScreenY = h * 0.5 + ((extentYUp - extentYDown) / 2) * scale;

  cylinders.forEach((c) => {
    const pairIndex = isPaired ? Math.floor((c.index - 1) / 2) : c.index - 1;
    const cx = cellW * (pairIndex + 0.5);
    const cy = crankScreenY;

    ctx.save();
    ctx.translate(cx, cy);
    // Silindir eksenini banka acisina cevir — donme merkezi KRANK MERKEZI
    if (isPaired) ctx.rotate(c.axisAngle * DEG);

    // Yerel koordinat: krank merkezi (0,0), y yukari
    const X = (x: number) => x * scale;
    const Y = (y: number) => -y * scale;

    const pinY = pinHeight(g, c.theta);
    const crownY = pinY + g.compressionHeight;
    const chamberTop = g.deckHeight + g.chamberHeight;
    const wallT = Math.max(1.5, 0.02 * g.bore * scale);

    // Gomlek duvarlari
    ctx.fillStyle = '#232c38';
    const wallTop = Y(g.deckHeight);
    const wallLen = (g.deckHeight - g.a * 0.35) * scale;
    ctx.fillRect(X(-half) - wallT, wallTop, wallT, wallLen);
    ctx.fillRect(X(half), wallTop, wallT, wallLen);

    // Kafa
    ctx.fillStyle = '#2f3a49';
    ctx.fillRect(X(-half) - wallT, Y(chamberTop + 0.05 * g.bore),
      X(g.bore) + wallT * 2, 0.05 * g.bore * scale);

    // Gaz — zaman/sicaklik rengiyle
    const gasTop = Y(chamberTop);
    const gasBot = Y(crownY);
    const gasH = Math.max(gasBot - gasTop, 1);
    ctx.fillStyle = c.color + (c.firing ? 'ee' : '66');
    ctx.fillRect(X(-half), gasTop, X(g.bore), gasH);

    // ---- Alev cephesi ----
    // Bujiden kuresel yayilir; yaricap yanmis HACIM fraksiyonunun kup
    // kokuyle buyur. Boylece her silindirde yanmanin hangi evrede
    // oldugu bir bakista gorulur.
    if (c.burnFraction > 1e-3 && c.burnFraction < 0.999) {
      const plugY = chamberTop - g.chamberHeight * 0.3;
      const maxR = Math.hypot(half, chamberTop - crownY) * 1.05;
      const rp = maxR * Math.cbrt(Math.min(c.burnFraction, 1)) * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(-half), gasTop, X(g.bore), gasH);
      ctx.clip();
      const grad = ctx.createRadialGradient(
        X(0), Y(plugY), rp * 0.2, X(0), Y(plugY), Math.max(rp, 1));
      grad.addColorStop(0, 'rgba(255,248,220,0.95)');
      grad.addColorStop(0.55, 'rgba(255,186,64,0.78)');
      grad.addColorStop(1, 'rgba(240,110,30,0.12)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(X(0), Y(plugY), Math.max(rp, 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- Supaplar ----
    // Kalkis miktarina gore asagi iner. Bindirme aninda ikisi de acik
    // gorunur — dizilim boyunca hangi silindirin hangi zamanda oldugunu
    // supaplardan takip edebilirsiniz.
    const drawValve = (side: -1 | 1, lift: number, col: string) => {
      const vx = side * half * 0.42;
      const stemW = Math.max(1.5, 0.03 * g.bore * scale);
      const headW = Math.max(4, 0.30 * g.bore * scale);
      const liftPx = lift * scale * 6; // gorunurluk icin abartili olcek
      ctx.fillStyle = lift > 1e-5 ? col : '#5d6875';
      ctx.fillRect(X(vx) - stemW / 2, gasTop - 0.10 * g.bore * scale + liftPx,
        stemW, 0.10 * g.bore * scale);
      ctx.fillRect(X(vx) - headW / 2, gasTop + liftPx, headW,
        Math.max(2, 0.025 * g.bore * scale));
    };
    drawValve(-1, c.intakeLift, '#3fb950');
    drawValve(1, c.exhaustLift, '#f85149');

    // Piston
    ctx.fillStyle = '#b8c2ce';
    ctx.fillRect(X(-half), gasBot, X(g.bore), 0.42 * g.bore * scale);

    // Biyel + krank pimi
    const ckx = g.a * Math.sin(c.theta * DEG);
    const cky = g.a * Math.cos(c.theta * DEG);
    ctx.strokeStyle = '#6b7887';
    ctx.lineWidth = Math.max(1.6, 0.045 * g.bore * scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(X(ckx), Y(cky));
    ctx.lineTo(X(g.pinOffset), Y(pinY));
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#8b98a9';
    ctx.beginPath();
    ctx.arc(X(ckx), Y(cky), Math.max(2.5, 0.055 * g.bore * scale), 0, Math.PI * 2);
    ctx.fill();

    // Ateslenen silindiri cerceve icine al
    if (c.firing) {
      ctx.strokeStyle = '#f85149';
      ctx.lineWidth = 2;
      ctx.strokeRect(X(-half) - 3, gasTop - 3, X(g.bore) + 6, gasBot - gasTop + 6);
    }
    ctx.restore();

    // Silindir numarasi — donmemis koordinatta, eksen yonunde disari
    const labelR = (extentYUp + half * 0.5) * scale;
    const la = c.axisAngle * DEG;
    ctx.fillStyle = c.firing ? '#f85149' : '#8b98a9';
    ctx.font = `${c.firing ? 'bold ' : ''}11px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(c.index), cx + Math.sin(la) * labelR, cy - Math.cos(la) * labelR);
  });

  // Ortak krank mili ekseni
  ctx.strokeStyle = '#3d4a5c';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, crankScreenY);
  ctx.lineTo(w, crankScreenY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textBaseline = 'alphabetic';
}
