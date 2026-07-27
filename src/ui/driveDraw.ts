/**
 * Aktarma organlari semasi — canli guc akisi
 *
 * Soldan saga: motor → debriyaj → vites kutusu → şaft → diferansiyel →
 * tekerlek → yol. Her baglanti, o an gecen TORKA gore kalinlasir ve
 * yon degistirir; boylece gaz verirken gucun nereden nereye aktigi,
 * frende ve motor freninde akisin nasil TERSINE dondugu gorulur.
 */

import type { DriveResult, VehicleSpec } from '../core/drivetrain';
import { clamp } from '../core/gas';

export interface DriveVisualState {
  r: DriveResult;
  v: VehicleSpec;
  throttle: number;
  brake: number;
  clutch: number;
  handbrake: number;
  gear: number;
  /**
   * Donen parcalarin AYRI fazlari (rad).
   *
   * Hepsini tek bir fazdan surmek gorsel bir yalan uretir: arac dururken
   * motor rolantide dondugu icin tekerlek de donuyormus gibi gorunur.
   * Tekerlek tekerlek hiziyla, saft/diferansiyel de aktarma orani
   * uzerinden donmeli.
   */
  phases: { engine: number; gearbox: number; wheel: number };
  /** Gercek krank acisi (derece, 0-720) — pistonlarin konumu bundan cizilir */
  crankAngle: number;
  /** Silindir sayisi */
  cylinders: number;
  /** Her silindirin atesleme fazi (cevrim derecesi) */
  firingPhases: number[];
  /** Motor calisiyor mu — yanma parlamasi icin */
  running: boolean;
  coolantTempC: number;
  oilPressureBar: number;
  clutchHeat: number;
  lang: 'tr' | 'en';
}

const C = {
  metal: '#8b98a9', metalDark: '#5d6875', body: '#2f3a49',
  drive: '#3fb950', overrun: '#4a9eff', brake: '#f85149',
  slip: '#d29922', text: '#d7dee8', dim: '#8b98a9', faint: '#5d6875',
};

/** Guc akis oku — kalinlik torkla, renk yonle */
function flowArrow(
  ctx: CanvasRenderingContext2D,
  x0: number, x1: number, y: number,
  torque: number, maxTorque: number, slipping: boolean,
) {
  const mag = clamp(Math.abs(torque) / Math.max(maxTorque, 1), 0, 1);
  if (mag < 0.008) {
    ctx.strokeStyle = '#2a3441';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const forward = torque >= 0;
  ctx.strokeStyle = slipping ? C.slip : forward ? C.drive : C.overrun;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 2 + 7 * mag;
  ctx.lineCap = 'round';
  const a = forward ? x0 : x1;
  const b = forward ? x1 : x0;
  ctx.beginPath();
  ctx.moveTo(a, y);
  ctx.lineTo(b - Math.sign(b - a) * 9, y);
  ctx.stroke();
  ctx.lineCap = 'butt';
  const d = Math.sign(b - a);
  ctx.beginPath();
  ctx.moveTo(b, y);
  ctx.lineTo(b - d * 11, y - 6 - 3 * mag);
  ctx.lineTo(b - d * 11, y + 6 + 3 * mag);
  ctx.closePath();
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color = C.dim) {
  ctx.fillStyle = color;
  ctx.font = '10.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function valueLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color = C.text) {
  ctx.fillStyle = color;
  ctx.font = 'bold 11px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

export function drawDrivetrain(
  ctx: CanvasRenderingContext2D, w: number, h: number, st: DriveVisualState,
) {
  const { r, v, lang } = st;
  const TR = lang === 'tr';
  ctx.clearRect(0, 0, w, h);

  const y = h * 0.46;
  // Istasyon merkezleri (orantili yerlesim)
  const X = {
    engine: w * 0.085,
    clutch: w * 0.245,
    gearbox: w * 0.395,
    shaft: w * 0.545,
    diff: w * 0.675,
    wheel: w * 0.855,
  };

  const maxT = Math.max(v.clutchCapacity * 1.1, 400);
  const maxWheelT = maxT * Math.abs(st.gear !== 0 ? 3.5 : 1) * 3;

  // ---------- Baglanti oklari ----------
  flowArrow(ctx, X.engine + 42, X.clutch - 30, y, r.engineTorque, maxT, false);
  flowArrow(ctx, X.clutch + 30, X.gearbox - 34, y,
    r.clutchSlipping ? r.clutchTorque : r.engineTorque, maxT, r.clutchSlipping);
  flowArrow(ctx, X.gearbox + 34, X.shaft - 18, y, r.wheelTorque / 4, maxWheelT / 4, false);
  flowArrow(ctx, X.shaft + 18, X.diff - 26, y, r.wheelTorque / 4, maxWheelT / 4, false);
  flowArrow(ctx, X.diff + 26, X.wheel - 36, y, r.wheelTorque, maxWheelT, r.wheelSpin);

  // ---------- MOTOR (pistonlu kesit) ----------
  {
    const nCyl = Math.max(1, st.cylinders);
    const bw = clamp(78 / nCyl, 6.5, 18);       // silindir ic genisligi
    const gap = Math.max(2.5, bw * 0.26);
    const totalW = nCyl * bw + (nCyl - 1) * gap;
    const bx = X.engine - totalW / 2;

    const headY = y - 40;                        // kafa alt yuzeyi
    const strokePx = 26;                         // strok yuksekligi
    const pistonH = Math.max(5.5, bw * 0.52);
    const crankY = y + 34;                       // krank mili ekseni
    const crankR = 9;                            // krank yaricapi (piksel)

    // --- Blok govdesi ---
    ctx.fillStyle = '#232c38';
    ctx.fillRect(bx - 9, headY - 9, totalW + 18, crankY - headY + 22);
    ctx.strokeStyle = r.stalled ? C.brake : C.metalDark;
    ctx.lineWidth = r.stalled ? 2.5 : 1.4;
    ctx.strokeRect(bx - 9, headY - 9, totalW + 18, crankY - headY + 22);

    // --- Silindir kafasi ---
    ctx.fillStyle = C.body;
    ctx.fillRect(bx - 9, headY - 9, totalW + 18, 9);

    // --- Krank dairesi (yorunge) ---
    ctx.strokeStyle = '#2a3441';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(X.engine, crankY, crankR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < nCyl; i++) {
      const cx = bx + i * (bw + gap);
      const mid = cx + bw / 2;

      // Bu silindirin krank acisi (kendi atesleme fazina gore)
      let th = st.crankAngle - (st.firingPhases[i] ?? (i * 720) / nCyl);
      th = ((th % 720) + 720) % 720;
      const rad = (th * Math.PI) / 180;

      const down = (1 - Math.cos(rad)) / 2;
      const crownY = headY + down * strokePx;

      // Silindir bosluğu
      ctx.fillStyle = '#12181f';
      ctx.fillRect(cx, headY, bw, strokePx + pistonH + 4);

      // ---- Yanma parlamasi ----
      // Atesleme TDC'sinden sonraki ~60°'de silindir parlar; boylece
      // atesleme sirasinin silindirler arasinda dolastigi gorulur.
      if (st.running && th < 60) {
        const burn = Math.pow(1 - th / 60, 1.4);
        const gh = Math.max(crownY - headY, 2);
        const g2 = ctx.createLinearGradient(0, headY, 0, headY + gh);
        const a = (0.40 + 0.55 * clamp(st.throttle, 0.2, 1)) * burn;
        g2.addColorStop(0, `rgba(255,248,214,${a})`);
        g2.addColorStop(0.55, `rgba(255,166,54,${a * 0.85})`);
        g2.addColorStop(1, `rgba(226,88,22,${a * 0.3})`);
        ctx.fillStyle = g2;
        ctx.fillRect(cx, headY, bw, gh);
      }

      // ---- Supaplar ----
      // Emme (yesil) ve egzoz (kirmizi). Emme zamaninda emme, egzoz
      // zamaninda egzoz supabi acilir — zaman sirasi gozle takip edilir.
      const inIntake = th >= 360 && th < 540;
      const inExhaust = th >= 180 && th < 360;
      const vLift = (open: boolean, phase: number) =>
        open ? Math.sin(((phase % 180) / 180) * Math.PI) * 4 : 0;
      const vw = Math.max(2, bw * 0.3);
      // Emme
      ctx.fillStyle = inIntake ? '#3fb950' : '#4a5563';
      ctx.fillRect(mid - bw * 0.28 - vw / 2, headY - 7 + vLift(inIntake, th), vw, 7);
      // Egzoz
      ctx.fillStyle = inExhaust ? '#f85149' : '#4a5563';
      ctx.fillRect(mid + bw * 0.28 - vw / 2, headY - 7 + vLift(inExhaust, th), vw, 7);

      // ---- Piston ----
      ctx.fillStyle = '#c3ccd7';
      ctx.fillRect(cx + 0.5, crownY, bw - 1, pistonH);
      // Segmanlar
      ctx.fillStyle = '#6b7887';
      ctx.fillRect(cx + 0.5, crownY + pistonH * 0.32, bw - 1, Math.max(1, pistonH * 0.11));
      ctx.fillRect(cx + 0.5, crownY + pistonH * 0.55, bw - 1, Math.max(1, pistonH * 0.11));

      // ---- Biyel: kendi krank pimine ----
      // Her silindirin pimi krank dairesi uzerinde KENDI acisindadir;
      // hepsini tek noktaya baglamak dagimik bir yelpaze uretir ve
      // krank dizilimini yanlis gosterir.
      const pinX = X.engine + Math.sin(rad) * crankR;
      const pinY2 = crankY + Math.cos(rad) * crankR;
      ctx.strokeStyle = '#8b98a9';
      ctx.lineWidth = Math.max(1.3, bw * 0.11);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mid, crownY + pistonH - 1);
      ctx.lineTo(pinX, pinY2);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // Krank pimi
      ctx.fillStyle = '#d7dee8';
      ctx.beginPath();
      ctx.arc(pinX, pinY2, Math.max(1.8, bw * 0.11), 0, Math.PI * 2);
      ctx.fill();

      // Gomlek duvarlari
      ctx.strokeStyle = '#39434f';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, headY, bw, strokePx + pistonH + 4);
    }

    // --- Ana muylu ---
    ctx.fillStyle = '#4a5563';
    ctx.beginPath(); ctx.arc(X.engine, crankY, 5, 0, Math.PI * 2); ctx.fill();

    label(ctx, X.engine, y - 42, TR ? 'MOTOR' : 'ENGINE');
    valueLabel(ctx, X.engine, y + 50, `${r.rpm.toFixed(0)} rpm`);
    valueLabel(ctx, X.engine, y + 64, `${r.engineTorque.toFixed(0)} N·m`,
      r.engineTorque >= 0 ? C.drive : C.overrun);
    if (r.revLimiter) {
      ctx.fillStyle = C.brake;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(TR ? 'REV LİMİT' : 'REV LIMIT', X.engine, y - 52);
    }
    if (r.stalled) {
      ctx.fillStyle = C.brake;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(TR ? 'STALL' : 'STALLED', X.engine, y - 52);
    }
  }

  // ---------- DEBRIYAJ ----------
  {
    // Pedal basildikca diskler ayrilir
    const gap = 4 + st.clutch * 15;
    const heat = clamp(st.clutchHeat, 0, 1);
    ctx.fillStyle = C.metal;
    ctx.fillRect(X.clutch - gap - 8, y - 26, 8, 52);
    // Baski diski — kayma isindikca kizarir
    ctx.fillStyle = heat > 0.05
      ? `rgb(${139 + 116 * heat},${152 - 80 * heat},${169 - 120 * heat})`
      : C.metal;
    ctx.fillRect(X.clutch + gap, y - 26, 8, 52);

    if (r.clutchSlipping && Math.abs(r.clutchSlipSpeed) > 1) {
      // Kayma kivilcimlari
      ctx.strokeStyle = C.slip;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        const a = st.phases.engine * 3 + (i * Math.PI * 2) / 5;
        const rr = 26 + 5 * Math.sin(st.phases.engine * 8 + i);
        ctx.beginPath();
        ctx.moveTo(X.clutch, y);
        ctx.lineTo(X.clutch + Math.cos(a) * rr * 0.35, y + Math.sin(a) * rr);
        ctx.stroke();
      }
    }
    label(ctx, X.clutch, y - 42, TR ? 'DEBRİYAJ' : 'CLUTCH');
    const state = st.clutch > 0.85 ? (TR ? 'AYRIK' : 'OPEN')
      : r.clutchSlipping ? (TR ? 'KAYIYOR' : 'SLIPPING')
      : (TR ? 'KAVRADI' : 'LOCKED');
    valueLabel(ctx, X.clutch, y + 50, state,
      st.clutch > 0.85 ? C.faint : r.clutchSlipping ? C.slip : C.drive);
    if (r.clutchSlipping) {
      valueLabel(ctx, X.clutch, y + 64,
        `Δ${Math.abs(r.clutchSlipSpeed * 9.549).toFixed(0)} rpm`, C.slip);
    }
  }

  // ---------- VITES KUTUSU ----------
  {
    ctx.fillStyle = C.body;
    ctx.fillRect(X.gearbox - 34, y - 30, 68, 60);
    ctx.strokeStyle = C.metalDark; ctx.lineWidth = 1.5;
    ctx.strokeRect(X.gearbox - 34, y - 30, 68, 60);
    // Disliler
    for (let i = 0; i < 3; i++) {
      const gx = X.gearbox - 18 + i * 18;
      const active = st.gear !== 0 && i === Math.min(2, Math.abs(st.gear) - 1) % 3;
      ctx.strokeStyle = active ? C.drive : C.metalDark;
      ctx.lineWidth = active ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(gx, y, active ? 12 : 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    label(ctx, X.gearbox, y - 42, TR ? 'VİTES' : 'GEARBOX');
    const gearLabel = st.gear === 0 ? 'N' : st.gear < 0 ? 'R' : String(st.gear);
    ctx.fillStyle = st.gear === 0 ? C.faint : C.text;
    ctx.font = 'bold 22px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(gearLabel, X.gearbox, y + 8);
    const ratio = st.gear > 0 ? v.gearRatios[st.gear - 1] : 0;
    valueLabel(ctx, X.gearbox, y + 50,
      st.gear === 0 ? (TR ? 'BOŞTA' : 'NEUTRAL') : `${ratio.toFixed(2)}:1`,
      st.gear === 0 ? C.faint : C.dim);
  }

  // ---------- SAFT ----------
  {
    ctx.strokeStyle = C.metal;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(X.shaft - 16, y); ctx.lineTo(X.shaft + 16, y);
    ctx.stroke();
    // Donusu gosteren isaret
    const spin = Math.sin(st.phases.gearbox * 2) * 7;
    ctx.strokeStyle = C.metalDark; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X.shaft, y - 7); ctx.lineTo(X.shaft + spin, y + 7);
    ctx.stroke();
    label(ctx, X.shaft, y - 42, TR ? 'ŞAFT' : 'SHAFT');
  }

  // ---------- DIFERANSIYEL ----------
  {
    ctx.fillStyle = C.body;
    ctx.beginPath(); ctx.arc(X.diff, y, 24, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.metalDark; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = C.metal; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X.diff, y, 13, st.phases.gearbox, st.phases.gearbox + 4.2);
    ctx.stroke();
    label(ctx, X.diff, y - 42, TR ? 'DİFERANSİYEL' : 'DIFF');
    valueLabel(ctx, X.diff, y + 50, `${v.finalDrive.toFixed(2)}:1`, C.dim);
    ctx.fillStyle = C.faint;
    ctx.font = '10px sans-serif';
    ctx.fillText(v.layout, X.diff, y + 64);
  }

  // ---------- TEKERLEK ----------
  {
    const wr = 34;
    // Lastik
    ctx.fillStyle = '#1a222c';
    ctx.beginPath(); ctx.arc(X.wheel, y, wr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = r.wheelSpin ? C.slip : C.metalDark;
    ctx.lineWidth = r.wheelSpin ? 3 : 2;
    ctx.stroke();

    // Jant — donusu gosteren parmaklar
    ctx.save();
    ctx.translate(X.wheel, y);
    ctx.rotate(st.phases.wheel);
    ctx.strokeStyle = C.metal; ctx.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (wr - 9), Math.sin(a) * (wr - 9));
      ctx.stroke();
    }
    // Fren diski — frenlerken kizarir
    const bglow = clamp(st.brake + st.handbrake * 0.8, 0, 1);
    ctx.fillStyle = bglow > 0.03
      ? `rgba(248,81,73,${0.25 + 0.7 * bglow})` : '#3d4a5c';
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Patinaj isareti
    if (r.wheelSpin) {
      ctx.strokeStyle = C.slip; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(X.wheel, y, wr + 5 + i * 5,
          st.phases.wheel * 3 + i, st.phases.wheel * 3 + i + 1.1);
        ctx.stroke();
      }
      ctx.fillStyle = C.slip;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(TR ? 'PATİNAJ' : 'WHEELSPIN', X.wheel, y - wr - 14);
    }

    label(ctx, X.wheel, y - 42 - (r.wheelSpin ? 14 : 0), TR ? 'TEKERLEK' : 'WHEEL');
    valueLabel(ctx, X.wheel, y + 50, `${r.speedKmh.toFixed(0)} km/s`);
    valueLabel(ctx, X.wheel, y + 64,
      `${(r.tractionForce / 1000).toFixed(2)} kN`,
      r.wheelSpin ? C.slip : r.tractionForce >= 0 ? C.drive : C.overrun);
  }

  // ---------- YOL ----------
  {
    const roadY = y + 34 + 40;
    ctx.strokeStyle = '#3d4a5c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X.wheel - 60, roadY); ctx.lineTo(w - 6, roadY);
    ctx.stroke();
    // Hareket eden yol cizgileri
    const off = (st.r.state.distance * 6) % 22;
    ctx.strokeStyle = '#2a3441'; ctx.lineWidth = 3;
    for (let x = X.wheel - 60 - off; x < w; x += 22) {
      ctx.beginPath(); ctx.moveTo(x, roadY + 5); ctx.lineTo(x + 11, roadY + 5); ctx.stroke();
    }
  }

  // ---------- DIRENC KUVVETLERI ----------
  {
    const bx = w * 0.5;
    const by = h - 16;
    ctx.font = '10.5px Consolas, monospace';
    ctx.textAlign = 'left';
    const items: [string, number, string][] = [
      [TR ? 'hava' : 'drag', r.dragForce, C.dim],
      [TR ? 'yuvarlanma' : 'rolling', r.rollingForce, C.dim],
      [TR ? 'fren' : 'brake', r.brakeForce, st.brake + st.handbrake > 0.02 ? C.brake : C.faint],
      [TR ? 'çekiş' : 'traction', r.tractionForce, r.wheelSpin ? C.slip : C.drive],
      [TR ? 'ivme' : 'accel', r.acceleration, C.text],
    ];
    let x = 10;
    for (const [name, val, col] of items) {
      const txt = name === (TR ? 'ivme' : 'accel')
        ? `${name} ${val.toFixed(2)} m/s²`
        : `${name} ${(val / 1000).toFixed(2)} kN`;
      ctx.fillStyle = col;
      ctx.fillText(txt, x, by);
      x += ctx.measureText(txt).width + 18;
    }
    ctx.textAlign = 'center';
    void bx;
  }
}
