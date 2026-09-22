/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Browser adaptation of GraphicEqBoard.qml, GraphicEqFader.qml and
 * GraphicEqGridLines.qml, Audacity Team, GPLv3, revision
 * 16f2713979809abe7308b4e1e0d487afeece84f2. Adapted for kw.media in 2026
 * using the Audacity design system's mixer faders and editor automation.
 */
import './GraphicEqEditor.css';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { MixerFader } from '@soundscaper/design-system/MixerFader';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { createGraphicEqGesture, type GraphicEqPointer } from '../../controller/effects/graphic-eq-gesture.ts';

interface BandGestures {
	onGestureBegin?(value: number): void;
	onGesturePreview?(value: number): void;
	onGestureCommit?(value: number): void;
	onGestureCancel?(): void;
}
interface Props {
	readonly name: string;
	readonly label: string;
	readonly descriptor: Readonly<{ frequencies: readonly number[]; default: readonly number[]; minimum: number; maximum: number; step: number }>;
	readonly value?: readonly number[];
	readonly disabled: boolean;
	readonly copy: Readonly<Record<string, string>>;
	gestureFor(parameterId: string, elementId: string): BandGestures;
	onCommit(gains: readonly number[], automation?: Readonly<{ controlValue: number; elementId: string; parameterId: string }>): void;
}

export default function GraphicEqEditor({ name, label, descriptor, value, disabled, copy, gestureFor, onCommit }: Props) {
	const values = value ?? descriptor.default;
	const [draft, setDraft] = useState<readonly number[] | null>(null);
	const points = draft ?? values;
	const gesture = useRef(createGraphicEqGesture(descriptor));
	const pointer = useRef<number | null>(null);
	const elements = useRef<Array<HTMLDivElement | null>>([]);
	const routed = useRef(new Map<number, BandGestures>());
	const previous = useRef(values);
	const latest = useRef(values);
	latest.current = values;
	const elementId = (index: number): string => `frequency:${String(descriptor.frequencies[index])}`;
	const canRoute = (callbacks: BandGestures): boolean => Boolean(callbacks.onGestureBegin && callbacks.onGesturePreview && callbacks.onGestureCommit);
	const cancel = (): void => {
		gesture.current.cancel(); pointer.current = null;
		for (const callbacks of routed.current.values()) callbacks.onGestureCancel?.();
		routed.current.clear(); setDraft(null);
	};
	useEffect(() => {
		const session = gesture.current;
		const callbacks = routed.current;
		return () => {
			session.cancel();
			for (const entry of callbacks.values()) entry.onGestureCancel?.();
			callbacks.clear();
		};
	}, []);
	const atEvent = (event: PointerEvent<HTMLDivElement>): GraphicEqPointer => ({ x: event.clientX, y: event.clientY });
	const preview = (next: readonly number[] | null): void => {
		if (!next) return;
		for (const [index, gain] of next.entries()) {
			if (gain === previous.current[index]) continue;
			let callbacks = routed.current.get(index);
			if (!callbacks) {
				const candidate = gestureFor(name, elementId(index));
				if (canRoute(candidate)) {
					callbacks = candidate; routed.current.set(index, callbacks);
					callbacks.onGestureBegin?.(latest.current[index]!);
				}
			}
			callbacks?.onGesturePreview?.(gain);
		}
		previous.current = next; setDraft(next);
	};
	const begin = (event: PointerEvent<HTMLDivElement>): void => {
		if (disabled || event.button !== 0 || pointer.current !== null) return;
		const bounds = elements.current.map((element) => element!.querySelector('[role="slider"]')!.getBoundingClientRect());
		if (!bounds.length || event.clientY < bounds[0]!.top || event.clientY > bounds[0]!.bottom) return;
		event.preventDefault(); event.stopPropagation();
		pointer.current = event.pointerId;
		event.currentTarget.setPointerCapture(event.pointerId);
		const focusTarget = (event.target as Element).closest<HTMLElement>('[role="slider"]') ?? event.currentTarget;
		focusTarget.focus();
		previous.current = values;
		preview(gesture.current.begin(values, bounds, atEvent(event)));
	};
	const finish = (event: PointerEvent<HTMLDivElement>): void => {
		if (pointer.current !== event.pointerId) return;
		if (disabled) { cancel(); return; }
		preview(gesture.current.move(atEvent(event)));
		const next = gesture.current.complete();
		pointer.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		if (next) {
			const unrouted = next.indices.filter((index) => !routed.current.has(index));
			const commit = [...latest.current];
			for (const index of unrouted) commit[index] = next.gains[index]!;
			for (const [index, callbacks] of routed.current) callbacks.onGestureCommit?.(next.gains[index]!);
			if (unrouted.length) onCommit(commit);
		}
		routed.current.clear(); setDraft(null);
	};
	const atomic = (index: number, raw: number): void => {
		if (disabled || pointer.current !== null) return;
		const gain = Math.max(descriptor.minimum, Math.min(descriptor.maximum, Math.round(raw / descriptor.step) * descriptor.step));
		const callbacks = gestureFor(name, elementId(index));
		if (canRoute(callbacks)) {
			callbacks.onGestureBegin?.(points[index]!);
			callbacks.onGesturePreview?.(gain);
			callbacks.onGestureCommit?.(gain);
			return;
		}
		const next = [...points]; next[index] = gain;
		onCommit(next, { controlValue: gain, elementId: elementId(index), parameterId: name });
	};
	const ticks: number[] = [];
	for (let gain = Math.ceil(descriptor.minimum / 6) * 6; gain <= descriptor.maximum; gain += 6) ticks.push(gain);
	const frequencyText = (frequency: number): string => frequency >= 1_000 ? `${String(frequency / 1_000)}k` : String(frequency);

	return <div className="audio-editor-graphic-eq" role="group" aria-label={label} data-effect-param={name}>
		<div className="audio-editor-graphic-eq__viewport">
			<div className="audio-editor-graphic-eq__board" tabIndex={-1}
				onPointerDownCapture={begin} onPointerMoveCapture={(event) => {
					if (pointer.current === event.pointerId && !disabled) preview(gesture.current.move(atEvent(event)));
				}} onPointerUpCapture={finish} onPointerCancel={cancel}
				onLostPointerCapture={() => { if (pointer.current !== null) cancel(); }}
				onDoubleClick={(event) => {
					if (disabled || event.button !== 0) return;
					const index = elements.current.findIndex((element) => {
						const box = element!.querySelector('[role="slider"]')!.getBoundingClientRect();
						return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
					});
					if (index >= 0) atomic(index, 0);
				}} onKeyDown={(event) => {
					if (event.key === 'Escape' && pointer.current !== null) {
						event.preventDefault(); event.stopPropagation(); cancel();
					}
				}}>
				<div className="audio-editor-graphic-eq__grid" aria-hidden="true">
					<span className="audio-editor-graphic-eq__unit">{'dB'}</span>
					{ticks.map((gain) => <div key={gain} className={`audio-editor-graphic-eq__gridline${gain === 0 ? ' audio-editor-graphic-eq__gridline--zero' : ''}`}
						style={{ top: `${String((descriptor.maximum - gain) / (descriptor.maximum - descriptor.minimum) * 100)}%` }}><span>{gain}</span></div>)}
				</div>
				{descriptor.frequencies.map((frequency, index) => <div key={frequency} ref={(element) => { elements.current[index] = element; }}
					className="audio-editor-graphic-eq__fader" data-effect-param={`${name}.${String(index)}`}
					title={(copy.effectCurvePoint || canonicalCopyValue('effectCurvePoint')).replace('{frequency}', String(frequency)).replace('{gain}', points[index]!.toFixed(1))}
					onKeyDownCapture={(event) => {
						if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
						event.preventDefault(); event.stopPropagation();
						atomic(index, points[index]! + (event.key === 'ArrowUp' ? 1 : -1));
					}}>
					<span>{frequencyText(frequency)}</span>
					<MixerFader value={points[index]} min={descriptor.minimum} max={descriptor.maximum} disabled={disabled}
						ariaLabel={`${String(frequency)} Hz`} onChange={(gain) => atomic(index, gain)} />
					<output>{points[index]!.toFixed(1)}</output>
				</div>)}
			</div>
		</div>
		<div className="audio-editor-panel-actions audio-editor-graphic-eq__actions">
			<Button variant="secondary" disabled={disabled} onClick={() => onCommit(descriptor.frequencies.map(() => 0))}>{copy.reset}</Button>
			<Button variant="secondary" disabled={disabled} onClick={() => onCommit(points.map((gain) => -gain))}>{copy.invert}</Button>
		</div>
	</div>;
}
