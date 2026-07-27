import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EngineConfig, SweepResult } from './core/types';
import { getPreset, DEFAULT_PRESET_ID } from './core/presets';
import { runSweep, defaultRpmList } from './core/sweep';
import {
  generateMaps, type GeneratedMaps, type MapTable, type MapProgress,
} from './core/fuelmap';
import { SetupPanel } from './ui/SetupPanel';
import { SweepPanel, CylinderPanel } from './ui/SweepPanel';
import { AnimationPanel } from './ui/AnimationPanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { DrivePanel } from './ui/DrivePanel';
import { LivePanel } from './ui/LivePanel';
import { ReportPanel } from './ui/ReportPanel';
import { FuelMapGrid } from './ui/FuelMapGrid';
import { Card } from './ui/widgets';
import { t, type Lang } from './ui/i18n';

type Tab =
  | 'setup' | 'animation' | 'sweep' | 'cylinder'
  | 'fuelmap' | 'diagnostics' | 'drive' | 'live' | 'report';

const TABS: { id: Tab; key: string }[] = [
  { id: 'setup', key: 'tabSetup' },
  { id: 'animation', key: 'tabAnimation' },
  { id: 'sweep', key: 'tabSweep' },
  { id: 'cylinder', key: 'tabCylinder' },
  { id: 'fuelmap', key: 'tabFuelMap' },
  { id: 'diagnostics', key: 'tabDiagnostics' },
  { id: 'drive', key: 'tabDrive' },
  { id: 'live', key: 'tabLive' },
  { id: 'report', key: 'tabReport' },
];

export default function App() {
  const [lang, setLang] = useState<Lang>('tr');
  const [tab, setTab] = useState<Tab>('setup');
  const [cfg, setCfg] = useState<EngineConfig>(() => getPreset(DEFAULT_PRESET_ID));
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Motor degistiginde onceki sonuclar gecersiz olur
  useEffect(() => { setSweep(null); }, [cfg]);

  const compute = useCallback(() => {
    setBusy(t('calculating', lang));
    setProgress(0);
    // Tarayicinin "hesaplanıyor" durumunu cizmesine izin ver
    window.setTimeout(() => {
      try {
        const list = defaultRpmList(cfg, 250);
        const result = runSweep(cfg, list, {}, (p) => setProgress(p.done / p.total));
        setSweep(result);
        setTab((cur) => (cur === 'setup' ? 'sweep' : cur));
      } finally {
        setBusy(null);
      }
    }, 40);
  }, [cfg, lang]);

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1>{t('appTitle', lang)}</h1>
          <div className="sub">{t('subtitle', lang)}</div>
        </div>
        <div className="spacer" />
        <div className="mono dim" style={{ fontSize: 12 }}>{cfg.name}</div>
        <button className="primary" onClick={compute} disabled={busy !== null}>
          {busy ?? t('calculate', lang)}
        </button>
        <div className="langtoggle">
          <button className={lang === 'tr' ? 'on' : ''} onClick={() => setLang('tr')}>TR</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        </div>
      </div>

      {busy && (
        <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
      )}

      <div className="tabs">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            className={`tab ${tab === tb.id ? 'active' : ''}`}
            onClick={() => setTab(tb.id)}
          >
            {t(tb.key, lang)}
          </button>
        ))}
      </div>

      <div className={`content ${tab === 'fuelmap' ? 'nopad' : ''}`}>
        {tab === 'setup' && <SetupPanel cfg={cfg} onChange={setCfg} lang={lang} />}

        {tab === 'animation' && <AnimationPanel cfg={cfg} lang={lang} />}

        {tab === 'sweep' && (sweep
          ? <SweepPanel sweep={sweep} lang={lang} />
          : <NeedsCompute lang={lang} onCompute={compute} busy={busy !== null} />)}

        {tab === 'cylinder' && <CylinderPanel cfg={cfg} lang={lang} />}

        {tab === 'fuelmap' && <FuelMapPanel cfg={cfg} lang={lang} />}

        {tab === 'diagnostics' && <DiagnosticsPanel cfg={cfg} lang={lang} />}

        {tab === 'drive' && <DrivePanel cfg={cfg} lang={lang} />}

        {tab === 'live' && <LivePanel cfg={cfg} lang={lang} />}

        {tab === 'report' && (sweep
          ? <ReportPanel sweep={sweep} lang={lang} />
          : <NeedsCompute lang={lang} onCompute={compute} busy={busy !== null} />)}
      </div>
    </div>
  );
}

function NeedsCompute({ lang, onCompute, busy }: {
  lang: Lang; onCompute: () => void; busy: boolean;
}) {
  return (
    <Card>
      <div className="center" style={{ padding: 26 }}>
        <p className="dim">
          {lang === 'tr'
            ? 'Sonuçları görmek için önce simülasyonu çalıştırın.'
            : 'Run the simulation first to see results.'}
        </p>
        <button className="primary" onClick={onCompute} disabled={busy}>
          {t('calculate', lang)}
        </button>
      </div>
    </Card>
  );
}

// ============================================================
// YAKIT HARITASI PANELI
// ============================================================

type MapKind = 'fuelPW' | 've' | 'ignition' | 'lambda' | 'duty';

const MAP_KINDS: { id: MapKind; key: string }[] = [
  { id: 'fuelPW', key: 'mapFuel' },
  { id: 've', key: 'mapVE' },
  { id: 'ignition', key: 'mapIgnition' },
  { id: 'lambda', key: 'mapLambda' },
  { id: 'duty', key: 'mapDuty' },
];

function FuelMapPanel({ cfg, lang }: { cfg: EngineConfig; lang: Lang }) {
  const [maps, setMaps] = useState<GeneratedMaps | null>(null);
  const [kind, setKind] = useState<MapKind>('fuelPW');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<MapProgress | null>(null);

  // Motor degisince harita gecersiz olur
  useEffect(() => { setMaps(null); }, [cfg]);

  const generate = useCallback(() => {
    setBusy(true);
    setProg(null);
    window.setTimeout(() => {
      try {
        setMaps(generateMaps(cfg, (p) => setProg(p)));
      } finally {
        setBusy(false);
      }
    }, 40);
  }, [cfg]);

  const table = maps?.[kind] ?? null;

  const setTable = useCallback((next: MapTable) => {
    setMaps((m) => (m ? { ...m, [kind]: next } : m));
  }, [kind]);

  const kindOptions = useMemo(() => MAP_KINDS, []);

  if (!maps) {
    return (
      <div style={{ padding: 16 }}>
        <Card>
          <div className="center" style={{ padding: 26 }}>
            <p className="dim">
              {lang === 'tr'
                ? 'Yakıt haritası, simülasyonun hesapladığı hacimsel verimden üretilir. ' +
                  'Kam, turbo veya yakıt değiştirdiğinizde harita da değişir.'
                : 'The fuel map is generated from the simulated volumetric efficiency. ' +
                  'Change the cam, turbo or fuel and the map changes with it.'}
            </p>
            <button className="primary" onClick={generate} disabled={busy}>
              {busy ? t('calculating', lang) : t('generateMap', lang)}
            </button>
            {busy && prog && (
              <>
                <div className="progress mt8">
                  <i style={{ width: `${(prog.done / prog.total) * 100}%` }} />
                </div>
                <div className="hint mt8 mono">{prog.label}</div>
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mapwrap">
      <div className="maptools">
        {kindOptions.map((k) => (
          <button
            key={k.id}
            className={`sm ${kind === k.id ? 'primary' : ''}`}
            onClick={() => setKind(k.id)}
          >
            {t(k.key, lang)}
          </button>
        ))}
        <div className="sep" />
        <button className="sm" onClick={generate} disabled={busy}>
          {busy ? t('calculating', lang) : t('regenerate', lang)}
        </button>
        <div className="spacer" style={{ flex: 1 }} />
        <span className="stat">{t('engineSpeed', lang)} →</span>
      </div>
      {table && (
        <FuelMapGrid
          table={table}
          onChange={setTable}
          lang={lang}
          maxLoadPerRpm={maps.maxMapPerRpm}
        />
      )}
    </div>
  );
}
