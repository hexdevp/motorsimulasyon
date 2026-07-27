/**
 * Surus paneli — arac icinde gercek zamanli surus
 *
 * Tuslar:  W gaz · S fren · Shift debriyaj · E vites yukari ·
 *          Q vites asagi · Space el freni · R mars
 *
 * Pedal/debriyaj/mars mantigi BURADA DEGIL, core/driverModel.ts icinde.
 * Orada saf fonksiyon oldugu icin testle dogrulanabiliyor (test/driver.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineConfig } from '../core/types';
import { buildTorqueMap, lookupTorque, lookupPoint, type TorqueMap } from '../core/sweep';
import {
  vehicleFor, initialVehicleState, stepVehicle, totalRatio, topSpeedPerGear,
  type VehicleState, type DriveResult,
} from '../core/drivetrain';
import {
  initialDriverState, stepDriver, shiftGear, engageStarter,
  type DriverState, type DriverInputs,
} from '../core/driverModel';
import { cylinderCount } from '../core/geometry';
import { firingSpec } from '../core/firing';
import {
  coolingSpecFor, stepThermal, livePressure, type ThermalMass,
} from '../core/coolingSystem';
import { leakConductanceRef, pumpCoefficientFor } from '../core/lubrication';
import { drawDrivetrain } from './driveDraw';
import { drawCluster } from './clusterDraw';
import { EngineAudio, soundProfile } from './audio';
import { Card, ChartCard, type Series } from './widgets';
import { clamp } from '../core/gas';
import { t, type Lang } from './i18n';

const RPM_TO_RAD = (2 * Math.PI) / 60;

export function DrivePanel({ cfg, lang }: { cfg: EngineConfig; lang: Lang }) {
  const [map, setMap] = useState<TorqueMap | null>(null);
  const [, force] = useState(0);
  const [gearUi, setGearUi] = useState(1);
  const [autoClutch, setAutoClutch] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [volume, setVolume] = useState(0.75);
  const [pops, setPops] = useState(true);

  const vehicle = useMemo(() => vehicleFor(cfg.id), [cfg.id]);
  const firing = useMemo(() => firingSpec(cfg.layout), [cfg.layout]);
  const displacementL = useMemo(() => (Math.PI / 4) * cfg.geometry.bore ** 2 *
    cfg.geometry.stroke * cylinderCount(cfg.layout) * 1000, [cfg]);
  const cooling = useMemo(() => coolingSpecFor(displacementL), [displacementL]);
  const lubeRef = useMemo(() => ({
    conductance: leakConductanceRef(cfg),
    pumpCoeff: pumpCoefficientFor(cfg),
  }), [cfg]);

  const keys = useRef<Set<string>>(new Set());
  const driver = useRef<DriverState>(initialDriverState());
  const state = useRef<VehicleState>(initialVehicleState(cfg.idleRpm));
  const result = useRef<DriveResult | null>(null);
  // Donen parcalarin AYRI fazlari — hepsini motordan surmek, arac
  // dururken tekerlegin donuyor gorunmesine yol acar.
  const phases = useRef({ engine: 0, gearbox: 0, wheel: 0 });
  /** Gercek krank acisi (derece, 0-720) — pistonlarin cizimi bundan surulur */
  const crankAngle = useRef(0);
  /** CANLI su ve yag sicakligi — kurulum degeri yalnizca baslangictir */
  const thermal = useRef<ThermalMass>({ coolant: 293.15, oil: 293.15 });
  const oilBarRef = useRef(0);
  const clutchHeat = useRef(0);
  const history = useRef<{ t: number; rpm: number; kmh: number }[]>([]);
  const clock = useRef(0);
  const raf = useRef(0);
  const lastTime = useRef(0);
  const audio = useRef<EngineAudio | null>(null);
  const autoClutchRef = useRef(autoClutch);
  autoClutchRef.current = autoClutch;

  const schematic = useRef<HTMLCanvasElement>(null);
  const cluster = useRef<HTMLCanvasElement>(null);

  // ---------- Ses ----------
  const profile = useMemo(() => {
    const n = cylinderCount(cfg.layout);
    const dispL = (Math.PI / 4) * cfg.geometry.bore ** 2 * cfg.geometry.stroke * n * 1000;
    return soundProfile(
      cfg.layout, n, cfg.induction.type === 'TURBO',
      cfg.redline, cfg.idleRpm, dispL,
    );
  }, [cfg]);

  useEffect(() => {
    if (!audio.current) audio.current = new EngineAudio(profile);
    else audio.current.setProfile(profile);
  }, [profile]);

  useEffect(() => () => { audio.current?.dispose(); audio.current = null; }, []);

  const toggleSound = useCallback(async () => {
    const a = audio.current;
    if (!a) return;
    if (!soundOn) {
      // Tarayici kurallari: ses ancak kullanici etkilesiminden sonra baslar
      const okStart = await a.start();
      if (!okStart) return;
      a.setEnabled(true);
      a.setVolume(volume);
      setSoundOn(true);
    } else {
      a.setEnabled(false);
      setSoundOn(false);
    }
  }, [soundOn, volume]);

  useEffect(() => {
    if (soundOn) audio.current?.setVolume(volume);
  }, [volume, soundOn]);

  useEffect(() => { audio.current?.setPops(pops); }, [pops]);

  // ---------- Tork haritasi ----------
  useEffect(() => {
    setMap(null);
    const id = window.setTimeout(() => {
      setMap(buildTorqueMap(cfg));
      state.current = initialVehicleState(cfg.idleRpm);
      driver.current = initialDriverState();
      history.current = []; clock.current = 0; clutchHeat.current = 0;
      phases.current = { engine: 0, gearbox: 0, wheel: 0 };
      crankAngle.current = 0;
      // Motor kurulumdaki sicaklikta baslar; surus boyunca DEGISIR
      thermal.current = {
        coolant: cfg.mechanical.coolantTemp,
        oil: cfg.mechanical.oilTemp,
      };
      oilBarRef.current = 0;
      setGearUi(1);
    }, 30);
    return () => window.clearTimeout(id);
  }, [cfg]);

  // ---------- Klavye ----------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 's', 'q', 'e', 'r', ' ', 'shift', 'c'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      if (k === 'e' || k === 'q') {
        if (shiftGear(driver.current, k === 'e' ? 1 : -1, vehicle.gearRatios.length)) {
          setGearUi(driver.current.gear);
          audio.current?.shift(k === 'e');
        }
        return;
      }
      // 'r' de tus kumesine EKLENMELI. Aksi halde driverModel marsi
      // "birakildi" sanip 0.25 s sonra iptal eder; tutusma 0.9 s'de
      // oldugu icin motor hicbir zaman calismaz.
      if (k === 'r') engageStarter(driver.current, state.current.running);
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.current.delete(k);
    };
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [vehicle]);

  // ---------- Cizim ----------
  const paint = useCallback((r: DriveResult) => {
    if (!map) return;
    const d = driver.current;
    const point = lookupPoint(map, r.rpm);

    const fit = (cv: HTMLCanvasElement | null) => {
      if (!cv) return null;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (w === 0 || h === 0) return null;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr; cv.height = h * dpr;
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w, h };
    };

    // CANLI degerler: kurulum sabitleri degil, o anki termal durum
    const oilBar = oilBarRef.current;
    const coolantC = thermal.current.coolant - 273.15;

    const sc = fit(schematic.current);
    if (sc) {
      drawDrivetrain(sc.ctx, sc.w, sc.h, {
        r, v: vehicle, throttle: d.throttle, brake: d.brake,
        clutch: d.clutch, handbrake: d.handbrake, gear: d.gear,
        phases: phases.current,
        crankAngle: crankAngle.current,
        cylinders: cylinderCount(cfg.layout),
        firingPhases: firing.phases.map((p) => p.phase),
        running: r.state.running,
        coolantTempC: coolantC,
        oilPressureBar: oilBar,
        clutchHeat: clutchHeat.current, lang,
      });
    }

    const cc = fit(cluster.current);
    if (cc) {
      drawCluster(cc.ctx, cc.w, cc.h, {
        rpm: r.rpm, redline: cfg.redline, idleRpm: cfg.idleRpm,
        speedKmh: r.speedKmh, gear: d.gear,
        throttle: d.throttle, brake: d.brake, clutch: d.clutch,
        handbrake: d.handbrake,
        coolantC,
        oilBar,
        boostBar: (point.map - cfg.ambient.pressure) / 1e5,
        egtC: point.egt - 273.15,
        lambda: point.lambda,
        knock: point.knockRisk,
        clutchHeat: clutchHeat.current,
        wheelSpin: r.wheelSpin, revLimiter: r.revLimiter,
        stalled: !r.state.running, lang,
      });
    }
  }, [map, vehicle, cfg, lang, firing]);

  // ---------- Ana dongu ----------
  useEffect(() => {
    if (!map) return;
    lastTime.current = performance.now();
    const maxTorque = Math.max(...map.wot, 1);

    const advance = (dt: number): DriveResult => {
      const d = driver.current;
      const k = keys.current;
      const inputs: DriverInputs = {
        throttle: k.has('w'), brake: k.has('s'), clutch: k.has('shift'),
        halfClutch: k.has('c'),
        handbrake: k.has(' '), starter: k.has('r'),
      };

      const rpmNow = state.current.engineOmega * (60 / (2 * Math.PI));
      // Vites kutusu giris mili devri — otomatik debriyaj bunu kullanir
      const inputRpm = Math.abs(state.current.wheelOmega * totalRatio(vehicle, d.gear))
        * (60 / (2 * Math.PI));
      const ds = stepDriver(
        d,
        {
          autoClutch: autoClutchRef.current, idleRpm: cfg.idleRpm,
          maxGear: vehicle.gearRatios.length, startDelay: 0.9,
        },
        inputs, rpmNow, inputRpm, state.current.running, dt,
      );

      // Mars motoru tutusturdu
      if (ds.ignited) {
        state.current.running = true;
        state.current.engineOmega = cfg.idleRpm * 1.35 * RPM_TO_RAD;
      }
      // Mars cevirirken motor krank hizinda tutulur
      if (ds.cranking && !state.current.running) {
        state.current.engineOmega = ds.crankRpm * RPM_TO_RAD;
      }

      const wasRunning = state.current.running;
      const r = stepVehicle(
        state.current, vehicle,
        { throttle: d.throttle, brake: d.brake, clutch: d.clutch,
          handbrake: d.handbrake, gear: d.gear },
        (rpm, thr) => lookupTorque(map, rpm, thr),
        map.inertia, cfg.idleRpm, cfg.redline, dt,
      );
      if (wasRunning && !r.state.running) audio.current?.stall();

      // Debriyaj isisi
      const slipPower = Math.abs(r.clutchTorque * r.clutchSlipSpeed);
      clutchHeat.current = clamp(
        clutchHeat.current + (slipPower / 45000) * dt - 0.28 * dt, 0, 1,
      );

      // ---- Canli termal durum ----
      // Yakit gucu isinin kaynagi; surtunme gucu yaga gider.
      const pt = lookupPoint(map, r.rpm);
      const fuelPower = r.state.running
        ? Math.max(pt.power, 0) / Math.max(pt.thermalEfficiency, 0.05) *
          clamp(d.throttle * 0.85 + 0.15, 0, 1)
        : 0;
      stepThermal(
        thermal.current, cooling, fuelPower, pt.frictionPower,
        r.state.speed, cfg.ambient.temperature, r.state.running, dt,
      );
      oilBarRef.current = livePressure(
        r.rpm, thermal.current.oil, cfg.mechanical.oilGrade,
        lubeRef.conductance, lubeRef.pumpCoeff,
        cfg.mechanical.oilPumpCapacity, cfg.mechanical.oilReliefPressure,
        r.state.running,
      ) / 1e5;

      // ---- Donen parcalarin fazlari, HER BIRI KENDI HIZIYLA ----
      const ph = phases.current;
      ph.engine += r.state.engineOmega * dt * 0.11;
      // Gercek krank acisi: rad/s → derece, 720°'de bir cevrim
      crankAngle.current =
        (crankAngle.current + r.state.engineOmega * dt * (180 / Math.PI)) % 720;
      ph.wheel += r.state.wheelOmega * dt;
      const n = Math.abs(totalRatio(vehicle, d.gear));
      // Saft, tekerlegin diferansiyel orani kadar hizli doner
      ph.gearbox += r.state.wheelOmega * vehicle.finalDrive * dt * 0.25;
      void n;

      return r;
    };

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime.current) / 1000, 0.05);
      lastTime.current = now;
      clock.current += dt;

      const r = advance(dt);
      result.current = r;

      history.current.push({ t: clock.current, rpm: r.rpm, kmh: r.speedKmh });
      const cutoff = clock.current - 14;
      while (history.current.length && history.current[0].t < cutoff) history.current.shift();

      // ---- Ses ----
      //
      // try/catch SART: bu blok requestAnimationFrame dongusunun icinde.
      // Buradan cikan bir istisna, asagidaki rAF cagrisina hic
      // ulasilmamasina ve simulasyonun KALICI olarak donmasina yol acar.
      // Ses ikincil bir ozellik; hicbir kosulda surusu durdurmamali.
      // Hata surekli tekrarlamasin diye ses tamamen devre disi birakilir.
      if (audio.current) {
        const point = lookupPoint(map, r.rpm);
        try {
          audio.current.update({
            rpm: r.rpm,
            throttle: driver.current.throttle,
            load: clamp(Math.abs(r.engineTorque) / maxTorque, 0, 1),
            running: r.state.running,
            cranking: driver.current.starter === 'cranking',
            crankRpm: driver.current.crankRpm,
            boost: (point.map - cfg.ambient.pressure) / 1e5,
            wheelSlip: r.slipSpeed,
            brake: driver.current.brake + driver.current.handbrake * 0.7,
            speedKmh: r.speedKmh,
            clutchSlip: r.clutchSlipSpeed,
            revLimiter: r.revLimiter,
          });
        } catch (err) {
          console.error('Ses devre disi birakildi (surus etkilenmedi):', err);
          // dispose'un kendisi de bozuk bir dugume dokunabilir; onemli
          // olan referansi birakmak, temizligin kusursuz olmasi degil.
          try { audio.current.dispose(); } catch { /* zaten bozuk */ }
          audio.current = null;
        }
      }

      paint(r);
      force((x) => x + 1);
      raf.current = requestAnimationFrame(tick);
    };

    // Ilk kareyi rAF'i beklemeden ciz — sekme arka plandayken rAF askiya
    // alinir ve gostergeler bos bir tuval olarak kalirdi.
    paint(advance(0.001));

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [map, vehicle, cfg, lang, paint, cooling, lubeRef]);

  if (!map) {
    return (
      <Card>
        <div className="center dim" style={{ padding: 30 }}>{t('buildingMap', lang)}</div>
        <div className="progress"><i style={{ width: '60%' }} /></div>
      </Card>
    );
  }

  const d = driver.current;
  const speeds = topSpeedPerGear(vehicle, cfg.redline);
  const traces: Series[] = [
    {
      label: t('rpm', lang), color: '#4a9eff',
      points: history.current.map((h) => [h.t, h.rpm] as [number, number]),
    },
    {
      label: `${lang === 'tr' ? 'Hız' : 'Speed'} (km/s)`, color: '#3fb950', rightAxis: true,
      points: history.current.map((h) => [h.t, h.kmh] as [number, number]),
    },
  ];

  const reset = () => {
    state.current = initialVehicleState(cfg.idleRpm);
    driver.current = initialDriverState();
    history.current = []; clock.current = 0; clutchHeat.current = 0;
    phases.current = { engine: 0, gearbox: 0, wheel: 0 };
    setGearUi(1);
  };

  const killEngine = () => {
    state.current.running = false;
    driver.current.starter = 'off';
  };

  return (
    <>
      <Card>
        <div className="row wrap">
          <span className="dim">{vehicle.name}</span>
          <span className="dim">· {vehicle.mass} kg · {vehicle.layout} ·{' '}
            {vehicle.gearRatios.length} {lang === 'tr' ? 'vites' : 'speed'}</span>
          <div style={{ flex: 1 }} />
          <button className={soundOn ? 'primary' : ''} onClick={toggleSound}>
            {soundOn ? '🔊' : '🔇'} {t('sound', lang)}
          </button>
          {soundOn && (
            <>
              <input type="range" min={0} max={1} step={0.05} value={volume}
                style={{ width: 90 }}
                onChange={(e) => setVolume(parseFloat(e.target.value))} />
              <label className="dim row" style={{ gap: 5 }}>
                <input type="checkbox" checked={pops}
                  onChange={(e) => setPops(e.target.checked)} />
                {t('exhaustPops', lang)}
              </label>
            </>
          )}
          <label className="dim row" style={{ gap: 5 }}>
            <input type="checkbox" checked={autoClutch}
              onChange={(e) => setAutoClutch(e.target.checked)} />
            {t('autoClutch', lang)}
          </label>
          <button onClick={killEngine}>{t('killEngine', lang)}</button>
          <button onClick={reset}>{t('reset', lang)}</button>
        </div>
        <div className="keyhelp mt8">
          {([
            ['W', t('keyThrottle', lang), d.throttle > 0.02],
            ['S', t('keyBrake', lang), d.brake > 0.02],
            ['Shift', t('keyClutch', lang), d.clutch > 0.9],
            ['C', t('keyHalfClutch', lang), d.clutch > 0.02 && d.clutch <= 0.9],
            ['E', t('keyUpshift', lang), false],
            ['Q', t('keyDownshift', lang), false],
            ['Space', t('keyHandbrake', lang), d.handbrake > 0.02],
            ['R', t('keyStart', lang), d.starter === 'cranking'],
          ] as const).map(([key, lbl, held]) => (
            <span key={key} className={`keycap ${held ? 'on' : ''}`}>
              <b>{key}</b> {lbl}
            </span>
          ))}
        </div>
        {!soundOn && (
          <div className="hint mt8">{t('soundHint', lang)}</div>
        )}
      </Card>

      <div className="chartcard" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <canvas ref={cluster} style={{ width: '100%', height: 250, display: 'block' }} />
      </div>

      <div className="chartcard" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <canvas ref={schematic} style={{ width: '100%', height: 260, display: 'block' }} />
      </div>

      <div className="grid2">
        <ChartCard title={`${t('rpm', lang)} / ${lang === 'tr' ? 'Hız' : 'Speed'}`}
          series={traces} height={190} xLabel="s" yZero={false} />
        <Card title={t('gearSpeeds', lang)}>
          <table className="data">
            <thead>
              <tr>
                <th>{lang === 'tr' ? 'Vites' : 'Gear'}</th>
                <th>{lang === 'tr' ? 'Oran' : 'Ratio'}</th>
                <th>{lang === 'tr' ? 'Toplam' : 'Total'}</th>
                <th>{lang === 'tr' ? 'Kırmızı çizgide' : 'At redline'}</th>
              </tr>
            </thead>
            <tbody>
              {vehicle.gearRatios.map((g, i) => (
                <tr key={i} style={{
                  background: gearUi === i + 1 ? 'rgba(74,158,255,0.12)' : undefined,
                }}>
                  <td><b>{i + 1}</b></td>
                  <td>{g.toFixed(2)}</td>
                  <td>{totalRatio(vehicle, i + 1).toFixed(2)}</td>
                  <td>{speeds[i].toFixed(0)} km/s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
