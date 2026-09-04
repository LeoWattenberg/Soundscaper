import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '@soundscaper/design-system/Dropdown';
import { TextInput } from '@soundscaper/design-system/TextInput';

import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';

export function CommitField({ label, name, value, type = 'text', disabled, readOnly, multiline, hookName = 'clip-field', visuallyHiddenLabel = false, onCommit }) {
	const [draft, setDraft] = useState(String(value ?? ''));
	const [error, setError] = useState(false);
	useEffect(() => {
		setDraft(String(value ?? ''));
		setError(false);
	}, [name, value]);
	const commit = () => {
		if (disabled || readOnly) return;
		try {
			onCommit(name, draft);
			setError(false);
		} catch {
			setError(true);
		}
	};
	const hook = { [`data-${hookName}`]: name };
	return (
		<label className="audio-editor-field" {...hook}>
			<span className={visuallyHiddenLabel ? 'kw-audio-editor-sr-only' : undefined}>{label}</span>
			<TextInput
				value={draft}
				type={type}
				multiline={multiline}
				disabled={disabled || readOnly}
				error={error}
				onChange={setDraft}
				onBlur={commit}
				width="100%"
			/>
		</label>
	);
}

export function LabeledDropdown({ label, options, value, onChange, disabled, hook }) {
	const wrapperRef = useRef(null);
	const availableOptions = options.filter((option) => !option.disabled);
	const dataHook = dropdownDataHook(hook);
	const handleChange = (next) => {
		if (!availableOptions.some((option) => option.value === next)) return;
		onChange(next);
	};
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="audio-editor-field" role="group" aria-label={label} {...dataHook}>
			<span>{label}</span>
			<Dropdown options={availableOptions} value={value} onChange={handleChange} disabled={disabled} width="100%" />
		</div>
	);
}

export function DesignCheckbox({ label, checked, disabled, onChange }) {
	return <PreferenceCheckbox label={label} checked={checked} disabled={disabled} onChange={onChange} />;
}

export function ActionHook({ hook, children }) {
	return <span data-clip-action={hook}>{children}</span>;
}

// v0.9.0's Slider parses values as integers and does not expose a step prop.
// Preserve its DOM/CSS contract while keeping Audacity's fractional parameters.
export function SteppedSlider({ value, min, max, step, ariaLabel, valueText, disabled, onChange,
	onGestureStart, onGestureEnd, onGestureCancel }) {
	const clampedValue = Math.max(min, Math.min(max, Number(value) || 0));
	const gestureActiveRef = useRef(false);
	const gestureValueRef = useRef(clampedValue);
	const cancelRef = useRef(onGestureCancel);
	cancelRef.current = onGestureCancel;
	if (!gestureActiveRef.current) gestureValueRef.current = clampedValue;
	const beginGesture = () => {
		if (disabled || gestureActiveRef.current) return;
		gestureActiveRef.current = true;
		gestureValueRef.current = clampedValue;
		onGestureStart?.(clampedValue);
	};
	const endGesture = () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		onGestureEnd?.(gestureValueRef.current);
	};
	const cancelGesture = () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		onGestureCancel?.();
	};
	useEffect(() => () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		cancelRef.current?.();
	}, []);
	const percentage = max === min ? 0 : (clampedValue - min) / (max - min) * 100;
	return (
		<div
			className={`slider audio-editor-stepped-slider${disabled ? ' slider--disabled' : ''}`}
			style={{
				'--slider-track-bg': 'var(--kw-editor-line)',
				'--slider-fill-bg': 'var(--kw-editor-accent)',
				'--slider-handle-bg': 'var(--kw-editor-panel)',
				'--slider-handle-border': 'var(--kw-editor-accent-strong)',
			}}
		>
			<input
				type="range"
				className="slider__input"
				value={clampedValue}
				min={min}
				max={max}
				step={step}
				aria-label={ariaLabel}
				aria-valuetext={valueText}
				disabled={disabled}
				onChange={(event) => {
					const next = Number(event.currentTarget.value);
					const standalone = !gestureActiveRef.current;
					if (standalone) beginGesture();
					gestureValueRef.current = next;
					onChange(next);
					if (standalone) endGesture();
				}}
				onPointerDown={beginGesture}
				onPointerUp={endGesture}
				onPointerCancel={cancelGesture}
				onKeyDown={(event) => {
					if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) beginGesture();
					else if (event.key === 'Escape') cancelGesture();
				}}
				onKeyUp={(event) => {
					if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) endGesture();
				}}
				onBlur={endGesture}
			/>
			<div className="slider__track"><div className="slider__fill" style={{ width: `${percentage}%` }} /></div>
			<div className="slider__handle" style={{ left: `calc(${percentage}% - ${percentage / 100 * 16}px)` }} />
		</div>
	);
}

function dropdownDataHook(hook) {
	if (['output', 'mode', 'range', 'format', 'bitDepth', 'quality', 'sampleRate', 'channelMapping', 'dither', 'loudnessNormalization'].includes(hook)) {
		return { 'data-export-field': hook };
	}
	if (hook === 'effect-type') return { 'data-effect-type': '' };
	if (hook === 'audacity-effect-type') return { 'data-audacity-effect-type': '' };
	if (hook === 'video-effect-picker') return { 'data-video-effect-picker': '' };
	if (hook === 'audacity-control-track') return { 'data-audacity-control-track': '' };
	if (hook?.startsWith('effect-param-')) return { 'data-effect-param': hook.slice('effect-param-'.length) };
	if (hook === 'effect-context-controlTrackId') return { 'data-effect-context': 'controlTrackId' };
	return hook ? { 'data-effect-field': hook } : {};
}
