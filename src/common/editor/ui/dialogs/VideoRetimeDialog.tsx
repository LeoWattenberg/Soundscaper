/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createVideoRetimeDialogModel } from '../video-retime-dialog-model.ts';

interface VideoRetimeActions {
	retimeConstant(value: unknown): unknown;
	retimeReset(value: unknown): unknown;
	retimeReverse(value: unknown): unknown;
	retimeFreeze(value: unknown): unknown;
	retimeRamp(value: unknown): unknown;
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
	const [freezeFrame, setFreezeFrame] = useState('0');
	const [direction, setDirection] = useState<'forward' | 'reverse'>('forward');
	const [startVelocity, setStartVelocity] = useState('1');
	const [endVelocity, setEndVelocity] = useState('1');
	const [sourceStartFrame, setSourceStartFrame] = useState('0');
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		const first = String(model.bounds?.sourceFirstFrame ?? 0);
		setFreezeFrame(first);
		setSourceStartFrame(direction === 'forward'
			? first
			: String(model.bounds?.sourceLastFrame ?? 0));
		setStatus('');
		setError('');
	}, [direction, model.clipId, model.bounds?.sourceFirstFrame, model.bounds?.sourceLastFrame]);

	const perform = (operation: () => unknown, success: string): void => {
		setPending(true);
		setError('');
		void Promise.resolve()
			.then(() => run(operation))
			.then(() => { setStatus(success); })
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			})
			.finally(() => { setPending(false); });
	};
	const invoke = (action: keyof VideoRetimeActions, extra: Readonly<Record<string, unknown>> = {}): void => {
		if (!model.commandAuthority) return;
		perform(() => controller.actions.sequences[action]({ ...model.commandAuthority, ...extra }),
			label(copy, 'videoRetimeApplied', 'Video retime updated.'));
	};
	const invokeParsed = (
		action: keyof VideoRetimeActions,
		buildExtra: () => Readonly<Record<string, unknown>>,
	): void => {
		try {
			invoke(action, buildExtra());
		} catch (parseError: unknown) {
			setStatus('');
			setError(parseError instanceof Error ? parseError.message : String(parseError));
		}
	};
	const disabled = model.blockReason !== null || pending;
	const blockMessage = model.blockReason === 'locked'
		? label(copy, 'videoRetimeLocked', 'The selected video track is locked.')
		: model.blockReason === 'busy' ? label(copy, 'videoRetimeReadOnly', 'Video retime is unavailable while editing is blocked.')
			: model.blockReason ? label(copy, 'videoRetimeNoSelection', 'Select one timeline video clip.') : '';

	return <AudioEditorDialogShell
		title={label(copy, 'videoRetimeTitle', 'Video retime')}
		onClose={onClose}
		width={620}
		initialFocus="[data-video-retime-constant]"
		dataAttributes={{ 'data-video-retime-dialog': 'true' }}
	>
		<div className="audio-editor-video-retime">
			<p>{label(copy, 'videoRetimeDescription',
				'Author an exact speed curve for the selected picture occurrence. Linked audio stays unwarped.')}</p>
			{blockMessage && <p role="status">{blockMessage}</p>}
			{model.clipId && <section aria-label={label(copy, 'videoRetimeSelectedClip', 'Selected video clip')}>
				<h3>{model.clipName}</h3>
				<p>{label(copy, 'videoRetimeSourceRange', 'Source frame range')}: {String(model.bounds?.sourceFirstFrame)}–{String(model.bounds?.sourceLastFrame)}</p>
			</section>}
			<div className="audio-editor-video-retime__primary-actions">
				<button type="button" data-video-retime-constant disabled={disabled}
					onClick={() => invoke('retimeConstant')}>{label(copy, 'videoRetimeConstant', 'Constant speed')}</button>
				<button type="button" disabled={disabled}
					onClick={() => invoke('retimeReverse')}>{label(copy, 'videoRetimeReverse', 'Reverse')}</button>
				<button type="button" disabled={disabled || !model.hasRetimeMap}
					onClick={() => invoke('retimeReset')}>{label(copy, 'videoRetimeReset', 'Reset')}</button>
			</div>
			<fieldset disabled={disabled}>
				<legend>{label(copy, 'videoRetimeFreeze', 'Freeze frame')}</legend>
				<label><span>{label(copy, 'videoRetimeSourceFrame', 'Source frame')}</span>
					<input type="text" inputMode="numeric" value={freezeFrame}
						onChange={(event) => setFreezeFrame(event.currentTarget.value)} /></label>
				<button type="button" onClick={() => invokeParsed('retimeFreeze', () => ({
					sourceFrame: parseRational(freezeFrame, 'freeze source frame'),
				}))}>{label(copy, 'videoRetimeApplyFreeze', 'Apply freeze')}</button>
			</fieldset>
			<fieldset disabled={disabled}>
				<legend>{label(copy, 'videoRetimeRamp', 'Speed ramp')}</legend>
				<label><span>{label(copy, 'videoRetimeDirection', 'Direction')}</span>
					<select value={direction} onChange={(event) => setDirection(
						event.currentTarget.value === 'reverse' ? 'reverse' : 'forward',
					)}>
						<option value="forward">{label(copy, 'videoRetimeForward', 'Forward')}</option>
						<option value="reverse">{label(copy, 'videoRetimeReverse', 'Reverse')}</option>
					</select></label>
				<RationalField label={label(copy, 'videoRetimeStartVelocity', 'Start velocity')}
					value={startVelocity} onChange={setStartVelocity} />
				<RationalField label={label(copy, 'videoRetimeEndVelocity', 'End velocity')}
					value={endVelocity} onChange={setEndVelocity} />
				<RationalField label={label(copy, 'videoRetimeSourceStartFrame', 'Source start frame')}
					value={sourceStartFrame} onChange={setSourceStartFrame} />
				<button type="button" onClick={() => invokeParsed('retimeRamp', () => ({
					direction,
					startVelocity: parseRational(startVelocity, 'start velocity'),
					endVelocity: parseRational(endVelocity, 'end velocity'),
					sourceStartFrame: parseRational(sourceStartFrame, 'source start frame'),
				}))}>{label(copy, 'videoRetimeApplyRamp', 'Apply ramp')}</button>
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
	return copy[key] || fallback;
}
