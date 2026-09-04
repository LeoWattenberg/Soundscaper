/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Knob } from '@soundscaper/design-system/Knob';

import { AUDIO_EDITOR_SAMPLE_RATE } from '../../project.js';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { CommitField, SteppedSlider } from './inspector-controls.jsx';
import { effectParameterTakesTimeCode } from './effect-helpers.ts';

/**
 * One numeric effect parameter, and the drag that edits it.
 *
 * Split out of the parameter editor because that file reached the
 * maintainability ceiling, and this is the part of it that stands alone: the
 * knob's gesture lifecycle, its slider and timecode alternatives, and the rule
 * about which parameters may be entered as a time at all.
 */
export default function ParameterNumber({
	label,
	value,
	range,
	step,
	presentation = 'knob',
	copy,
	disabled,
	hook,
	timeCodeUnit: timeUnit,
	sampleRate = AUDIO_EDITOR_SAMPLE_RATE,
	onCommit,
	onGestureBegin,
	onGesturePreview,
	onGestureCommit,
	onGestureCancel,
}) {
	const [gestureValue, setGestureValue] = useState(null);
	const gestureActiveRef = useRef(false);
	const gestureValueRef = useRef(null);
	const gestureCallbacksRef = useRef({});
	gestureCallbacksRef.current = {
		begin: onGestureBegin,
		preview: onGesturePreview,
		commit: onGestureCommit,
		cancel: onGestureCancel,
	};
	const knobRange = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) ? range : null;
	const knobStep = Number.isFinite(step) && step > 0
		? step
		: 0.01;
	const gestureEnabled = Boolean(onGestureBegin && onGesturePreview && onGestureCommit);
	useEffect(() => () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		gestureCallbacksRef.current.cancel?.();
	}, []);
	const beginKnobGesture = (current) => {
		if (disabled || !gestureEnabled || gestureActiveRef.current) return;
		gestureActiveRef.current = true;
		gestureValueRef.current = current;
		setGestureValue(current);
		gestureCallbacksRef.current.begin?.(current);
	};
	const previewKnobValue = (next) => {
		if (!gestureActiveRef.current || !gestureEnabled) {
			onCommit(next);
			return;
		}
		gestureValueRef.current = next;
		setGestureValue(next);
		gestureCallbacksRef.current.preview?.(next);
	};
	const finishKnobGesture = (next) => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		gestureValueRef.current = next;
		setGestureValue(null);
		gestureCallbacksRef.current.commit?.(next);
	};
	const cancelKnobGesture = () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		setGestureValue(null);
		gestureCallbacksRef.current.cancel?.();
	};
	const commit = (raw) => {
		const next = Number(raw);
		if (!Number.isFinite(next) || (range && (next < range[0] || next > range[1]))) {
			throw new RangeError(copy.parameterRangeError
				.replace('{label}', label)
				.replace('{minimum}', String(range?.[0] ?? '−∞'))
				.replace('{maximum}', String(range?.[1] ?? '∞')));
		}
		onCommit(next);
	};
	const changeSlider = (next) => {
		const snapped = knobStep > 0
			? Math.round((next - knobRange[0]) / knobStep) * knobStep + knobRange[0]
			: next;
		const value = Number(snapped.toFixed(8));
		if (gestureEnabled) onGesturePreview(value);
		else onCommit(value);
	};
	return (
		<div
			className={`audio-editor-effect-number audio-editor-effect-number--${presentation}`}
			data-effect-param={hook}
			role="group"
			aria-label={label}
		>
			<span>{label}</span>
			{!timeUnit && knobRange && presentation === 'knob' && <Knob
				value={gestureValue ?? (Number(value) || 0)}
				min={knobRange[0]}
				max={knobRange[1]}
				step={knobStep}
				label={label}
				mode={knobRange[0] < 0 && knobRange[1] > 0 ? 'bipolar' : 'unipolar'}
				disabled={disabled}
				onChange={previewKnobValue}
				onGestureStart={gestureEnabled ? beginKnobGesture : undefined}
				onGestureEnd={gestureEnabled ? finishKnobGesture : undefined}
				onGestureCancel={gestureEnabled ? cancelKnobGesture : undefined}
			/>}
			{!timeUnit && knobRange && presentation === 'slider' && <SteppedSlider
				value={Number(value) || 0}
				min={knobRange[0]}
				max={knobRange[1]}
				step={knobStep}
				ariaLabel={label}
					disabled={disabled}
					onChange={changeSlider}
					onGestureStart={onGestureBegin}
					onGestureEnd={onGestureCommit}
					onGestureCancel={onGestureCancel}
				/>}
			{timeUnit ? <AudioEditorTimeCodeInput
				label={label}
				value={Number(value) || 0}
				unit={timeUnit}
				rate={sampleRate}
				format={timeUnit === 'samples' ? 'samples' : 'hh:mm:ss+milliseconds'}
				minimum={knobRange?.[0] ?? 0}
				maximum={knobRange?.[1]}
				disabled={disabled}
				onCommit={commit}
			/> : <CommitField
				label={label}
				name={hook}
				value={String(value ?? '')}
				type="number"
				disabled={disabled}
				hookName="effect-number-input"
				visuallyHiddenLabel
				onCommit={(_name, raw) => commit(raw)}
			/>}
		</div>
	);
}

/**
 * The unit a parameter's timecode counts in, or null when it takes a knob or a
 * slider instead. An attack, a release, a lookahead or a fade length is bounded
 * at both ends, so it keeps the control its effect gives every other parameter
 * of the same shape. A duration that sets how long the audio ends up, and a
 * value with no real maximum, both get the timecode — the latter so hours can
 * be typed straight in rather than counted out in seconds.
 */
export function timeCodeUnit(effectType, name, unit, range) {
	if (!effectParameterTakesTimeCode(effectType, name, range)) return null;
	if (unit === 's') return 'seconds';
	if (unit === 'ms') return 'milliseconds';
	if (unit === 'samples') return 'samples';
	return null;
}
