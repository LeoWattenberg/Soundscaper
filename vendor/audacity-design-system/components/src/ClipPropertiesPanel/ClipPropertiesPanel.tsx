/* SPDX-License-Identifier: GPL-3.0-only
 * Selective port from audacity-design-system 20ce5547. Split for module ownership. */
import React from 'react';
import { TextInput } from '../TextInput';
import { Dropdown, type DropdownOption } from '../Dropdown';
import { Button } from '../Button';
import { Tooltip } from '../Tooltip';
import type { FadeShape } from '../utils/clipCrossfades';
import { MIXED, PITCH_LIMIT_SEMITONES, type Mixed, type ClipPropertiesPanelProps } from './clip-properties-types';
import { StartGlyph, EndGlyph, LengthGlyph, TrimStartGlyph, TrimEndGlyph, SpanGlyph, PitchGlyph, SpeedGlyph, ExportGlyph, SampleRateGlyph, TrackGlyph, ReverseGlyph, CountGlyph, FadeGlyph } from './clip-properties-glyphs';
import { usePanelTooltip, NumberField, ReadField, ShapePicker, Row, ClipStrip, SectionHeader, SelectField } from './clip-properties-controls';
import { ClipPropertiesLabels, useClipPropertiesText } from './clip-properties-localization';
import './ClipPropertiesPanel.css';
const fmt = (n: number, digits = 3) => (Math.round(n * 10 ** digits) / 10 ** digits).toString();
const speedOf = (stretchFactor: number) => Math.round(100 / stretchFactor * 100) / 100;
export type * from './clip-properties-types';
export function ClipPropertiesPanel({ labels = {}, ...props }: ClipPropertiesPanelProps) {
  return <ClipPropertiesLabels.Provider value={labels}><ClipPropertiesPanelBody {...props} /></ClipPropertiesLabels.Provider>;
}

function ClipPropertiesPanelBody({
  clip,
  selection = null,
  colors,
  tracks = [],
  onTrackChange,
  fadeShapes,
  onRename,
  onColorChange,
  onStartChange,
  onDurationChange,
  onTrimStartChange,
  onTrimEndChange,
  onFadeChange,
  onFadeShapeChange,
  onPitchChange,
  onSpeedChange,
  onReverseChange,
  onResetPitchSpeed,
  exportFormats = [],
  exportSampleRates = [],
  onExport,
  exporting = false,
  placement = 'start',
  layout = 'stack',
}: ClipPropertiesPanelProps) {
  const t = useClipPropertiesText();
  // The name commits on Enter or blur too, so typing never renames
  // letter by letter (every keystroke would be an undo step)
  const [nameDraft, setNameDraft] = React.useState<string | null>(null);
  const nameDraftRef = React.useRef<string | null>(null);
  const setName = (value: string | null) => { nameDraftRef.current = value; setNameDraft(value); };
  React.useEffect(() => { setName(null); }, [clip?.id, clip?.name]);
  const commitName = () => {
    if (nameDraftRef.current === null || !clip) return;
    const next = nameDraftRef.current.trim();
    setName(null);
    if (next && next !== clip.name) onRename?.(next);
  };

  const colorOptions: DropdownOption[] = colors.map((c) => ({ value: c.id, label: c.label }));
  const trackOptions: DropdownOption[] = tracks.map((t) => ({ value: t.id, label: t.label }));

  // The Export block's choices live here (as Figma's do): the first
  // format and sample rate until picked
  const formatOptions: DropdownOption[] = exportFormats.map((f) => ({ value: f.id, label: f.label }));
  const rateOptions: DropdownOption[] = exportSampleRates.map((r) => ({ value: r.id, label: r.label }));
  const [formatPick, setFormatPick] = React.useState<string | null>(null);
  const [ratePick, setRatePick] = React.useState<string | null>(null);
  const format = formatPick ?? exportFormats[0]?.id ?? '';
  const sampleRate = ratePick ?? exportSampleRates[0]?.id ?? '';

  // What the fields show: the one clip, or the selection's merge
  const multi = selection && selection.count >= 2 ? selection : null;
  const subject = multi ?? clip;
  const color = multi ? multi.color : clip?.color;
  const fadeIn = multi ? multi.fadeIn : clip?.fadeIn ?? 0;
  const fadeOut = multi ? multi.fadeOut : clip?.fadeOut ?? 0;
  const fadeInShapeId = multi ? multi.fadeInShapeId : clip?.fadeInShapeId;
  const fadeOutShapeId = multi ? multi.fadeOutShapeId : clip?.fadeOutShapeId;
  // The live thumbnails draw the clip's own curve; a selection draws
  // the shared preset's, or the default when mixed
  const shapeOf = (id: string | Mixed | undefined, own: FadeShape | undefined): FadeShape | undefined =>
    multi ? (id === MIXED || id === undefined ? undefined : fadeShapes.find((s) => s.id === id)?.shape) : own;
  const inCurve = shapeOf(fadeInShapeId, clip?.fadeInShape);
  const outCurve = shapeOf(fadeOutShapeId, clip?.fadeOutShape);
  const pitch = multi ? multi.pitchSemitones : clip?.pitchSemitones ?? 0;
  const reversed: boolean | Mixed = multi ? (multi.reversed ?? false) : (clip?.reversed ?? false);
  const speed: number | Mixed = multi
    ? (multi.stretchFactor === MIXED ? MIXED : speedOf(multi.stretchFactor))
    : speedOf(clip?.stretchFactor ?? 1);
  const trackId = multi ? multi.trackId : clip?.trackId;
  // The header names the subject only where a field does not: a
  // selection's count and tracks (a single clip's track is its Track
  // field — or, with no tracks offered, the header)
  const subtitle = multi
    ? `${t('{count} clips').replace('{count}', String(multi.count))} · ${multi.trackNames.join(', ')}`
    : tracks.length > 0 ? undefined : clip?.trackName;
  const swatch = color && color !== MIXED && color !== 'track' ? color : undefined;
  const { tip, handlers: tooltipHandlers } = usePanelTooltip();

  return (
    <section
      className="clip-properties"
      data-clip-properties-panel
      data-placement={placement}
      data-layout={layout}
      data-selection={multi ? multi.count : undefined}
      aria-label={t('Clip properties')}
      {...tooltipHandlers}
    >
      {tip && <Tooltip content={tip.text} x={tip.x} y={tip.y} />}
      {/* No title of its own: the dock tab or window already says
          "Clip properties" (2026-10-06); the header is the subject —
          the track, or the selection's count and tracks */}
      {subject && subtitle && (
        <header className="clip-properties__header">
          <span className="clip-properties__subtitle">{subtitle}</span>
        </header>
      )}

      {!subject ? (
        <p className="clip-properties__empty" data-clip-properties-empty>
          {t('No clip selected. Select a clip, or right-click one and choose Clip properties.')}
        </p>
      ) : (
        <div className="clip-properties__body" data-clip-properties-clip={multi ? undefined : clip?.id}>
          <div className="clip-properties__group" data-group="clip">
          <h3 className="clip-properties__section">{multi ? t('Clips') : t('Clip')}</h3>
          {multi ? (
            <Row>
              <ReadField testId="count" label={t('Selected clips')} glyph={<CountGlyph />}>{t('{count} clips').replace('{count}', String(multi.count))}</ReadField>
            </Row>
          ) : clip && (
            <Row>
              <div
                className="clip-properties__field clip-properties__field--text clip-properties__field--wide"
                ref={(node) => { node?.querySelector('input')?.setAttribute('aria-label', t('Clip name')); }}
                data-clip-properties-field="name"
                data-tooltip={t('Clip name')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { commitName(); (e.target as HTMLElement).blur(); }
                  if (e.key === 'Escape') { setName(null); (e.target as HTMLElement).blur(); e.stopPropagation(); }
                }}
              >
                <TextInput
                  value={nameDraft ?? clip.name}
                  onChange={setName}
                  onBlur={commitName}
                  disabled={!onRename}
                  className="clip-properties__input"
                  tabIndex={0}
                />
                <span className="clip-properties__sr">{t('Clip name')}</span>
              </div>
            </Row>
          )}
          {tracks.length > 0 && (
            <Row>
              <div
                className="clip-properties__field clip-properties__field--select clip-properties__field--wide"
                data-clip-properties-field="track"
                data-mixed={trackId === MIXED ? 'true' : undefined}
                data-tooltip={t('Track')}
              >
                <span className="clip-properties__glyph-cell"><TrackGlyph /></span>
                <Dropdown
                  options={trackOptions}
                  value={trackId === MIXED ? '' : trackId ?? ''}
                  placeholder={trackId === MIXED ? t('Mixed') : undefined}
                  onChange={(v) => { if (v !== trackId) onTrackChange?.(v); }}
                  disabled={!onTrackChange}
                  width="100%"
                />
                <span className="clip-properties__sr">{t('Track')}</span>
              </div>
            </Row>
          )}
          <Row>
            <div className="clip-properties__field clip-properties__field--select clip-properties__field--wide" data-clip-properties-field="color" data-tooltip={t('Clip color')}>
              <span className="clip-properties__glyph-cell">
                <span className="clip-properties__swatch" data-swatch={swatch ?? (color === MIXED ? 'mixed' : 'track')} aria-hidden="true" />
              </span>
              <Dropdown
                options={colorOptions}
                value={color === MIXED ? '' : color ?? ''}
                placeholder={color === MIXED ? t('Mixed') : t('Track color')}
                onChange={(v) => onColorChange?.(v)}
                disabled={!onColorChange}
                width="100%"
              />
              <span className="clip-properties__sr">{t('Clip color')}</span>
            </div>
          </Row>
          {!multi && clip?.groupId && (
            <Row>
              <ReadField testId="group" label={t('Group')} glyph={<CountGlyph />}>{clip.groupId}</ReadField>
            </Row>
          )}
          </div>

          <div className="clip-properties__group" data-group="position">
          <h3 className="clip-properties__section">{t('Position')}</h3>
          {multi ? (
            <>
              <Row>
                <ReadField testId="first-start" label={t('First start')} glyph={<StartGlyph />}>{fmt(multi.start)} s</ReadField>
                <ReadField testId="last-end" label={t('Last end')} glyph={<EndGlyph />}>{fmt(multi.end)} s</ReadField>
              </Row>
              <Row>
                <ReadField testId="span" label={t('Span')} glyph={<SpanGlyph />}>{fmt(multi.end - multi.start)} s</ReadField>
              </Row>
            </>
          ) : clip && (
            <>
              {/* Start, length and end are one statement (start + length =
                  end): one row, always */}
              <Row three>
                <NumberField testId="start" label={t('Start')} glyph={<StartGlyph />} value={clip.start} onCommit={onStartChange} step={0.1} min={0} />
                <NumberField testId="length" label={t('Length')} glyph={<LengthGlyph />} value={clip.duration} onCommit={onDurationChange} step={0.1} min={0.02} />
                <ReadField testId="end" label={t('End')} glyph={<EndGlyph />}>{fmt(clip.start + clip.duration)} s</ReadField>
              </Row>
              <ClipStrip clip={clip} onTrimStartChange={onTrimStartChange} onTrimEndChange={onTrimEndChange} />
              <Row>
                <NumberField testId="trim-start" label={t('Trim start')} glyph={<TrimStartGlyph />} value={clip.trimStart} onCommit={onTrimStartChange} step={0.1} min={0} />
                <NumberField testId="trim-end" label={t('Trim end')} glyph={<TrimEndGlyph />}
                  value={Math.max(0, clip.fullDuration - clip.trimStart - clip.duration / clip.stretchFactor)} onCommit={onTrimEndChange} step={0.1} min={0} />
              </Row>
            </>
          )}
          </div>

          <div className="clip-properties__group" data-group="fades">
          <h3 className="clip-properties__section">{t('Fades')}</h3>
          <Row>
            <NumberField testId="fade-in" label={t('Fade in')} glyph={<FadeGlyph side="in" shape={inCurve} title="Fade in" />}
              value={fadeIn} onCommit={onFadeChange && ((n) => onFadeChange('in', n))} step={0.1} min={0} />
            <NumberField testId="fade-out" label={t('Fade out')} glyph={<FadeGlyph side="out" shape={outCurve} title="Fade out" />}
              value={fadeOut} onCommit={onFadeChange && ((n) => onFadeChange('out', n))} step={0.1} min={0} />
          </Row>
          <Row>
            <ShapePicker side="in" shapes={fadeShapes} current={fadeInShapeId} own={clip?.fadeInShape} onPick={onFadeShapeChange && ((id) => onFadeShapeChange('in', id))} disabled={fadeIn === 0} />
            <ShapePicker side="out" shapes={fadeShapes} current={fadeOutShapeId} own={clip?.fadeOutShape} onPick={onFadeShapeChange && ((id) => onFadeShapeChange('out', id))} disabled={fadeOut === 0} />
          </Row>
          </div>

          <div className="clip-properties__group" data-group="speed">
          <SectionHeader
            action={t('Reset')}
            actionId="reset-pitch-speed"
            actionTip={t('Reset pitch and speed')}
            onAction={onResetPitchSpeed}
            actionDisabled={pitch === 0 && speed === 100}
          >
            {t('Pitch & speed')}
          </SectionHeader>
          <Row>
            <NumberField testId="pitch" label={t('Pitch')} glyph={<PitchGlyph />} value={pitch} onCommit={onPitchChange}
              step={1} min={-PITCH_LIMIT_SEMITONES} max={PITCH_LIMIT_SEMITONES} digits={2} />
            <NumberField testId="speed" label={t('Speed')} glyph={<SpeedGlyph />} value={speed} onCommit={onSpeedChange} step={5} min={1} digits={2} />
          </Row>
          {/* Reverse (2026-10-07): a switch in the field look; mixed
              reads as neither, and a press sets every clip the same way */}
          <Row>
            <button
              type="button"
              className="clip-properties__field clip-properties__field--toggle clip-properties__field--wide"
              data-clip-properties-field="reverse"
              data-mixed={reversed === MIXED ? 'true' : undefined}
              data-tooltip={t('Reverse')}
              role="switch"
              aria-checked={reversed === MIXED ? 'mixed' : reversed}
              disabled={!onReverseChange}
              onClick={() => onReverseChange?.(reversed === MIXED ? true : !reversed)}
            >
              <span className="clip-properties__glyph-cell"><ReverseGlyph /></span>
              <span className="clip-properties__value">{t('Reverse')}</span>
              <span className="clip-properties__switch" aria-hidden="true" />
            </button>
          </Row>
          </div>

          {exportFormats.length > 0 && (
            <div className="clip-properties__group" data-group="export">
            <SectionHeader>Export</SectionHeader>
            <Row>
              <SelectField testId="export-format" label={t('Format')} glyph={<ExportGlyph />} options={formatOptions} value={format} onChange={setFormatPick} disabled={exporting} />
              <SelectField testId="export-rate" label={t('Sample rate')} glyph={<SampleRateGlyph />} options={rateOptions} value={sampleRate} onChange={setRatePick} disabled={exporting} />
            </Row>
            <Row>
              <div
                className="clip-properties__field--wide clip-properties__export"
                data-clip-properties-action={t('export')}
                data-tooltip={multi ? t('Export clips') : t('Export clip')}
              >
                <Button
                  variant="secondary"
                  size="default"
                  className="clip-properties__export-button"
                  disabled={!onExport || exporting}
                  onClick={() => onExport?.({ format, sampleRate: Number(sampleRate) || 0 })}
                >
                  {exporting ? 'Exporting…' : multi ? `Export ${multi.count} clips` : 'Export clip'}
                </Button>
              </div>
            </Row>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default ClipPropertiesPanel;
