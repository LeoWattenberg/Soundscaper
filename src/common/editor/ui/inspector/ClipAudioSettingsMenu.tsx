/* SPDX-License-Identifier: AGPL-3.0-only */
import { useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import ClipResampleDialog from './ClipResampleDialog.jsx';
import { linearToDb } from './inspector-helpers.ts';

interface Clip {
	readonly id: string;
	readonly gain?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
	readonly inverted?: boolean;
	readonly linkPitchAndTempo?: boolean;
	readonly preserveFormants?: boolean;
	readonly stretchToTempo?: boolean;
	readonly pitchCents?: number;
	readonly speedRatio?: number;
}
interface Controller {
	readonly actions: { readonly clip: {
		update(id: string, changes: Readonly<Record<string, unknown>>): unknown;
		setTimePitch(id: string, changes: Readonly<Record<string, unknown>>): unknown;
		toggleStretchToTempo(id: string): unknown;
		invert(id: string): unknown;
		renderPitchSpeed(id: string): unknown;
		normalizePeak(id: string): unknown;
		normalizeLoudness(id: string): unknown;
		resample(id: string, request: { readonly sampleRate: number }): unknown;
	} };
}
interface Props {
	readonly controller: object;
	readonly clip: Clip;
	readonly source: { readonly sampleRate?: number; readonly channelCount?: number };
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly effectsEnabled: boolean;
	readonly run: (operation: () => unknown) => unknown;
	readonly nativeTimeFields: boolean;
	readonly onNativeTimeFields: () => void;
	readonly pitchUnit: 'semitones' | 'percent';
	readonly onPitchUnit: (unit: 'semitones' | 'percent') => void;
}

/** Unique audio operations remain available without repeating the inspector fields. */
export default function ClipAudioSettingsMenu({ controller, clip, source, copy, disabled, effectsEnabled, run,
	nativeTimeFields, onNativeTimeFields, pitchUnit, onPitchUnit }: Props) {
	const actions = (controller as Controller).actions.clip;
	const trigger = useRef<HTMLButtonElement>(null);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const [dialog, setDialog] = useState<'gain' | 'resample' | 'fadeInShape' | 'fadeOutShape' | null>(null);
	const [gain, setGain] = useState(() => String(Number(linearToDb(clip.gain ?? 1).toFixed(2))));
	const [valueEdited, setValueEdited] = useState(false);
	const close = () => { setPosition(null); trigger.current?.focus({ preventScroll: true }); };
	const effectBlocked = disabled || !effectsEnabled;
	const item = (label: string, action: () => unknown, checked?: boolean, blocked = effectBlocked) => <ContextMenuItem
		key={label} label={label} role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} checked={checked} disabled={blocked} onClose={close} onClick={() => { run(action); }} />;
	const gainNumber = Number(gain);
	const shape = dialog === 'fadeInShape' || dialog === 'fadeOutShape';
	const valueLabel = dialog === 'fadeInShape' ? copy.fadeInShape : dialog === 'fadeOutShape' ? copy.fadeOutShape : `${copy.clipGain} (dB)`;
	const gainValid = gain.trim() !== '' && Number.isFinite(gainNumber) && gainNumber >= (shape ? 0.15 : -60) && gainNumber <= (shape ? 6 : 24);
	const applyGain = () => {
		if (disabled || !gainValid) return;
		if (valueEdited) run(() => actions.update(clip.id, shape ? { [dialog ?? 'gain']: gainNumber } : { gain: Math.min(16, 10 ** (gainNumber / 20)) }));
		setDialog(null);
	};
	return <div className="audio-editor-panel-actions">
		<Button ref={trigger} variant="secondary" data-clip-audio-settings aria-haspopup="menu" aria-expanded={Boolean(position)}
			onClick={event => { if (!event) return; const bounds = event.currentTarget.getBoundingClientRect(); setPosition({ x: bounds.left, y: bounds.bottom }); }}>
			{copy.clipMediaSettings}
		</Button>
		<ContextMenu isOpen={Boolean(position)} x={position?.x ?? 0} y={position?.y ?? 0} autoFocus onClose={close} ariaLabel={copy.clipMediaSettings}>
			<ContextMenuItem label={copy.clipTimecodeFields} checked={nativeTimeFields} role="menuitemcheckbox" onClick={onNativeTimeFields} onClose={close} />
			<ContextMenuItem label={copy.clipPitchUnit} hasSubmenu onClose={close}>
				<ContextMenuItem label={copy.clipPitchUnitSemitones} role="menuitemradio" checked={pitchUnit === 'semitones'} onClick={() => onPitchUnit('semitones')} onClose={close} />
				<ContextMenuItem label={copy.clipPitchUnitPercent} role="menuitemradio" checked={pitchUnit === 'percent'} onClick={() => onPitchUnit('percent')} onClose={close} />
			</ContextMenuItem>
			<ContextMenuItem isDivider />
			<ContextMenuItem label={`${copy.clipGain} (dB)`} disabled={disabled} onClick={() => { setGain(String(Number(linearToDb(clip.gain ?? 1).toFixed(2)))); setValueEdited(false); setDialog('gain'); }} onClose={close} />
			{item(copy.invert, () => actions.invert(clip.id), Boolean(clip.inverted))}
			{item(copy.clipLinkPitchAndTempo, () => actions.setTimePitch(clip.id, { linkPitchAndTempo: !clip.linkPitchAndTempo }), Boolean(clip.linkPitchAndTempo))}
			{item(copy.preserveFormants, () => actions.setTimePitch(clip.id, { preserveFormants: !clip.preserveFormants }), Boolean(clip.preserveFormants))}
			{item(copy.stretchToTempo, () => actions.toggleStretchToTempo(clip.id), Boolean(clip.stretchToTempo))}
			{item(copy.renderPitchSpeed, () => actions.renderPitchSpeed(clip.id), undefined,
				effectBlocked || ((clip.speedRatio ?? 1) === 1 && (clip.linkPitchAndTempo || (clip.pitchCents ?? 0) === 0)))}
			<ContextMenuItem isDivider />
			{(['fadeInShape', 'fadeOutShape'] as const).map(field => <ContextMenuItem key={field}
				label={field === 'fadeInShape' ? copy.fadeInShape : copy.fadeOutShape} disabled={disabled} onClose={close}
				onClick={() => { setGain(String(clip[field] ?? 2)); setValueEdited(false); setDialog(field); }} />)}
			{item(copy.normalizePeak, () => actions.normalizePeak(clip.id))}
			{item(copy.normalizeLufs, () => actions.normalizeLoudness(clip.id))}
			<ContextMenuItem label={copy.resample} disabled={effectBlocked || !source.sampleRate} onClick={() => setDialog('resample')} onClose={close} />
			<ContextMenuItem isDivider />
			<ContextMenuItem label={`${copy.sampleRateHz}: ${source.sampleRate ?? ''}`} disabled />
		</ContextMenu>
		{dialog === 'resample' && <ClipResampleDialog sampleRate={source.sampleRate} copy={copy} disabled={effectBlocked}
			onCancel={() => setDialog(null)} onApply={(request: { sampleRate: number }) => { setDialog(null); run(() => actions.resample(clip.id, request)); }} />}
		{dialog && dialog !== 'resample' && <AudioEditorDialogShell title={valueLabel} onClose={() => setDialog(null)} width={320}
			footer={<DialogFooter primaryText={copy.channelMappingApply} secondaryText={copy.cancel} primaryDisabled={!gainValid || disabled}
				onPrimaryClick={applyGain} onSecondaryClick={() => setDialog(null)} />}>
			<form onSubmit={event => { event.preventDefault(); applyGain(); }} onKeyDownCapture={event => {
				if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
				event.preventDefault(); event.stopPropagation(); applyGain();
			}}><label className="kw-audio-editor-dialog__field" data-clip-field={dialog}><span>{valueLabel}</span>
				<NumberStepper value={gain} onChange={value => { setValueEdited(true); setGain(value); }} ariaLabel={valueLabel} min={shape ? 0.15 : -60} max={shape ? 6 : 24} step={shape ? 0.01 : 1} disabled={disabled} />
			</label></form>
		</AudioEditorDialogShell>}
	</div>;
}
