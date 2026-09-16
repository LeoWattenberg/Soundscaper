import { usePresentationFeedback, feedbackFailure, type PresentationFeedback } from '../presentation-feedback.ts';
/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_RETIME_ADDITIONAL_COPY } from '../../../i18n/editor-video-retime-additional-copy.ts';

import React, { useEffect, useMemo, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createVideoRetimeDialogModel } from '../video-retime-dialog-model.ts';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import {
	formatVideoRetimeExactMapInput,
	parseVideoRetimeExactMapInput,
	VIDEO_RETIME_EXACT_MAP_INPUT_MAX_LENGTH,
} from '../video-retime-exact-map-input.ts';

interface VideoRetimeActions {
	retimeConstant(value: unknown): unknown;
	retimeReset(value: unknown): unknown;
	retimeReverse(value: unknown): unknown;
	retimeFreeze(value: unknown): unknown;
	retimeRamp(value: unknown): unknown;
	retimeSet(value: unknown): unknown;
}

interface VideoRetimeDialogProps {
	readonly productId: string;
	readonly capability: boolean;
	readonly editingBlocked: boolean;
	readonly controller: Readonly<{
		readonly actions: Readonly<{ readonly sequences: VideoRetimeActions }>;
	}>;
	readonly snapshot: Readonly<Record<string, unknown>> & {
		readonly project?: unknown;
		readonly selectedClipId?: unknown;
		readonly readOnly?: unknown;
		readonly blocked?: unknown;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function VideoRetimeDialog({
	productId, capability, editingBlocked, controller, snapshot, copy, run, onClose,
}: VideoRetimeDialogProps) {
	const model = useMemo(() => createVideoRetimeDialogModel({
		productId,
		capability,
		project: snapshot.project,
		selectedClipId: typeof snapshot.selectedClipId === 'string' ? snapshot.selectedClipId : null,
		editingBlocked: editingBlocked || snapshot.readOnly === true || snapshot.blocked === true,
	}), [capability, editingBlocked, productId, snapshot]);
	const exactMapSeed = useMemo(() => model.bounds === null ? '' : formatVideoRetimeExactMapInput(
		model.commandAuthority?.expectedRetimeMap ?? null,
		model.bounds,
	), [model.bounds, model.commandAuthority?.expectedRetimeMap]);
	const [freezeFrame, setFreezeFrame] = useState('0');
	const [direction, setDirection] = useState<'forward' | 'reverse'>('forward');
	const [startVelocity, setStartVelocity] = useState('1');
	const [endVelocity, setEndVelocity] = useState('1');
	const [sourceStartFrame, setSourceStartFrame] = useState('0');
	const [exactMapText, setExactMapText] = useState(exactMapSeed);
	const [pending, setPending] = useState(false);
	const [status, setStatus] = usePresentationFeedback(copy, VIDEO_RETIME_ADDITIONAL_COPY, 'videoRetime');
	const [error, setError] = usePresentationFeedback(copy, VIDEO_RETIME_ADDITIONAL_COPY, 'videoRetime');

	// The ramp start is the only field the direction decides. Resetting the freeze
	// frame with it discarded an entry from the separate Freeze frame fieldset
	// that the direction has nothing to do with.
	useEffect(() => {
		setSourceStartFrame(direction === 'forward'
			? String(model.bounds?.sourceFirstFrame ?? 0)
			: String(model.bounds?.sourceLastFrame ?? 0));
	}, [direction, model.bounds?.sourceFirstFrame, model.bounds?.sourceLastFrame]);

	useEffect(() => {
		setFreezeFrame(String(model.bounds?.sourceFirstFrame ?? 0));
		setStatus('');
		setError('');
	}, [model.clipId, model.bounds?.sourceFirstFrame, setError, setStatus]);
	useEffect(() => {
		setExactMapText(exactMapSeed);
	}, [exactMapSeed]);

	const perform = (operation: () => unknown, success: PresentationFeedback): void => {
		setPending(true);
		setError('');
		void runAwaitedAudioEditorOperation(run, operation)
			.then(() => { setStatus(success); })
			.catch((operationError: unknown) => {
				setError(feedbackFailure(operationError));
			})
			.finally(() => { setPending(false); });
	};
	const invoke = (action: keyof VideoRetimeActions, extra: Readonly<Record<string, unknown>> = {}): void => {
		if (!model.commandAuthority) return;
		perform(() => controller.actions.sequences[action]({ ...model.commandAuthority, ...extra }),
			{ key: 'videoRetimeApplied' });
	};
	const invokeParsed = (
		action: keyof VideoRetimeActions,
		buildExtra: () => Readonly<Record<string, unknown>>,
	): void => {
		try {
			invoke(action, buildExtra());
		} catch (parseError: unknown) {
			setStatus('');
			setError(feedbackFailure(parseError));
		}
	};
	const disabled = model.blockReason !== null || pending;
	const blockMessage = model.blockReason === 'locked'
		? label(copy, 'videoRetimeLocked', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeLocked)
		: model.blockReason === 'busy' ? label(copy, 'videoRetimeReadOnly', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeReadOnly)
			: model.blockReason ? label(copy, 'videoRetimeNoSelection', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeNoSelection) : '';

	return <AudioEditorDialogShell
		title={label(copy, 'videoRetimeTitle', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeTitle)}
		onClose={onClose}
		width={620}
		initialFocus="[data-video-retime-constant]"
		dataAttributes={{ 'data-video-retime-dialog': 'true' }}
	>
		<div className="audio-editor-video-retime">
			<p>{label(copy, 'videoRetimeDescription',
				VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeDescription)}</p>
			{blockMessage && <p role="status">{blockMessage}</p>}
			{model.clipId && <section aria-label={label(copy, 'videoRetimeSelectedClip', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeSelectedClip)}>
				<h3>{model.clipName}</h3>
				<p>{label(copy, 'videoRetimeSourceRange', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeSourceRange)}: {String(model.bounds?.sourceFirstFrame)}–{String(model.bounds?.sourceLastFrame)}</p>
			</section>}
			<div className="audio-editor-video-retime__primary-actions">
				<button type="button" data-video-retime-constant disabled={disabled}
					onClick={() => invoke('retimeConstant')}>{label(copy, 'videoRetimeConstant', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeConstant)}</button>
				<button type="button" disabled={disabled}
					onClick={() => invoke('retimeReverse')}>{label(copy, 'videoRetimeReverse', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeReverse)}</button>
				<button type="button" disabled={disabled || !model.hasRetimeMap}
					onClick={() => invoke('retimeReset')}>{label(copy, 'videoRetimeReset', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeReset)}</button>
			</div>
			<fieldset disabled={disabled}>
				<legend>{label(copy, 'videoRetimeFreeze', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeFreeze)}</legend>
				<label><span>{label(copy, 'videoRetimeSourceFrame', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeSourceFrame)}</span>
					<input type="text" inputMode="numeric" value={freezeFrame}
						onChange={(event) => setFreezeFrame(event.currentTarget.value)} /></label>
				<button type="button" onClick={() => invokeParsed('retimeFreeze', () => ({
					sourceFrame: parseRational(freezeFrame, 'freeze source frame'),
				}))}>{label(copy, 'videoRetimeApplyFreeze', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeApplyFreeze)}</button>
			</fieldset>
			<fieldset disabled={disabled}>
				<legend>{label(copy, 'videoRetimeRamp', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeRamp)}</legend>
				<label><span>{label(copy, 'videoRetimeDirection', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeDirection)}</span>
					<select value={direction} onChange={(event) => setDirection(
						event.currentTarget.value === 'reverse' ? 'reverse' : 'forward',
					)}>
						<option value="forward">{label(copy, 'videoRetimeForward', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeForward)}</option>
						<option value="reverse">{label(copy, 'videoRetimeReverse', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeReverse)}</option>
					</select></label>
				<RationalField label={label(copy, 'videoRetimeStartVelocity', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeStartVelocity)}
					value={startVelocity} onChange={setStartVelocity} />
				<RationalField label={label(copy, 'videoRetimeEndVelocity', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeEndVelocity)}
					value={endVelocity} onChange={setEndVelocity} />
				<RationalField label={label(copy, 'videoRetimeSourceStartFrame', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeSourceStartFrame)}
					value={sourceStartFrame} onChange={setSourceStartFrame} />
				<button type="button" onClick={() => invokeParsed('retimeRamp', () => ({
					direction,
					startVelocity: parseRational(startVelocity, 'start velocity'),
					endVelocity: parseRational(endVelocity, 'end velocity'),
					sourceStartFrame: parseRational(sourceStartFrame, 'source start frame'),
				}))}>{label(copy, 'videoRetimeApplyRamp', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeApplyRamp)}</button>
			</fieldset>
			<fieldset disabled={disabled || model.bounds === null}>
				<legend>{label(copy, 'videoRetimeExactMap', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeExactMap)}</legend>
				<p>{label(copy, 'videoRetimeExactMapDescription',
					VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeExactMapDescription)}</p>
				<label><span>{label(copy, 'videoRetimeExactMapJson', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeExactMapJson)}</span>
					<textarea data-video-retime-exact-map="true" value={exactMapText}
						maxLength={VIDEO_RETIME_EXACT_MAP_INPUT_MAX_LENGTH}
						onChange={(event) => setExactMapText(event.currentTarget.value)} /></label>
				<button type="button" data-video-retime-set="true" onClick={() => invokeParsed('retimeSet', () => {
					if (model.bounds === null) throw new Error('Select one timeline video clip.');
					return { retimeMap: parseVideoRetimeExactMapInput(exactMapText, model.bounds) };
				})}>{label(copy, 'videoRetimeApplyExactMap', VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeApplyExactMap)}</button>
			</fieldset>
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		</div>
	</AudioEditorDialogShell>;
}

function RationalField({ label: fieldLabel, value, onChange }: Readonly<{
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
}>) {
	return <label><span>{fieldLabel}</span><input type="text" inputMode="numeric" value={value}
		onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}

function parseRational(value: string, name: string): Readonly<{ readonly num: number; readonly den: number }> {
	const parts = value.trim().split('/');
	if (parts.length < 1 || parts.length > 2) throw new RangeError(`${name} must be an integer or fraction.`);
	const num = Number(parts[0]);
	const den = parts.length === 2 ? Number(parts[1]) : 1;
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0 || Object.is(num, -0)) {
		throw new RangeError(`${name} must be a safe-integer fraction with a positive denominator.`);
	}
	return Object.freeze({ num, den });
}

function label(copy: Readonly<Record<string, string>>, key: string, fallback: string): string {
	return copy[`ui.videoRetime.${key}`] || copy[key] || fallback;
}
