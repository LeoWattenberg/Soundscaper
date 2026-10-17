/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { BRUSH_MASK_RESOURCE_LIMITS_V1 } from './brush-mask-resource-v1.ts';

export const BRUSH_MASK_PLANE_LIMITS_V1 = Object.freeze({ maximumStrokes: 64, maximumPoints: 4096,
	maximumStamps: 65_536, maximumPixelVisits: 16_777_216 });
export interface BrushMaskPointV1 { readonly x: number; readonly y: number; }
export interface BrushMaskStrokeV1 {
	readonly mode: 'paint' | 'erase';
	readonly radius: number;
	readonly hardness: number;
	readonly opacity: number;
	readonly points: readonly Readonly<BrushMaskPointV1>[];
}
export interface BrushMaskHistoryV1 { readonly schemaVersion: 1; readonly strokes: readonly Readonly<BrushMaskStrokeV1>[]; readonly cursor: number; }
export interface BrushMaskPlaneRequestV1 {
	readonly width: number;
	readonly height: number;
	readonly baseAlpha: unknown;
	readonly history: unknown;
	readonly signal?: AbortSignal;
}
type Alpha = Uint8Array<ArrayBuffer>;
type Stamp = Readonly<{ x: number; y: number; stroke: Readonly<BrushMaskStrokeV1> }>;
const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const CHECK = AbortSignal.prototype.throwIfAborted, SIGNAL_PROTOTYPE = AbortSignal.prototype;

export function normalizeBrushMaskStrokeV1(value: unknown): Readonly<BrushMaskStrokeV1> {
	const input = record(value, 'brush stroke', ['mode', 'radius', 'hardness', 'opacity', 'points']);
	const mode = field(input, 'mode', 'brush stroke');
	if (mode !== 'paint' && mode !== 'erase') throw new TypeError('Brush stroke mode requires paint or erase.');
	const radius = fraction(field(input, 'radius', 'brush stroke'));
	if (radius === 0) throw new RangeError('Brush radius must be positive.');
	const hardness = fraction(field(input, 'hardness', 'brush stroke')), opacity = fraction(field(input, 'opacity', 'brush stroke'));
	const points = array(field(input, 'points', 'brush stroke'), 'brush points', 1, 4096).map(value => {
		const point = record(value, 'brush point', ['x', 'y']);
		return Object.freeze({ x: fraction(field(point, 'x', 'brush point')), y: fraction(field(point, 'y', 'brush point')) });
	});
	return Object.freeze({ mode, radius, hardness, opacity, points: Object.freeze(points) });
}

/** Body-free local history; every admitted retained point (including redo)
 * counts. Append drops the redo suffix, never mutates a predecessor snapshot. */
export function normalizeBrushMaskHistoryV1(value: unknown): Readonly<BrushMaskHistoryV1> {
	const input = record(value, 'brush history', ['schemaVersion', 'strokes', 'cursor']);
	if (field(input, 'schemaVersion', 'brush history') !== 1) throw new TypeError('Brush history version is unsupported.');
	const strokes = array(field(input, 'strokes', 'brush history'), 'brush strokes', 0, 64).map(normalizeBrushMaskStrokeV1);
	if (strokes.reduce((count, stroke) => count + stroke.points.length, 0) > 4096) throw new RangeError('Brush history exceeds its point capacity.');
	const cursor = field(input, 'cursor', 'brush history');
	if (typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || Object.is(cursor, -0) || cursor < 0 || cursor > strokes.length) {
		throw new RangeError('Brush history cursor must name an admitted stroke boundary.');
	}
	return Object.freeze({ schemaVersion: 1, strokes: Object.freeze(strokes), cursor });
}
export function createBrushMaskHistoryV1(): Readonly<BrushMaskHistoryV1> {
	return Object.freeze({ schemaVersion: 1, strokes: Object.freeze([]), cursor: 0 });
}
export function appendBrushMaskStrokeV1(historyValue: unknown, strokeValue: unknown): Readonly<BrushMaskHistoryV1> {
	const history = normalizeBrushMaskHistoryV1(historyValue), stroke = normalizeBrushMaskStrokeV1(strokeValue);
	const strokes = [...history.strokes.slice(0, history.cursor), stroke];
	return normalizeBrushMaskHistoryV1({ schemaVersion: 1, strokes, cursor: strokes.length });
}
export function undoBrushMaskHistoryV1(value: unknown): Readonly<BrushMaskHistoryV1> {
	const history = normalizeBrushMaskHistoryV1(value); return Object.freeze({ ...history, cursor: Math.max(0, history.cursor - 1) });
}
export function redoBrushMaskHistoryV1(value: unknown): Readonly<BrushMaskHistoryV1> {
	const history = normalizeBrushMaskHistoryV1(value); return Object.freeze({ ...history, cursor: Math.min(history.strokes.length, history.cursor + 1) });
}

/** Capture an exact <=1MiB base copy and detached history before yielding.
 * Replay mutates only that disposable copy, with an independently bounded
 * stamp/visit ledger. The consumer joins before wiping; the UI's immutable
 * base and other simultaneous resource spans belong to its separate budget.
 * No RGBA/original/catalog/renderer capability or persistence is acquired. */
export async function withBrushMaskPlaneV1<Result>(value: unknown, consume: (alpha: Alpha) => Result | Promise<Result>): Promise<Result> {
	const input = record(value, 'brush replay', ['width', 'height', 'baseAlpha', 'history', 'signal'], ['width', 'height', 'baseAlpha', 'history']);
	const signal = captureSignal(input); check(signal);
	if (typeof consume !== 'function') throw new TypeError('Brush replay requires a scoped consumer.');
	const width = dimension(field(input, 'width', 'brush replay')), height = dimension(field(input, 'height', 'brush replay'));
	const history = normalizeBrushMaskHistoryV1(field(input, 'history', 'brush replay'));
	admitWork(history, width, height); check(signal);
	const alpha = copyAlpha(field(input, 'baseAlpha', 'brush replay'), width * height), backing = alpha.buffer;
	const work = paint(history, width, height, alpha);
	try {
		let next = work.next();
		while (!next.done) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(signal); next = work.next(); }
		check(signal); const result = await consume(alpha); check(signal); return result;
	} finally { work.return(); if (Reflect.apply(SIZE, backing, []) > 0) Reflect.apply(FILL, alpha, [0]); }
}

function* stamps(history: Readonly<BrushMaskHistoryV1>, width: number, height: number): Generator<Stamp, void, void> {
	for (let index = 0; index < history.cursor; index++) {
		const stroke = history.strokes[index]!, first = stroke.points[0]!;
		yield { x: first.x * width, y: first.y * height, stroke };
		const spacing = Math.max(0.5, stroke.radius * Math.min(width, height) / 4);
		for (let point = 1; point < stroke.points.length; point++) {
			const previous = stroke.points[point - 1]!, current = stroke.points[point]!;
			const dx = (current.x - previous.x) * width, dy = (current.y - previous.y) * height;
			const steps = Math.ceil(Math.hypot(dx, dy) / spacing);
			for (let step = 1; step <= steps; step++) yield { x: previous.x * width + dx * step / steps, y: previous.y * height + dy * step / steps, stroke };
		}
	}
}
function bounds(stamp: Stamp, width: number, height: number) {
	const radius = stamp.stroke.radius * Math.min(width, height);
	return { radius, left: Math.max(0, Math.ceil(stamp.x - radius - 0.5)), right: Math.min(width - 1, Math.floor(stamp.x + radius - 0.5)),
		top: Math.max(0, Math.ceil(stamp.y - radius - 0.5)), bottom: Math.min(height - 1, Math.floor(stamp.y + radius - 0.5)) };
}
function admitWork(history: Readonly<BrushMaskHistoryV1>, width: number, height: number): void {
	let count = 0, visits = 0;
	for (const stamp of stamps(history, width, height)) {
		if (++count > BRUSH_MASK_PLANE_LIMITS_V1.maximumStamps) throw new RangeError('Brush replay exceeds its stamp work budget.');
		if (stamp.stroke.opacity === 0) continue;
		const box = bounds(stamp, width, height); visits += Math.max(0, box.right - box.left + 1) * Math.max(0, box.bottom - box.top + 1);
		if (visits > BRUSH_MASK_PLANE_LIMITS_V1.maximumPixelVisits) throw new RangeError('Brush replay exceeds its pixel visit work budget.');
	}
}
function* paint(history: Readonly<BrushMaskHistoryV1>, width: number, height: number, alpha: Alpha): Generator<void, void, void> {
	let visits = 0, count = 0;
	for (const stamp of stamps(history, width, height)) {
		const box = bounds(stamp, width, height), { stroke } = stamp;
		if (stroke.opacity > 0) for (let y = box.top; y <= box.bottom; y++) for (let x = box.left; x <= box.right; x++) {
			const distance = Math.hypot(x + 0.5 - stamp.x, y + 0.5 - stamp.y) / box.radius;
			const coverage = stroke.hardness === 1 ? (distance <= 1 ? 255 : 0)
				: distance <= stroke.hardness ? 255 : distance >= 1 ? 0 : Math.round(255 * (1 - distance) / (1 - stroke.hardness));
			const amount = Math.round(stroke.opacity * coverage), offset = y * width + x, old = alpha[offset]!;
			alpha[offset] = stroke.mode === 'paint' ? old + Math.round((255 - old) * amount / 255) : Math.round(old * (255 - amount) / 255);
			if (++visits % 65_536 === 0) yield;
		}
		if (++count % 256 === 0) yield;
	}
}
function fraction(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < 0 || value > 1) throw new RangeError('Brush fractions require canonical finite values from 0 through 1.');
	return value;
}
function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > BRUSH_MASK_RESOURCE_LIMITS_V1.maximumSide) throw new RangeError('Brush dimensions require integers from 1 through 1024.');
	return value;
}
function captureSignal(input: Readonly<Record<string, unknown>>): AbortSignal | undefined {
	const value = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'brush replay') : undefined;
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null) throw new TypeError('Brush replay requires a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== SIGNAL_PROTOTYPE || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Brush replay cancellation may not shadow native behavior.');
	}
	return value as AbortSignal;
}
function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function copyAlpha(value: unknown, length: number): Alpha {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('Brush alpha requires native Uint8Array bytes.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value as object, key)) throw new TypeError('Brush alpha geometry may not be shadowed.');
	const backing = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	if (Reflect.apply(RESIZABLE, backing, []) !== false || Reflect.apply(SIZE, backing, []) !== length
		|| Reflect.apply(LENGTH, value, []) !== length || Reflect.apply(OFFSET, value, []) !== 0) throw new RangeError('Brush alpha requires its exact fixed native backing.');
	const copy = new NativeBytes(length); Reflect.apply(SET, copy, [new NativeBytes(backing)]); return copy;
}
