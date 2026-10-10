/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type PointerEvent } from 'react';
import { retainNativeRangeMouseCustody } from '../controller/effects/native-range-mouse-custody.ts';
import { useNativeRangeTouchOwner } from './useNativeRangeTouchOwner.ts';

interface ParametricEqOutputRangeProps {
	readonly disabled: boolean;
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly onBegin: () => void;
	readonly onValueChange: (value: number) => void;
	readonly onFinish: () => void;
	readonly onCancel: () => void;
	readonly onReset: () => void;
}

const RANGE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

export function ParametricEqOutputRange({ disabled, value, minimum, maximum, onBegin,
	onValueChange, onFinish, onCancel, onReset }: ParametricEqOutputRangeProps) {
	const owner = useRef<number | null>(null);
	const input = useNativeRangeTouchOwner();
	const mouseCustody = useRef<(() => void) | null>(null);
	const callbacks = useRef({ onFinish, onCancel });
	callbacks.current = { onFinish, onCancel };
	const retireMouse = (): void => { mouseCustody.current?.(); mouseCustody.current = null; };
	useEffect(() => () => { mouseCustody.current?.(); mouseCustody.current = null; owner.current = null; }, []);
	const finishMouse = (canceled: boolean): void => {
		owner.current = null;
		retireMouse();
		if (canceled) callbacks.current.onCancel(); else callbacks.current.onFinish();
	};
	const finish = (event: PointerEvent<HTMLInputElement>, canceled: boolean): void => {
		if (owner.current !== event.pointerId) return;
		owner.current = null;
		retireMouse();
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		if (canceled) onCancel(); else onFinish();
	};
	return <input ref={input} disabled={disabled} type="range" min={minimum} max={maximum} step="0.1" value={value}
		onPointerDown={event => {
			if (disabled || event.button !== 0) return;
			if (event.isPrimary === false || owner.current !== null) { event.preventDefault(); return; }
			owner.current = event.pointerId;
			onBegin();
			if (event.pointerType === 'mouse') {
				mouseCustody.current = retainNativeRangeMouseCustody(event.currentTarget.ownerDocument, event.pointerId, {
					finish: () => finishMouse(false), cancel: () => finishMouse(true),
				});
			} else event.currentTarget.setPointerCapture?.(event.pointerId);
		}}
		onChange={event => onValueChange(Number(event.currentTarget.value))}
		onPointerMove={event => {
			if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) finish(event, false);
		}}
		onPointerUp={event => finish(event, false)}
		onPointerCancel={event => finish(event, true)}
		onLostPointerCapture={event => finish(event, true)}
		onKeyDown={event => { if (RANGE_KEYS.includes(event.key) && owner.current === null) onBegin(); }}
		onKeyUp={event => { if (RANGE_KEYS.includes(event.key) && owner.current === null) onFinish(); }}
		onBlur={() => { owner.current = null; retireMouse(); onFinish(); }}
		onDoubleClick={event => {
			if (disabled) return;
			event.preventDefault(); event.stopPropagation();
			owner.current = null; retireMouse(); onFinish(); onReset();
		}}
	/>;
}
