/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { type FormEvent, useMemo, useState } from 'react';

import { addRationals, multiplyRationals } from '../../timeline-time.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	createVideoKeyframeCurveTransfer,
	parseVideoKeyframeCurveTransfer,
	serializeVideoKeyframeCurveTransfer,
	applyVideoKeyframeCurveTransfer,
} from '../video-keyframe-curve-transfer.ts';
import {
	createVideoKeyframeCurve,
	createVideoKeyframeDialogModel,
	createVideoKeyframeSetCommand,
	listVideoKeyframeTargetChoices,
	videoKeyframeTargetKey,
	type VideoKeyframeDialogModel,
	type VideoKeyframeTargetChoice,
} from '../video-keyframe-dialog-model.ts';
import { videoKeyframeTransferShortcut } from '../video-keyframe-transfer-shortcut.ts';
import VideoKeyframeCurveEditor from './VideoKeyframeCurveEditor.tsx';

interface VideoKeyframeDialogProps {
	readonly productId: string;
	readonly capability: boolean;
	readonly controller: Readonly<{
		getTelemetrySnapshot?(): Readonly<{ readonly positionFrame?: unknown }>;
		readonly actions: Readonly<{ readonly edit: Readonly<{ commit(command: unknown): unknown }> }>;
	}>;
	readonly snapshot: Readonly<Record<string, unknown>> & {
		readonly project?: unknown; readonly selectedClipId?: unknown;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

type CurveKind = 'hold' | 'linear' | 'eased' | 'bezier';

export default function VideoKeyframeDialog({
	productId, capability, controller, snapshot, copy, run, onClose,
}: VideoKeyframeDialogProps) {
	const model = useMemo(() => createVideoKeyframeDialogModel({
		productId, capability, project: snapshot.project, snapshot,
	}), [capability, productId, snapshot]);
	const choices = useMemo(() => model.keyframes ? listVideoKeyframeTargetChoices(model) : [], [model]);
	const firstTarget = model.keyframes?.curves[0]
		? videoKeyframeTargetKey(model.keyframes.curves[0].target)
		: choices[0]?.key ?? '';
	const [targetKey, setTargetKey] = useState(firstTarget);
	const [startText, setStartText] = useState('0');
	const [endText, setEndText] = useState(() => String(model.sequenceFrameCount));
	const [startValue, setStartValue] = useState(() => String(choices[0]?.baseValue ?? 0));
	const [endValue, setEndValue] = useState(() => String(choices[0]?.baseValue ?? 0));
	const [kind, setKind] = useState<CurveKind>('linear');
	const [transferText, setTransferText] = useState('');
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	const [pending, setPending] = useState(false);
	const selected = choices.find(({ key }) => key === targetKey) ?? choices[0] ?? null;
	const disabled = model.operationsBlocked || pending;

	const commit = (keyframes: unknown, message: string): void => {
		if (disabled || !model.clipId || !model.keyframes) return;
		try {
			const command = createVideoKeyframeSetCommand(model, keyframes);
			setPending(true); setError('');
			void Promise.resolve()
				.then(() => run(() => controller.actions.edit.commit(command)))
				.then(() => { setStatus(message); })
				.catch(() => { setError(label(copy, 'videoKeyframesApplyFailed', 'Video keyframes could not be applied.')); })
				.finally(() => { setPending(false); });
		} catch {
			setError(label(copy, 'videoKeyframesInvalid', 'Check the exact positions, values, and curve shape.'));
		}
	};
	const addCurve = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (!selected) return;
		try {
			const start = parseRationalText(startText);
			const end = parseRationalText(endText);
			commit(createVideoKeyframeCurve(model, {
				target: selected.target,
				start: { position: start, value: parseNumber(startValue) },
				end: { position: end, value: parseNumber(endValue) },
				segment: kind === 'bezier' ? {
					kind,
					control1: { position: weightedRational(start, end, 1, 3), value: parseNumber(startValue) },
					control2: { position: weightedRational(start, end, 2, 3), value: parseNumber(endValue) },
				} : { kind },
			}), label(copy, 'videoKeyframesApplied', 'Video keyframes applied.'));
		} catch {
			setError(label(copy, 'videoKeyframesInvalid', 'Check the exact positions, values, and curve shape.'));
		}
	};
	const copyCurve = (role: 'clipboard' | 'preset'): void => {
		if (!selected) return;
		try {
			setTransferText(serializeVideoKeyframeCurveTransfer(createVideoKeyframeCurveTransfer(model, {
				role, target: selected.target,
			})));
			setStatus(role === 'preset'
				? label(copy, 'videoKeyframesPresetSaved', 'Curve preset prepared.')
				: label(copy, 'videoKeyframesCopied', 'Curve copied to the transfer field.'));
			setError('');
		} catch { setError(label(copy, 'videoKeyframesTransferFailed', 'The curve could not be transferred.')); }
	};
	const applyTransfer = (role: 'clipboard' | 'preset'): void => {
		if (!selected) return;
		try {
			const transfer = parseVideoKeyframeCurveTransfer(transferText, role);
			commit(applyVideoKeyframeCurveTransfer(model, transfer, selected.target),
				label(copy, 'videoKeyframesApplied', 'Video keyframes applied.'));
		} catch { setError(label(copy, 'videoKeyframesTransferFailed', 'The curve could not be transferred.')); }
	};

	return <AudioEditorDialogShell
		title={label(copy, 'videoKeyframesTitle', 'Video keyframes')}
		onClose={onClose}
		width={760}
		initialFocus={'[data-video-keyframe-field="target"]'}
		ariaDescribedBy="video-keyframes-description"
		dataAttributes={{ 'data-video-keyframe-dialog': 'true' }}
	>
		<p id="video-keyframes-description">{label(copy, 'videoKeyframesDescription',
			'Author exact clip-local keyframes for composition and registered video-effect parameters.')}</p>
		{blockMessage(model, copy) && <p role="status">{blockMessage(model, copy)}</p>}
		{model.clipId && <h3>{model.clipName}</h3>}
		{model.keyframes && <>
			<form onSubmit={addCurve}>
				<fieldset disabled={disabled}>
					<legend>{label(copy, 'videoKeyframesAddCurve', 'Add curve')}</legend>
					<label className="audio-editor-field">
						<span>{label(copy, 'videoKeyframesTarget', 'Target')}</span>
						<select data-video-keyframe-field="target" value={selected?.key ?? ''} onChange={(event) => {
							const next = choices.find(({ key }) => key === event.currentTarget.value);
							setTargetKey(event.currentTarget.value);
							if (next) { setStartValue(String(next.baseValue)); setEndValue(String(next.baseValue)); }
						}}>{choices.map((choice) => <option key={choice.key} value={choice.key}>{choiceLabel(choice, copy)}</option>)}</select>
					</label>
					<div className="audio-editor-field-grid">
						<ExactField hook="start" label={label(copy, 'videoKeyframesStart', 'Start (frames or num/den)')} value={startText} onChange={setStartText} />
						<ExactField hook="end" label={label(copy, 'videoKeyframesEnd', 'End (frames or num/den)')} value={endText} onChange={setEndText} />
						<NumberField hook="start-value" label={label(copy, 'videoKeyframesStartValue', 'Start value')} value={startValue} choice={selected} onChange={setStartValue} />
						<NumberField hook="end-value" label={label(copy, 'videoKeyframesEndValue', 'End value')} value={endValue} choice={selected} onChange={setEndValue} />
					</div>
					<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesInterpolation', 'Interpolation')}</span>
						<select data-video-keyframe-field="interpolation" value={kind} onChange={(event) => setKind(event.currentTarget.value as CurveKind)}>
							{(['hold', 'linear', 'eased', 'bezier'] as const).map((value) => <option key={value} value={value}>{label(copy, `videoKeyframes${titleCase(value)}`, titleCase(value))}</option>)}
						</select>
					</label>
					<button type="submit">{label(copy, 'videoKeyframesAdd', 'Add curve')}</button>
				</fieldset>
			</form>
			<VideoKeyframeCurveEditor
				model={model}
				choices={choices}
				copy={copy}
				disabled={disabled}
				commit={(keyframes) => commit(keyframes, label(copy, 'videoKeyframesApplied', 'Video keyframes applied.'))}
				reportInvalid={() => setError(label(copy, 'videoKeyframesInvalid', 'Check the exact positions, values, and curve shape.'))}
			/>
			<fieldset disabled={disabled} onKeyDown={(event) => {
				const shortcut = videoKeyframeTransferShortcut(event, disabled);
				if (!shortcut) return;
				event.preventDefault();
				if (shortcut === 'copy') copyCurve('clipboard');
				else applyTransfer('clipboard');
			}}>
				<legend>{label(copy, 'videoKeyframesTransfer', 'Copy, paste, and presets')}</legend>
				<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesTransferJson', 'Curve transfer JSON')}</span>
					<textarea data-video-keyframe-field="transfer" value={transferText} maxLength={262_144} onChange={(event) => setTransferText(event.currentTarget.value)} />
				</label>
				<div className="audio-editor-panel-actions">
					<button type="button" aria-keyshortcuts="Control+Shift+C" onClick={() => copyCurve('clipboard')}>{label(copy, 'videoKeyframesCopy', 'Copy curve')}</button>
					<button type="button" aria-keyshortcuts="Control+Shift+V" onClick={() => applyTransfer('clipboard')}>{label(copy, 'videoKeyframesPaste', 'Paste curve')}</button>
					<button type="button" onClick={() => copyCurve('preset')}>{label(copy, 'videoKeyframesSavePreset', 'Prepare preset')}</button>
					<button type="button" onClick={() => applyTransfer('preset')}>{label(copy, 'videoKeyframesApplyPreset', 'Apply preset')}</button>
				</div>
			</fieldset>
		</>}
		<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
	</AudioEditorDialogShell>;
}

function ExactField({ hook, label: fieldLabel, value, onChange }: Readonly<{
	hook: string; label: string; value: string; onChange(value: string): void;
}>) {
	return <label className="audio-editor-field"><span>{fieldLabel}</span><input
		type="text" inputMode="text" data-video-keyframe-field={hook} value={value}
		onChange={(event) => onChange(event.currentTarget.value)}
	/></label>;
}

function NumberField({ hook, label: fieldLabel, value, choice, onChange }: Readonly<{
	hook: string; label: string; value: string; choice: VideoKeyframeTargetChoice | null;
	onChange(value: string): void;
}>) {
	return <label className="audio-editor-field"><span>{fieldLabel}</span><input
		type="number" data-video-keyframe-field={hook} value={value}
		min={choice?.minimum} max={choice?.maximum} step={choice?.step ?? 'any'}
		onChange={(event) => onChange(event.currentTarget.value)}
	/></label>;
}

function parseRationalText(value: string): number | Readonly<{ num: number; den: number }> {
	const parts = value.trim().split('/');
	if (parts.length === 1) return parseNumber(parts[0] ?? '');
	if (parts.length !== 2) throw new TypeError('An exact rational uses num/den.');
	const num = Number(parts[0]); const den = Number(parts[1]);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) throw new TypeError('An exact rational uses safe integer num/den.');
	return Object.freeze({ num, den });
}

function weightedRational(
	start: number | Readonly<{ num: number; den: number }>,
	end: number | Readonly<{ num: number; den: number }>,
	endWeight: number,
	denominator: number,
) {
	return addRationals(
		multiplyRationals(start, { num: denominator - endWeight, den: denominator }),
		multiplyRationals(end, { num: endWeight, den: denominator }),
	);
}

function parseNumber(value: string): number {
	if (!value.trim()) throw new TypeError('A finite number is required.');
	const result = Number(value);
	if (!Number.isFinite(result) || Object.is(result, -0)) throw new TypeError('A finite number without negative zero is required.');
	return result;
}

function choiceLabel(choice: VideoKeyframeTargetChoice, copy: Readonly<Record<string, string>>): string {
	return label(copy, choice.labelKey, choice.fallbackLabel);
}

function blockMessage(model: VideoKeyframeDialogModel, copy: Readonly<Record<string, string>>): string {
	const messages = {
		unsupported: ['videoKeyframesUnsupported', 'Video keyframes are unavailable for this project.'],
		'no-video-clip': ['videoKeyframesNoSelection', 'Select exactly one timeline video clip.'],
		'read-only': ['videoKeyframesReadOnly', 'This project is read-only.'],
		busy: ['videoKeyframesBusy', 'Video keyframe editing is unavailable while another operation is running.'],
		locked: ['videoKeyframesLocked', 'Unlock the video track to edit keyframes.'],
	} as const;
	const message = model.blockReason ? messages[model.blockReason] : null;
	return message ? label(copy, message[0], message[1]) : '';
}

function titleCase(value: string): string { return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`; }
function label(copy: Readonly<Record<string, string>>, key: string, fallback: string): string { return copy[key] || fallback; }
