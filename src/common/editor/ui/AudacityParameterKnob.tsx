/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type CSSProperties } from 'react';
import { Knob, type KnobProps } from '@soundscaper/design-system/Knob';
import { audacityKnobPosition, audacityKnobValue } from './audacity-knob-warp.ts';
import './AudacityParameterKnob.css';

interface AudacityParameterKnobProps extends KnobProps {
	readonly defaultValue?: number;
}

/** Audacity's default-centred dial with an accessible slider in actual units. */
export default function AudacityParameterKnob({
	value = 0, min = 0, max = 1, step = 1, defaultValue, label,
	disabled = false, onChange, onGestureStart, onGestureEnd, onGestureCancel,
}: AudacityParameterKnobProps) {
	const actual = Math.max(min, Math.min(max, value));
	const position = audacityKnobPosition(actual, min, max, defaultValue);
	const keyboardGesture = useRef(false);
	const keyboardValue = useRef(actual);
	const accessibleRef = useRef<HTMLSpanElement>(null);
	const callbacks = useRef({ onGestureEnd, onGestureCancel });
	callbacks.current = { onGestureEnd, onGestureCancel };
	const precision = Number.isFinite(step) && step > 0 ? step : 0.01;
	const fromPosition = (next: number) => {
		const parameter = audacityKnobValue(next, min, max, defaultValue);
		const snapped = min + Math.round((parameter - min) / precision) * precision;
		return Math.max(min, Math.min(max, Number(snapped.toFixed(8))));
	};
	const finishKeyboardGesture = () => {
		if (!keyboardGesture.current) return;
		keyboardGesture.current = false;
		callbacks.current.onGestureEnd?.(keyboardValue.current);
	};
	useEffect(() => () => {
		if (keyboardGesture.current) callbacks.current.onGestureCancel?.();
	}, []);
	return <span
		className="audio-editor-audacity-knob"
		style={{
			'--audacity-knob-angle': `${-140 + position * 280}deg`,
			'--audacity-knob-sweep': `${position * 280}deg`,
		} as CSSProperties}
		onPointerDownCapture={() => { if (!disabled) accessibleRef.current?.focus(); }}
		onDoubleClick={() => {
			if (disabled || !onChange || defaultValue === undefined) return;
			const next = Math.max(min, Math.min(max, defaultValue));
			onGestureStart?.(actual);
			onChange(next);
			onGestureEnd?.(next);
		}}
	>
		<span
			className="audio-editor-audacity-knob__accessible"
			ref={accessibleRef}
			role="slider"
			tabIndex={disabled ? -1 : 0}
			aria-disabled={disabled}
			aria-label={label ? `${label}: ${actual}` : String(actual)}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={actual}
			onKeyDown={event => {
				if (disabled || !onChange) return;
				if (event.key === 'Escape' && keyboardGesture.current) {
					event.preventDefault();
					event.stopPropagation();
					keyboardGesture.current = false;
					onGestureCancel?.();
					return;
				}
				if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return;
				event.preventDefault();
				event.stopPropagation();
				if (!keyboardGesture.current) {
					keyboardGesture.current = true;
					keyboardValue.current = actual;
					onGestureStart?.(actual);
				}
				const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
				const next = Math.max(min, Math.min(max, Number((keyboardValue.current + direction * precision * (event.shiftKey ? 10 : 1)).toFixed(8))));
				if (next === keyboardValue.current) return;
				keyboardValue.current = next;
				onChange(next);
			}}
			onKeyUp={event => {
				if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) finishKeyboardGesture();
			}}
			onBlur={finishKeyboardGesture}
		/>
		<span aria-hidden="true">
			<Knob value={position} min={0} max={1} step={1e-8} mode="unipolar"
				accentColor="var(--audacity-knob-accent, #926BFF)" disabled={disabled} tabIndex={-1}
				onChange={next => onChange?.(fromPosition(next))}
				onGestureStart={() => onGestureStart?.(actual)}
				onGestureEnd={next => onGestureEnd?.(fromPosition(next))}
				onGestureCancel={onGestureCancel}
			/>
		</span>
	</span>;
}
