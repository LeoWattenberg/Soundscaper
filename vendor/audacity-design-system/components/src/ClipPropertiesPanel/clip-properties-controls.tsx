/* SPDX-License-Identifier: GPL-3.0-only
 * Selective port from audacity-design-system 20ce5547. Split for module ownership. */
import React from 'react';
import { NumberStepper } from '../NumberStepper';
import { Dropdown, type DropdownOption } from '../Dropdown';
import type { FadeShape } from '../utils/clipCrossfades';
import { useClipPropertiesText } from './clip-properties-localization';
import { FadeGlyph } from './clip-properties-glyphs';
import { MIXED, TOOLTIP_DELAY_MS, type Mixed, type ClipPropertiesClip, type ClipPropertiesShapeOption } from './clip-properties-types';
const fmt = (n: number, digits = 3) => (Math.round(n * 10 ** digits) / 10 ** digits).toString();
const clamp = (n: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
export function usePanelTooltip() {
  const [tip, setTip] = React.useState<{ text: string; x: number; y: number } | null>(null);
  const timer = React.useRef<number | null>(null);
  const armed = React.useRef<HTMLElement | null>(null);
  const clear = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };
  const hide = () => { clear(); armed.current = null; setTip(null); };
  React.useEffect(() => clear, []);
  const onMouseOver = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tooltip]');
    const text = el?.dataset.tooltip;
    if (!el || !text) { hide(); return; }
    if (el === armed.current) return;
    clear();
    armed.current = el;
    setTip(null);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const r = el.getBoundingClientRect();
      setTip({ text, x: r.left + r.width / 2, y: r.top });
    }, TOOLTIP_DELAY_MS);
  };
  const onMouseOut = (e: React.MouseEvent) => {
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-tooltip]');
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (from && to && from.contains(to)) return; // still inside the same control
    hide();
  };
  return { tip, handlers: { onMouseOver, onMouseOut, onMouseDown: hide, onWheel: hide } };
}

// ── Fields ────────────────────────────────────────────────────────────

/** A glyph beside a stepper, in one bordered field. The arrows commit
 *  at once; typing holds a draft that commits on Enter or blur when it
 *  parses, and Escape reverts — the field never holds a bad number. A
 *  MIXED value shows blank with "Mixed" and no arrows. */
export function NumberField({ value, onCommit, disabled, step = 1, min, max, digits = 3, testId, label, glyph }: {
  value: number | Mixed;
  onCommit?: (n: number) => void;
  disabled?: boolean;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  testId: string;
  label: string;
  glyph: React.ReactNode;
}) {
  const t = useClipPropertiesText();
  const [draft, setDraftState] = React.useState<string | null>(null);
  // Mirrored in a ref: Enter and Escape call blur(), and the blur
  // handler runs BEFORE React re-renders — reading the state there
  // would commit a draft Escape had just thrown away (or commit Enter's
  // twice)
  const draftRef = React.useRef<string | null>(null);
  const setDraft = (d: string | null) => { draftRef.current = d; setDraftState(d); };
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setDraft(null); }, [value]);
  React.useEffect(() => { inputRef.current?.setAttribute('aria-label', label); }, [label]);
  const mixed = value === MIXED;
  const shown = draft ?? (mixed ? '' : fmt(value, digits));
  const commitText = (text: string) => {
    const n = Number(text.trim());
    if (text.trim() === '' || !Number.isFinite(n)) return;
    const next = clamp(n, min, max);
    if (mixed || next !== value) onCommit?.(next);
  };
  const commitDraft = () => {
    const d = draftRef.current;
    if (d === null) return;
    setDraft(null);
    commitText(d);
  };
  return (
    <div
      className="clip-properties__field clip-properties__field--number"
      data-clip-properties-field={testId}
      data-mixed={mixed ? 'true' : undefined}
      data-tooltip={label}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commitDraft(); inputRef.current?.blur(); }
        if (e.key === 'Escape') { setDraft(null); inputRef.current?.blur(); e.stopPropagation(); }
      }}
      onBlur={(e) => { if (e.target === inputRef.current) commitDraft(); }}
    >
      <span className="clip-properties__glyph-cell">{glyph}</span>
      <NumberStepper
        ref={inputRef}
        value={shown}
        placeholder={mixed ? t('Mixed') : undefined}
        step={step}
        min={min}
        max={max}
        disabled={disabled || !onCommit}
        onChange={(v) => {
          // The arrows change the value with the input UNFOCUSED: a
          // deliberate edit, committed at once. Typing is a draft.
          if (document.activeElement !== inputRef.current) { setDraft(null); commitText(v); }
          else setDraft(v);
        }}
      />
      <span className="clip-properties__sr" >{label}</span>
    </div>
  );
}

/** A glyph beside a value that cannot be edited, in the same field look */
export function ReadField({ testId, label, glyph, children }: { testId: string; label: string; glyph: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="clip-properties__field clip-properties__field--read" data-clip-properties-field={testId} data-tooltip={label}>
      <span className="clip-properties__glyph-cell">{glyph}</span>
      <span className="clip-properties__value">{children}</span>
      <span className="clip-properties__sr">{label}</span>
    </div>
  );
}

/** The shape picker: a dropdown of the presets by name (user decision
 *  2026-10-06, replacing the segmented row of curves), the current
 *  preset's curve as the field's glyph. A shape between presets reads
 *  "Custom" with the clip's own curve; a mixed selection reads "Mixed". */
export function ShapePicker({ side, shapes, current, own, onPick, disabled }: {
  side: 'in' | 'out';
  shapes: ReadonlyArray<ClipPropertiesShapeOption>;
  current: string | Mixed | undefined;
  /** The clip's own curve, drawn when no preset matches */
  own: FadeShape | undefined;
  onPick?: (id: string) => void;
  disabled?: boolean;
}) {
  const t = useClipPropertiesText();
  const label = t(side === 'in' ? 'Fade in shape' : 'Fade out shape');
  const preset = current === MIXED ? undefined : shapes.find((s) => s.id === current);
  const options: DropdownOption[] = shapes.map((s) => ({ value: s.id, label: s.label }));
  return (
    <div
      className="clip-properties__field clip-properties__field--select clip-properties__field--shape"
      data-clip-properties-field={`shape-${side}`}
      data-shape={preset?.id}
      data-mixed={current === MIXED ? 'true' : undefined}
      data-tooltip={label}
    >
      <span className="clip-properties__glyph-cell">
        <FadeGlyph side={side} shape={preset ? preset.shape : own} title={preset?.label ?? (current === MIXED ? t('Mixed') : t('Custom'))} dim={!preset} />
      </span>
      <Dropdown
        options={options}
        value={preset?.id ?? ''}
        placeholder={current === MIXED ? t('Mixed') : t('Custom')}
        onChange={(v) => onPick?.(v)}
        disabled={disabled || !onPick}
        width="100%"
      />
      <span className="clip-properties__sr">{label}</span>
    </div>
  );
}

export const Row = ({ children, three }: { children: React.ReactNode; three?: boolean }) => (
  <div className={`clip-properties__row${three ? ' clip-properties__row--three' : ''}`}>{children}</div>
);

/** The clip's edge handles step by this much per arrow key, source seconds */
const STRIP_KEY_STEP = 0.1;

/** The clip strip: the source as a lane, the clip as a block in it,
 *  fades as wedges, trims as the block's edge handles — drag or arrow
 *  them. Lengths along the lane are SOURCE seconds; the clip's visible
 *  length is its timeline length through the stretch. */
export function ClipStrip({ clip, onTrimStartChange, onTrimEndChange }: {
  clip: ClipPropertiesClip;
  onTrimStartChange?: (seconds: number) => void;
  onTrimEndChange?: (seconds: number) => void;
}) {
  const t = useClipPropertiesText();
  const laneRef = React.useRef<HTMLDivElement>(null);
  const source = Math.max(clip.fullDuration, 0.001);
  const [preview, setPreview] = React.useState<{ side: 'start' | 'end'; value: number } | null>(null);
  const head = preview?.side === 'start' ? preview.value : clip.trimStart;
  const shown = clip.duration / clip.stretchFactor - (head - clip.trimStart) - (preview?.side === 'end' ? preview.value - Math.max(0, source - clip.trimStart - clip.duration / clip.stretchFactor) : 0);
  const trimEnd = Math.max(0, source - clip.trimStart - shown);
  const pct = (seconds: number) => `${Math.max(0, Math.min(100, (seconds / source) * 100))}%`;
  // Fades are timeline seconds; on the lane they are source seconds
  const fadeInPct = pct(clip.fadeIn / clip.stretchFactor);
  const fadeOutPct = pct(clip.fadeOut / clip.stretchFactor);

  // A drag from an edge: the pointer's travel along the lane, in
  // source seconds, moves that trim from where it was at the press
  const drag = React.useRef<{ side: 'start' | 'end'; x0: number; value0: number; pending: number } | null>(null);
  const secondsPerPx = () => {
    const w = laneRef.current?.getBoundingClientRect().width ?? 0;
    return w > 0 ? source / w : 0;
  };
  const onPointerDown = (side: 'start' | 'end') => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const value0 = side === 'start' ? clip.trimStart : trimEnd;
    drag.current = { side, x0: e.clientX, value0, pending: value0 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const travel = (e.clientX - d.x0) * secondsPerPx();
    // The head grows as the pointer goes right; the tail as it goes left
    const other = d.side === 'start' ? trimEnd : clip.trimStart;
    d.pending = Math.max(0, Math.min(source - other - 0.000001, d.value0 + (d.side === 'start' ? travel : -travel)));
    setPreview({ side: d.side, value: d.pending });
  };
  const cancel = () => { drag.current = null; setPreview(null); };
  const onPointerUp = () => {
    const d = drag.current; cancel();
    if (d && d.pending !== d.value0) {
      if (d.side === 'start') onTrimStartChange?.(d.pending); else onTrimEndChange?.(d.pending);
    }
  };
  const onKeyDown = (side: 'start' | 'end') => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? 10 : 1) * STRIP_KEY_STEP * (e.key === 'ArrowRight' ? 1 : -1);
    // Right grows the head, shrinks the tail — the handle moves right
    if (side === 'start') onTrimStartChange?.(Math.max(0, clip.trimStart + step));
    else onTrimEndChange?.(Math.max(0, trimEnd - step));
  };
  const handle = (side: 'start' | 'end') => (
    <button
      type="button"
      className={`clip-properties__strip-handle clip-properties__strip-handle--${side}`}
      data-clip-properties-handle={`trim-${side}`}
      data-tooltip={t(side === 'start' ? 'Trim start' : 'Trim end')}
      aria-label={t(side === 'start' ? 'Trim start' : 'Trim end')}
      disabled={side === 'start' ? !onTrimStartChange : !onTrimEndChange}
      onPointerDown={onPointerDown(side)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown(side)}
    />
  );
  return (
    <div className="clip-properties__strip" data-clip-properties-field="strip" data-tooltip={t('Clip in its source')}>
      <div className="clip-properties__strip-lane" ref={laneRef}>
        <div
          className="clip-properties__strip-clip"
          data-swatch={clip.color && clip.color !== 'track' ? clip.color : clip.trackColor ?? 'track'}
          style={{ left: pct(head), width: pct(shown) }}
        >
          {clip.fadeIn > 0 && <span className="clip-properties__strip-fade clip-properties__strip-fade--in" style={{ width: fadeInPct }} />}
          {clip.fadeOut > 0 && <span className="clip-properties__strip-fade clip-properties__strip-fade--out" style={{ width: fadeOutPct }} />}
          {handle('start')}
          {handle('end')}
        </div>
      </div>
      <span className="clip-properties__sr">{t('Clip in its source')}</span>
    </div>
  );
}

/** A section's heading, with Figma's right-hand action slot: a small
 *  text button (Reset), shown whenever the section has one */
export function SectionHeader({ children, action, actionId, actionTip, onAction, actionDisabled }: {
  children: React.ReactNode;
  action?: string;
  actionId?: string;
  actionTip?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <h3 className="clip-properties__section">
      <span>{children}</span>
      {action && (
        <button
          type="button"
          className="clip-properties__section-action"
          data-clip-properties-action={actionId}
          data-tooltip={actionTip}
          onClick={onAction}
          disabled={actionDisabled || !onAction}
        >
          {action}
        </button>
      )}
    </h3>
  );
}

/** A glyph beside a dropdown, in the field look */
export function SelectField({ testId, label, glyph, options, value, onChange, disabled }: {
  testId: string;
  label: string;
  glyph: React.ReactNode;
  options: DropdownOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="clip-properties__field clip-properties__field--select" data-clip-properties-field={testId} data-tooltip={label}>
      <span className="clip-properties__glyph-cell">{glyph}</span>
      <Dropdown options={options} value={value} onChange={onChange} disabled={disabled} width="100%" />
      <span className="clip-properties__sr">{label}</span>
    </div>
  );
}

