/**
 * Gosterge paneli cizimi
 *
 * Buyuk devir saati (kirmizi bolge isaretli), dijital hiz ve vites,
 * yardimci gostergeler (su, yag, basinc, EGT, lambda) ve ikaz lambalari.
 * Tum degerler simulasyonun o anki ciktisidir.
 */

import { clamp } from '../core/gas';

export interface ClusterState {
  rpm: number;
  redline: number;
  idleRpm: number;
  speedKmh: number;
  gear: number;
  throttle: number;
  brake: number;
  clutch: number;
  handbrake: number;
  coolantC: number;
  oilBar: number;
  boostBar: number;
  egtC: number;
  lambda: number;
  knock: number;
  clutchHeat: number;
  wheelSpin: boolean;
  revLimiter: boolean;
  stalled: boolean;
  lang: 'tr' | 'en';
}

const FACE = '#0b0f14';
const RING = '#2a3441';
const TICK = '#8b98a9';
const TEXT = '#d7dee8';

/** Yay seklinde gosterge — degerin oranina gore dolu */
function arcGauge(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  frac: number, color: string, thickness: number,
  start = Math.PI * 0.78, sweep = Math.PI * 1.44,
) {
  ctx.strokeStyle = RING;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + sweep);
  ctx.stroke();

  if (frac > 0.001) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * clamp(frac, 0, 1));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Kucuk yardimci gosterge */
function miniGauge(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number,
  label: string, value: string, frac: number, color: string,
) {
  ctx.fillStyle = '#5d6875';
  ctx.font = '9.5px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y);

  ctx.fillStyle = color;
  ctx.font = 'bold 15px Consolas, monospace';
  ctx.fillText(value, x, y + 19);

  ctx.fillStyle = '#151b23';
  ctx.fillRect(x, y + 25, w, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 25, w * clamp(frac, 0, 1), 4);
}

export function drawCluster(
  ctx: CanvasRenderingContext2D, w: number, h: number, s: ClusterState,
) {
  const TR = s.lang === 'tr';
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = FACE;
  ctx.fillRect(0, 0, w, h);

  // ============ DEVIR SAATI ============
  const tachR = Math.min(h * 0.40, w * 0.16);
  const tcx = w * 0.20;
  const tcy = h * 0.50;
  const start = Math.PI * 0.78;
  const sweep = Math.PI * 1.44;

  // Kirmizi bolge
  const redFrac = s.redline / (s.redline * 1.06);
  ctx.strokeStyle = 'rgba(248,81,73,0.30)';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.arc(tcx, tcy, tachR, start + sweep * redFrac, start + sweep);
  ctx.stroke();

  const rpmFrac = s.rpm / (s.redline * 1.06);
  const tachColor = s.rpm >= s.redline ? '#f85149'
    : s.rpm > s.redline * 0.88 ? '#d29922' : '#4a9eff';
  arcGauge(ctx, tcx, tcy, tachR, rpmFrac, tachColor, 13);

  // Kademe cizgileri ve rakamlar
  const step = s.redline > 9000 ? 2000 : 1000;
  for (let v = 0; v <= s.redline * 1.06; v += step) {
    const a = start + sweep * (v / (s.redline * 1.06));
    const r0 = tachR - 10, r1 = tachR - 18;
    ctx.strokeStyle = TICK; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tcx + Math.cos(a) * r0, tcy + Math.sin(a) * r0);
    ctx.lineTo(tcx + Math.cos(a) * r1, tcy + Math.sin(a) * r1);
    ctx.stroke();
    ctx.fillStyle = TICK;
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(v / 1000),
      tcx + Math.cos(a) * (tachR - 29), tcy + Math.sin(a) * (tachR - 29));
  }

  // Ibre
  {
    const a = start + sweep * clamp(rpmFrac, 0, 1);
    ctx.strokeStyle = tachColor; ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tcx - Math.cos(a) * 8, tcy - Math.sin(a) * 8);
    ctx.lineTo(tcx + Math.cos(a) * (tachR - 6), tcy + Math.sin(a) * (tachR - 6));
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#3d4a5c';
    ctx.beginPath(); ctx.arc(tcx, tcy, 6, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = TEXT;
  ctx.font = 'bold 21px Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(s.rpm.toFixed(0), tcx, tcy + tachR * 0.44);
  ctx.fillStyle = '#5d6875';
  ctx.font = '9.5px sans-serif';
  ctx.fillText('rpm', tcx, tcy + tachR * 0.44 + 15);

  // ============ HIZ VE VITES ============
  const scx = w * 0.455;
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 60px Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(Math.abs(s.speedKmh).toFixed(0), scx, h * 0.50);
  ctx.fillStyle = '#5d6875';
  ctx.font = '12px sans-serif';
  ctx.fillText('km/s', scx, h * 0.50 + 18);

  // Vites gostergesi
  const gearLabel = s.gear === 0 ? 'N' : s.gear < 0 ? 'R' : String(s.gear);
  ctx.fillStyle = s.gear === 0 ? '#5d6875' : '#3fb950';
  ctx.font = 'bold 40px Consolas, monospace';
  ctx.fillText(gearLabel, scx, h * 0.50 - 74);
  ctx.fillStyle = '#5d6875';
  ctx.font = '9.5px sans-serif';
  ctx.fillText(TR ? 'VİTES' : 'GEAR', scx, h * 0.50 - 62);

  // ============ PEDAL DURUMLARI ============
  {
    const px = w * 0.335;
    const py = h * 0.63;
    const barH = 46, barW = 9, gap = 15;
    const pedalsList: [string, number, string][] = [
      [TR ? 'G' : 'T', s.throttle, '#3fb950'],
      [TR ? 'F' : 'B', s.brake, '#f85149'],
      [TR ? 'D' : 'C', s.clutch, '#a371f7'],
      ['⇑', s.handbrake, '#d29922'],
    ];
    pedalsList.forEach(([lbl, val, col], i) => {
      const x = px + i * gap;
      ctx.fillStyle = '#151b23';
      ctx.fillRect(x, py, barW, barH);
      ctx.fillStyle = col;
      ctx.fillRect(x, py + barH * (1 - clamp(val, 0, 1)), barW, barH * clamp(val, 0, 1));
      ctx.fillStyle = val > 0.03 ? col : '#5d6875';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, x + barW / 2, py + barH + 11);
    });
  }

  // ============ YARDIMCI GOSTERGELER ============
  {
    const gx = w * 0.585;
    const gw = Math.max((w * 0.40) / 3 - 14, 62);
    const col1 = gx, col2 = gx + gw + 14, col3 = gx + (gw + 14) * 2;
    const row1 = h * 0.24, row2 = h * 0.58;

    const coolColor = s.coolantC > 110 ? '#f85149' : s.coolantC > 100 ? '#d29922'
      : s.coolantC < 60 ? '#4a9eff' : '#3fb950';
    miniGauge(ctx, col1, row1, gw, TR ? 'SU SICAKLIĞI' : 'COOLANT',
      `${s.coolantC.toFixed(0)}°C`, s.coolantC / 130, coolColor);

    const oilColor = s.oilBar < 1 ? '#f85149' : s.oilBar < 2 ? '#d29922' : '#3fb950';
    miniGauge(ctx, col2, row1, gw, TR ? 'YAĞ BASINCI' : 'OIL PRESSURE',
      `${s.oilBar.toFixed(1)} bar`, s.oilBar / 6, oilColor);

    const boostColor = s.boostBar > 0.05 ? '#a371f7' : '#5d6875';
    miniGauge(ctx, col3, row1, gw, TR ? 'BASINÇ' : 'BOOST',
      `${s.boostBar >= 0 ? '+' : ''}${s.boostBar.toFixed(2)}`,
      clamp((s.boostBar + 0.6) / 2.2, 0, 1), boostColor);

    const egtColor = s.egtC > 950 ? '#f85149' : s.egtC > 870 ? '#d29922' : '#3fb950';
    miniGauge(ctx, col1, row2, gw, 'EGT', `${s.egtC.toFixed(0)}°C`, s.egtC / 1050, egtColor);

    const lamColor = s.lambda < 0.78 ? '#d29922' : s.lambda > 1.05 ? '#f85149' : '#3fb950';
    miniGauge(ctx, col2, row2, gw, 'LAMBDA', s.lambda.toFixed(2),
      clamp((s.lambda - 0.6) / 0.7, 0, 1), lamColor);

    const clColor = s.clutchHeat > 0.7 ? '#f85149' : s.clutchHeat > 0.35 ? '#d29922' : '#3fb950';
    miniGauge(ctx, col3, row2, gw, TR ? 'DEBRİYAJ ISISI' : 'CLUTCH HEAT',
      `${(s.clutchHeat * 100).toFixed(0)}%`, s.clutchHeat, clColor);
  }

  // ============ IKAZ LAMBALARI ============
  {
    const lamps: [boolean, string, string][] = [
      [s.stalled, TR ? 'STALL' : 'STALLED', '#f85149'],
      [s.revLimiter, TR ? 'REV LİMİT' : 'REV LIMIT', '#f85149'],
      [s.wheelSpin, TR ? 'PATİNAJ' : 'WHEELSPIN', '#d29922'],
      [s.handbrake > 0.05, TR ? 'EL FRENİ' : 'HANDBRAKE', '#d29922'],
      // Motor calismiyorken vurunti anlamsizdir; yag lambasi ise
      // stall'da zaten dogru sekilde yanar ama vurunti yanmamalidir.
      [!s.stalled && s.knock > 0.9, TR ? 'VURUNTU' : 'KNOCK', '#f85149'],
      [s.oilBar < 1.0, TR ? 'YAĞ' : 'OIL', '#f85149'],
      [s.coolantC > 108, TR ? 'HARARET' : 'TEMP', '#f85149'],
      [s.clutchHeat > 0.7, TR ? 'DEBRİYAJ' : 'CLUTCH', '#d29922'],
    ];
    let lx = 12;
    const ly = h - 13;
    ctx.font = 'bold 9.5px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [on, text, color] of lamps) {
      const tw = ctx.measureText(text).width + 14;
      ctx.fillStyle = on ? color : '#151b23';
      ctx.globalAlpha = on ? 0.22 : 1;
      ctx.fillRect(lx, ly - 9, tw, 18);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = on ? color : '#2a3441';
      ctx.lineWidth = 1;
      ctx.strokeRect(lx, ly - 9, tw, 18);
      ctx.fillStyle = on ? color : '#3d4a5c';
      ctx.fillText(text, lx + 7, ly);
      lx += tw + 6;
    }
    ctx.textBaseline = 'alphabetic';
  }
}
