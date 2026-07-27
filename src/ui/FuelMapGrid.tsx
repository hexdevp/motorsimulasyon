/**
 * Fuel map izgarasi — gercek kalibrasyon yazilimlarindaki tablo davranisi
 *
 * Desteklenenler: tikla-surukle secim, Shift+ok ile secim genisletme,
 * dogrudan deger yazma, Ctrl+C / Ctrl+V (Excel uyumlu TSV), ve secili
 * bolgeye matematik islemleri.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type MapTable, type CellRange, type CellOp,
  applyCellOp, interpolateRange, smoothRange, tableToTSV, pasteTSV,
  tableExtent, normalizeRange,
} from '../core/fuelmap';
import { heatColor } from './widgets';
import { t, type Lang } from './i18n';

interface Props {
  table: MapTable;
  onChange: (t: MapTable) => void;
  lang: Lang;
  /** Her devirde ulasilabilir en yuksek MAP (kPa) — ustu soluk gosterilir */
  maxLoadPerRpm?: number[];
}

export function FuelMapGrid({ table, onChange, lang, maxLoadPerRpm }: Props) {
  const [sel, setSel] = useState<CellRange>({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null);
  const [operand, setOperand] = useState(1);
  const [flash, setFlash] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const rows = table.values.length;
  const cols = table.rpmAxis.length;
  const { min, max } = tableExtent(table);
  const s = normalizeRange(sel);

  const inSel = (r: number, c: number) =>
    r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1;

  // --- Secim istatistikleri ---
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  for (let r = s.r0; r <= s.r1; r++) {
    for (let c = s.c0; c <= s.c1; c++) {
      const v = table.values[r][c];
      sum += v; n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  const say = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(''), 1400);
  };

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const v = parseFloat(editing.text.replace(',', '.'));
    if (Number.isFinite(v)) {
      const values = table.values.map((row) => [...row]);
      values[editing.r][editing.c] = v;
      onChange({ ...table, values });
    }
    setEditing(null);
  }, [editing, table, onChange]);

  // --- Klavye ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (!wrapRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body) return;

      const move = (dr: number, dc: number, extend: boolean) => {
        e.preventDefault();
        const r = Math.max(0, Math.min(sel.r1 + dr, rows - 1));
        const c = Math.max(0, Math.min(sel.c1 + dc, cols - 1));
        setSel(extend ? { ...sel, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c });
      };

      switch (e.key) {
        case 'ArrowUp': return move(-1, 0, e.shiftKey);
        case 'ArrowDown': return move(1, 0, e.shiftKey);
        case 'ArrowLeft': return move(0, -1, e.shiftKey);
        case 'ArrowRight': return move(0, 1, e.shiftKey);
        case 'Home': e.preventDefault(); return setSel({ r0: s.r0, c0: 0, r1: s.r1, c1: 0 });
        case 'End': e.preventDefault(); return setSel({ r0: s.r0, c0: cols - 1, r1: s.r1, c1: cols - 1 });
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a') {
          e.preventDefault();
          setSel({ r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 });
        } else if (e.key === 'c') {
          e.preventDefault();
          navigator.clipboard?.writeText(tableToTSV(table, sel));
          say(t('copied', lang));
        } else if (e.key === 'v') {
          e.preventDefault();
          navigator.clipboard?.readText().then((txt) => {
            if (txt) onChange(pasteTSV(table, sel, txt));
          });
        }
        return;
      }

      // Rakam yazmaya baslayinca duzenleme moduna gec
      if (/^[0-9.,\-]$/.test(e.key)) {
        setEditing({ r: sel.r1, c: sel.c1, text: e.key });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, s.r0, s.r1, rows, cols, table, editing, onChange, lang]);

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const doOp = (op: CellOp) => {
    onChange(applyCellOp(table, sel, op, operand));
  };

  return (
    <div className="mapwrap" ref={wrapRef} tabIndex={-1}>
      <div className="maptools">
        <input
          type="number" value={operand} step={0.1}
          onChange={(e) => setOperand(parseFloat(e.target.value) || 0)}
        />
        <button className="sm" onClick={() => doOp('set')}>{t('opSet', lang)}</button>
        <button className="sm" onClick={() => doOp('add')}>{t('opAdd', lang)}</button>
        <button className="sm" onClick={() => doOp('multiply')}>{t('opMultiply', lang)}</button>
        <button className="sm" onClick={() => doOp('percent')}>{t('opPercent', lang)}</button>
        <div className="sep" />
        <button className="sm" onClick={() => onChange(interpolateRange(table, sel, 'horizontal'))}>
          {t('interpH', lang)}
        </button>
        <button className="sm" onClick={() => onChange(interpolateRange(table, sel, 'vertical'))}>
          {t('interpV', lang)}
        </button>
        <button className="sm" onClick={() => onChange(smoothRange(table, sel))}>
          {t('smooth', lang)}
        </button>
        <div className="sep" />
        <button className="sm" onClick={() => {
          navigator.clipboard?.writeText(tableToTSV(table, sel));
          say(t('copied', lang));
        }}>{t('copy', lang)}</button>
        <div className="sep" />
        <span className="stat">
          {t('selection', lang)}: <b>{n}</b> {t('cells', lang)} &nbsp;
          {t('avg', lang)} <b>{(sum / n).toFixed(table.decimals)}</b> &nbsp;
          {t('min', lang)} <b>{lo.toFixed(table.decimals)}</b> &nbsp;
          {t('max', lang)} <b>{hi.toFixed(table.decimals)}</b> {table.unit}
        </span>
        {flash && <span className="pill ok">{flash}</span>}
      </div>

      <div className="mapscroll">
        <table className="fuelmap">
          <thead>
            <tr>
              <th className="axislabel">{t('manifoldPressure', lang)}</th>
              {table.rpmAxis.map((r, i) => <th key={i}>{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.values.map((row, r) => (
              <tr key={r}>
                <th>{table.loadAxis[r].toFixed(table.loadAxis[r] % 1 ? 1 : 0)}</th>
                {row.map((v, c) => {
                  const unreachable =
                    maxLoadPerRpm !== undefined &&
                    table.loadAxis[r] > maxLoadPerRpm[c] * 1.02;
                  const isEditing = editing?.r === r && editing?.c === c;
                  const cursor = sel.r1 === r && sel.c1 === c;
                  return (
                    <td
                      key={c}
                      className={[
                        inSel(r, c) ? 'sel' : '',
                        cursor ? 'cursor' : '',
                        unreachable ? 'unreachable' : '',
                      ].join(' ').trim()}
                      style={{ background: heatColor(v, min, max) }}
                      title={unreachable ? t('unreachable', lang) : undefined}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commitEdit();
                        setDragging(true);
                        if (e.shiftKey) setSel({ ...sel, r1: r, c1: c });
                        else setSel({ r0: r, c0: c, r1: r, c1: c });
                      }}
                      onMouseEnter={() => {
                        if (dragging) setSel((p) => ({ ...p, r1: r, c1: c }));
                      }}
                      onDoubleClick={() => setEditing({ r, c, text: v.toFixed(table.decimals) })}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editing.text}
                          onChange={(e) => setEditing({ r, c, text: e.target.value })}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { commitEdit(); e.preventDefault(); }
                            if (e.key === 'Escape') setEditing(null);
                            if (e.key === 'Tab') { commitEdit(); }
                          }}
                        />
                      ) : (
                        v.toFixed(table.decimals)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint mt8">{t('mapHint', lang)}</div>
      </div>
    </div>
  );
}
