/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import VideoEffectNumberInput from './VideoEffectNumberInput.tsx';

export interface VideoColorWheelValueV1 { readonly hue: number; readonly saturation: number; readonly luminance: number }
export interface VideoColorWheelControlCopy {
	readonly hue: string; readonly saturation: string; readonly luminance: string; readonly exact: string;
	readonly reset: string; readonly instructions: string; readonly invalid: string;
}
export interface VideoColorWheelControlProps {
	readonly label: string; readonly value: VideoColorWheelValueV1; readonly messages: VideoColorWheelControlCopy;
	readonly disabled: boolean; readonly isCurrent: () => boolean;
	readonly onBegin: () => void; readonly onPreview: (value: Readonly<VideoColorWheelValueV1>) => void;
	readonly onCommit: () => void; readonly onCancel: () => void;
}
const AXES = Object.freeze(['hue', 'saturation', 'luminance'] as const);
const MINIMUM = Object.freeze({ hue: -180, saturation: 0, luminance: -100 });
const MAXIMUM = Object.freeze({ hue: 180, saturation: 100, luminance: 100 });

/** Controlled authoring admits only the three finite scalars before any host gesture. */
export function normalizeVideoColorWheelValueV1(value: unknown): Readonly<VideoColorWheelValueV1> {
	const input = record(value, 'color wheel control value', AXES), output = {} as Record<typeof AXES[number], number>;
	for (const name of AXES) {
		const number = field(input, name, 'color wheel control value');
		if (typeof number !== 'number' || !Number.isFinite(number) || number < MINIMUM[name] || number > MAXIMUM[name]) {
			throw new RangeError('Color wheel control values are outside their finite bounds.');
		}
		output[name] = Object.is(number, -0) ? 0 : number;
	}
	return Object.freeze(output);
}
interface Gesture { readonly original: VideoColorWheelValueV1; readonly commit: () => void; readonly cancel: () => void }
interface Capture { readonly id: number; readonly release: () => void }

/** A shared polar control, with keyboard axes and exact numeric alternatives.
 * Parent effect menus own reachability, current binding, preview and durable commit. */
export default function VideoColorWheelControl(props: Readonly<VideoColorWheelControlProps>) {
	const { label, messages, disabled, isCurrent } = props, value = normalizeVideoColorWheelValueV1(props.value);
	const [error, setError] = useState(''), instructionId = useId();
	const live = useRef(true), borrowed = useRef(false), latest = useRef<object | null>(null), generation = {};
	const active = useRef<Gesture | null>(null), pointer = useRef<Capture | null>(null), draft = useRef(value), invalid = useRef(false);
	latest.current = generation; draft.current = value;
	const host = useCallback((work: () => void) => {
		const previous = borrowed.current; borrowed.current = true; try { work(); } finally { borrowed.current = previous; }
	}, []);
	const release = useCallback(() => { const capture = pointer.current; pointer.current = null; capture?.release(); }, []);
	const settle = useCallback((work: (() => void) | undefined) => { host(() => {
		let failed = false, failure: unknown;
		try { release(); } catch (error) { failed = true; failure = error; }
		try { work?.(); } catch (cleanup) {
			if (failed) throw new AggregateError([failure, cleanup], 'Color wheel gesture retirement failed.', { cause: cleanup });
			throw cleanup;
		}
		if (failed) throw failure;
	}); }, [release, host]);
	const retire = useCallback(() => {
		const gesture = active.current; active.current = null;
		if (gesture) draft.current = gesture.original;
		settle(gesture?.cancel);
	}, [settle]);
	useEffect(() => { live.current = true; return () => { live.current = false; retire(); }; }, [retire]);
	useEffect(() => { if (disabled || !isCurrent()) retire(); }, [disabled, isCurrent, retire]);
	const current = () => live.current && !borrowed.current && latest.current === generation && !disabled && isCurrent();
	const begin = () => {
		if (!current()) return false;
		let gesture = active.current;
		if (!gesture) {
			gesture = { original: draft.current, commit: () => props.onCommit(), cancel: () => props.onCancel() }; active.current = gesture;
			invalid.current = false;
			try { host(() => props.onBegin()); } catch (error) { active.current = null; throw error; }
		}
		return current() && active.current === gesture;
	};
	const preview = (next: unknown) => {
		if (!current()) return;
		let admitted: VideoColorWheelValueV1;
		try { admitted = normalizeVideoColorWheelValueV1(next); }
		catch { invalid.current = true; setError(messages.invalid); return; }
		if (!begin()) return;
		invalid.current = false; setError(''); draft.current = admitted; host(() => props.onPreview(admitted));
	};
	const cancel = () => { if (!current()) return; retire(); invalid.current = false; setError(''); };
	const commit = () => {
		if (!current()) return;
		if (invalid.current) { cancel(); return; }
		const gesture = active.current; active.current = null; settle(gesture?.commit);
	};
	const discrete = (next: VideoColorWheelValueV1) => { if (!current() || pointer.current) return; preview(next); commit(); };
	const polar = (event: PointerEvent<HTMLDivElement>): VideoColorWheelValueV1 | null => {
		const bounds = event.currentTarget.getBoundingClientRect(), radius = Math.min(bounds.width, bounds.height) / 2;
		if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.top)
			|| !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
		const x = event.clientX - bounds.left - bounds.width / 2, y = event.clientY - bounds.top - bounds.height / 2;
		return { hue: x === 0 && y === 0 ? draft.current.hue : Math.atan2(y, x) * 180 / Math.PI,
			saturation: Math.min(100, Math.hypot(x, y) / radius * 100), luminance: draft.current.luminance };
	};
	const angle = value.hue * Math.PI / 180, distance = value.saturation * 0.5;
	return <fieldset aria-label={label} disabled={disabled} data-video-color-wheel-control>
		<legend>{label}</legend>
		<p id={instructionId} className="audio-editor-panel-hint">{messages.instructions}</p>
		<div role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled}
			aria-valuemin={0} aria-valuemax={100} aria-valuenow={value.saturation}
			aria-valuetext={`${messages.hue}: ${String(value.hue)}°, ${messages.saturation}: ${String(value.saturation)}%`}
			aria-describedby={instructionId} data-video-color-wheel
			style={{ position: 'relative', width: '160px', height: '160px', borderRadius: '50%', touchAction: 'none',
				background: 'radial-gradient(circle closest-side, white, transparent), conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
				opacity: disabled ? 0.5 : 1 }}
			onPointerDown={event => {
				if (!current() || pointer.current || event.button !== 0) return;
				if (!polar(event)) return;
				// Native pointerdown precedes blur: finish the exact field's gesture,
				// then let focus end its local scratch before starting the polar drag.
				if (active.current) commit(); if (!current()) return;
				host(() => { event.currentTarget.focus?.(); });
				const next = polar(event); if (!next || !begin()) return; event.preventDefault();
				const target = event.currentTarget, id = event.pointerId;
				pointer.current = { id, release: () => {
					if (!target.hasPointerCapture || target.hasPointerCapture(id)) target.releasePointerCapture?.(id);
				} };
				try { host(() => { target.setPointerCapture?.(id); }); preview(next); } catch (error) {
					try { retire(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Color wheel pointer operation failed.', { cause: cleanup }); }
					throw error;
				}
			}} onPointerMove={event => {
				if (!current() || pointer.current?.id !== event.pointerId) return;
				const next = polar(event); if (next) { event.preventDefault(); preview(next); }
			}} onPointerUp={event => { if (pointer.current?.id === event.pointerId) commit(); }}
			onPointerCancel={event => { if (pointer.current?.id === event.pointerId) cancel(); }}
			onLostPointerCapture={event => { if (pointer.current?.id === event.pointerId) cancel(); }}
			onKeyDown={event => {
				if (!current() || pointer.current) return;
				const step = event.shiftKey ? 10 : 1, next = { ...draft.current };
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
					const hue = next.hue + (event.key === 'ArrowLeft' ? -step : step); next.hue = ((hue + 540) % 360) - 180;
				} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') next.saturation = Math.max(0, Math.min(100, next.saturation + (event.key === 'ArrowUp' ? step : -step)));
				else if (event.key === 'Home') next.saturation = 0;
				else if (event.key === 'End') next.saturation = 100;
				else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
				else return;
				event.preventDefault(); event.stopPropagation(); discrete(next);
			}}>
			<span aria-hidden="true" style={{ position: 'absolute', left: `${String(50 + Math.cos(angle) * distance)}%`,
				top: `${String(50 + Math.sin(angle) * distance)}%`, width: '10px', height: '10px', border: '2px solid black',
				borderRadius: '50%', transform: 'translate(-50%, -50%)', background: 'white', pointerEvents: 'none' }} />
		</div>
		{AXES.map(name => <label key={name}>{messages[name]}
			<VideoEffectNumberInput value={value[name]} minimum={MINIMUM[name]} maximum={MAXIMUM[name]} step={name === 'hue' ? 1 : 0.1}
				label={`${messages.exact}: ${label}: ${messages[name]}`} disabled={disabled}
				onBegin={() => { begin(); }} onPreview={number => { preview({ ...draft.current, [name]: number }); }} onCommit={commit} onCancel={cancel} />
		</label>)}
		<button type="button" disabled={disabled} aria-label={`${messages.reset}: ${label}`}
			onClick={() => { discrete({ hue: 0, saturation: 0, luminance: 0 }); }}>{messages.reset}</button>
		{error && <p role="alert">{error}</p>}
	</fieldset>;
}
