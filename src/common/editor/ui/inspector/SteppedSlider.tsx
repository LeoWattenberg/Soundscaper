/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type CSSProperties } from 'react';
import { useNativeRangeTouchOwner } from '../useNativeRangeTouchOwner.ts';

interface SteppedSliderProps {
	readonly value: number;
	readonly defaultValue?: number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly ariaLabel?: string;
	readonly valueText?: string;
	readonly disabled?: boolean;
	readonly onChange: (value: number) => unknown;
	readonly onGestureStart?: (value: number) => unknown;
	readonly onGestureEnd?: (value: number) => unknown;
	readonly onGestureCancel?: () => unknown;
}

// v0.9.0's Slider parses values as integers and does not expose a step prop.
// Preserve its DOM/CSS contract while keeping Audacity's fractional parameters.
export function SteppedSlider({ value, defaultValue, min, max, step, ariaLabel, valueText, disabled, onChange,
	onGestureStart, onGestureEnd, onGestureCancel }: SteppedSliderProps) {
	const nativeRange = useNativeRangeTouchOwner();
	const clampedValue = Math.max(min, Math.min(max, Number(value) || 0));
	const gestureActiveRef = useRef(false);
	const pointerActiveRef = useRef(false);
	const pointerIdRef = useRef<number | null>(null);
	const canceledPointerRef = useRef(false);
	const gestureValueRef = useRef(clampedValue);
	const cancelRef = useRef(onGestureCancel);
	cancelRef.current = onGestureCancel;
	if (!gestureActiveRef.current) gestureValueRef.current = clampedValue;
	const beginGesture = () => {
		if (disabled || gestureActiveRef.current) return;
		canceledPointerRef.current = false;
		gestureActiveRef.current = true;
		gestureValueRef.current = clampedValue;
		void onGestureStart?.(clampedValue);
	};
	const endGesture = () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		void onGestureEnd?.(gestureValueRef.current);
	};
	const cancelGesture = () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		canceledPointerRef.current = pointerActiveRef.current;
		void onGestureCancel?.();
	};
	const finishPointer = () => {
		pointerIdRef.current = null;
		pointerActiveRef.current = false;
		endGesture();
		if (canceledPointerRef.current) requestAnimationFrame(() => {
			if (!pointerActiveRef.current) canceledPointerRef.current = false;
		});
	};
	useEffect(() => () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		void cancelRef.current?.();
	}, []);
	const percentage = max === min ? 0 : (clampedValue - min) / (max - min) * 100;
	return (
		<div
			className={`slider audio-editor-stepped-slider${disabled ? ' slider--disabled' : ''}`}
			style={{
				'--slider-track-bg': 'var(--line)',
				'--slider-fill-bg': 'var(--accent)',
				'--slider-handle-bg': 'var(--panel)',
				'--slider-handle-border': 'var(--accent-strong)',
			} as CSSProperties}
		>
			<input
				ref={nativeRange}
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
					if (canceledPointerRef.current) {
						event.currentTarget.value = String(clampedValue);
						if (!pointerActiveRef.current) canceledPointerRef.current = false;
						return;
					}
					const next = Number(event.currentTarget.value);
					const standalone = !gestureActiveRef.current;
					if (standalone) beginGesture();
					gestureValueRef.current = next;
					void onChange(next);
					if (standalone) endGesture();
				}}
				onPointerDown={(event) => {
					if (disabled || event.button !== 0 || event.isPrimary === false || pointerActiveRef.current) {
						event.preventDefault();
						return;
					}
					pointerIdRef.current = event.pointerId;
					pointerActiveRef.current = true;
					beginGesture();
				}}
				onPointerUp={(event) => {
					if (!pointerActiveRef.current || event.pointerId !== pointerIdRef.current) return;
					finishPointer();
				}}
				onPointerMove={(event) => {
					if (pointerActiveRef.current && event.pointerId === pointerIdRef.current
						&& event.pointerType === 'mouse' && (event.buttons & 1) === 0) finishPointer();
				}}
				onLostPointerCapture={(event) => {
					if (!pointerActiveRef.current || event.pointerId !== pointerIdRef.current) return;
					cancelGesture();
					pointerIdRef.current = null;
					pointerActiveRef.current = false;
				}}
				onPointerCancel={(event) => {
					if (!pointerActiveRef.current || event.pointerId !== pointerIdRef.current) return;
					cancelGesture();
					pointerIdRef.current = null;
					pointerActiveRef.current = false;
				}}
				onKeyDown={(event) => {
					if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) beginGesture();
					else if (event.key === 'Escape' && gestureActiveRef.current) {
						event.preventDefault();
						event.stopPropagation();
						cancelGesture();
					}
				}}
				onKeyUp={(event) => {
					if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) endGesture();
				}}
				onBlur={endGesture}
				onDoubleClick={(event) => {
					if (disabled || !onChange || !Number.isFinite(defaultValue)) return;
					event.preventDefault();
					event.stopPropagation();
					endGesture();
					const next = Math.max(min, Math.min(max, defaultValue!));
					void onGestureStart?.(clampedValue);
					void onChange(next);
					void onGestureEnd?.(next);
				}}
			/>
			<div className="slider__track"><div className="slider__fill" style={{ width: `${percentage}%` }} /></div>
			<div className="slider__handle" style={{ left: `calc(${percentage}% - ${percentage / 100 * 16}px)` }} />
		</div>
	);
}

