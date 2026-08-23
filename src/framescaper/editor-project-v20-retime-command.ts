/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
	type VideoRetimeCurveV16Binding,
} from '../common/editor/video-retime-v16.ts';
import type { VideoRetimeCurveRational } from '../common/editor/video-retime-curve.ts';

export type FramescaperVideoRetimeScopeV20 = 'timeline' | 'project-bin';

interface FramescaperVideoRetimeCommandBaseV20 {
	readonly scope: FramescaperVideoRetimeScopeV20;
	readonly clipId: string;
	readonly expectedRetimeMap: VideoRetimeCurveV16 | null;
}

export type FramescaperVideoRetimeCommandV20 = Readonly<
	| (FramescaperVideoRetimeCommandBaseV20 & {
		readonly type: 'video-retime/set';
		readonly retimeMap: VideoRetimeCurveV16;
	})
	| (FramescaperVideoRetimeCommandBaseV20 & { readonly type: 'video-retime/reset' })
	| (FramescaperVideoRetimeCommandBaseV20 & { readonly type: 'video-retime/constant' })
	| (FramescaperVideoRetimeCommandBaseV20 & { readonly type: 'video-retime/reverse' })
	| (FramescaperVideoRetimeCommandBaseV20 & {
		readonly type: 'video-retime/freeze';
		readonly sourceFrame: VideoRetimeCurveRational;
	})
	| (FramescaperVideoRetimeCommandBaseV20 & {
		readonly type: 'video-retime/ramp';
		readonly direction: 'forward' | 'reverse';
		readonly startVelocity: VideoRetimeCurveRational;
		readonly endVelocity: VideoRetimeCurveRational;
		readonly sourceStartFrame: VideoRetimeCurveRational;
	})
>;

type CommandType = FramescaperVideoRetimeCommandV20['type'];
type CommandInput<T extends CommandType> = Omit<Extract<FramescaperVideoRetimeCommandV20, {
	readonly type: T;
}>, 'type' | 'scope'> & Readonly<{ scope?: FramescaperVideoRetimeScopeV20 }>;

const BASE_FIELDS = ['type', 'scope', 'clipId', 'expectedRetimeMap'] as const;

export function createFramescaperVideoRetimeSetCommandV20(
	value: CommandInput<'video-retime/set'> | unknown,
): Extract<FramescaperVideoRetimeCommandV20, { readonly type: 'video-retime/set' }> {
	return createCommand('video-retime/set', value);
}

export function createFramescaperVideoRetimeResetCommandV20(
	value: CommandInput<'video-retime/reset'> | unknown,
): Extract<FramescaperVideoRetimeCommandV20, { readonly type: 'video-retime/reset' }> {
	return createCommand('video-retime/reset', value);
}

export function createFramescaperVideoRetimeConstantCommandV20(
	value: CommandInput<'video-retime/constant'> | unknown,
): Extract<FramescaperVideoRetimeCommandV20, { readonly type: 'video-retime/constant' }> {
	return createCommand('video-retime/constant', value);
}

export function createFramescaperVideoRetimeReverseCommandV20(
	value: CommandInput<'video-retime/reverse'> | unknown,
): Extract<FramescaperVideoRetimeCommandV20, { readonly type: 'video-retime/reverse' }> {
	return createCommand('video-retime/reverse', value);
}

export function createFramescaperVideoRetimeFreezeCommandV20(
	value: CommandInput<'video-retime/freeze'> | unknown,
): Extract<FramescaperVideoRetimeCommandV20, { readonly type: 'video-retime/freeze' }> {
	return createCommand('video-retime/freeze', value);
}

export function createFramescaperVideoRetimeRampCommandV20(
	value: CommandInput<'video-retime/ramp'> | unknown,
): Extract<FramescaperVideoRetimeCommandV20, { readonly type: 'video-retime/ramp' }> {
	return createCommand('video-retime/ramp', value);
}

/** Snapshot an exact closed retime command before clip-bound semantic validation. */
export function snapshotFramescaperVideoRetimeCommandV20(
	value: FramescaperVideoRetimeCommandV20 | unknown,
): FramescaperVideoRetimeCommandV20 {
	const record = plainRecord(value, 'Framescaper V20 video-retime command');
	const type = dataField(record, 'type', 'Framescaper V20 video-retime command');
	if (!isFramescaperVideoRetimeCommandTypeV20(type)) {
		throw new RangeError('Framescaper V20 video-retime command.type is unsupported.');
	}
	return createCommand(type, record, true);
}

export function isFramescaperVideoRetimeCommandV20(
	value: unknown,
): value is FramescaperVideoRetimeCommandV20 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& isFramescaperVideoRetimeCommandTypeV20(descriptor.value));
}

/** Resolve one authored operation against the occurrence's exact persisted bounds. */
export function resolveFramescaperVideoRetimeMapV20(
	command: FramescaperVideoRetimeCommandV20,
	bindingValue: VideoRetimeCurveV16Binding | unknown,
): VideoRetimeCurveV16 | null {
	const binding = bindingSnapshot(bindingValue);
	if (command.type === 'video-retime/reset') return null;
	if (command.type === 'video-retime/set') {
		const normalized = normalizeVideoRetimeCurveV16(command.retimeMap, binding);
		if (normalized === null) throw new TypeError('A set command requires a non-null retime map.');
		return normalized;
	}
	const outerEnd = binding.sequenceFrameCount;
	const sourceStart = rational(binding.sourceInFrame);
	const sourceEnd = rational(safeAdd(
		binding.sourceInFrame, binding.sourceFrameCount, 'video retime source bound',
	));
	if (command.type === 'video-retime/constant') {
		return normalizeVideoRetimeCurveV16(curve(outerEnd, sourceStart, sourceEnd, {
			mode: 'constant-forward',
		}), binding);
	}
	if (command.type === 'video-retime/reverse') {
		return normalizeVideoRetimeCurveV16(curve(outerEnd, sourceEnd, sourceStart, {
			mode: 'constant-reverse',
		}), binding);
	}
	if (command.type === 'video-retime/freeze') {
		return normalizeVideoRetimeCurveV16(curve(
			outerEnd, command.sourceFrame, command.sourceFrame, { mode: 'freeze' },
		), binding);
	}
	const magnitude = multiplyRational(
		rational(outerEnd),
		divideRational(addRational(command.startVelocity, command.endVelocity), rational(2)),
	);
	const sourceFinish = command.direction === 'forward'
		? addRational(command.sourceStartFrame, magnitude)
		: subtractRational(command.sourceStartFrame, magnitude);
	return normalizeVideoRetimeCurveV16(curve(
		outerEnd,
		command.sourceStartFrame,
		sourceFinish,
		{
			mode: command.direction === 'forward' ? 'ramp-forward' : 'ramp-reverse',
			startVelocity: command.startVelocity,
			endVelocity: command.endVelocity,
		},
	), binding);
}

function createCommand<T extends CommandType>(
	type: T,
	value: CommandInput<T> | unknown,
	serialized = false,
): Extract<FramescaperVideoRetimeCommandV20, { readonly type: T }> {
	const name = 'Framescaper V20 video-retime command';
	const record = plainRecord(value, name);
	const extra = type === 'video-retime/set' ? ['retimeMap']
		: type === 'video-retime/freeze' ? ['sourceFrame']
			: type === 'video-retime/ramp'
				? ['direction', 'startVelocity', 'endVelocity', 'sourceStartFrame'] : [];
	const expectedFields = serialized ? [...BASE_FIELDS, ...extra] : [
		...BASE_FIELDS.filter((field) => field !== 'type' && (field !== 'scope' || Object.hasOwn(record, field))),
		...extra,
	];
	assertFields(record, expectedFields, name);
	if (serialized && dataField(record, 'type', name) !== type) {
		throw new RangeError(`${name}.type must be ${type}.`);
	}
	const scope = Object.hasOwn(record, 'scope') ? scopeValue(dataField(record, 'scope', name)) : 'timeline';
	const clipId = identifier(dataField(record, 'clipId', name));
	const base = {
		type,
		scope,
		clipId,
		expectedRetimeMap: snapshotWire(dataField(record, 'expectedRetimeMap', name), true),
	};
	if (type === 'video-retime/set') {
		const retimeMap = snapshotWire(dataField(record, 'retimeMap', name), false);
		return Object.freeze({ ...base, retimeMap }) as Extract<FramescaperVideoRetimeCommandV20, { readonly type: T }>;
	}
	if (type === 'video-retime/freeze') {
		return Object.freeze({
			...base, sourceFrame: inputRational(dataField(record, 'sourceFrame', name), `${name}.sourceFrame`),
		}) as Extract<FramescaperVideoRetimeCommandV20, { readonly type: T }>;
	}
	if (type === 'video-retime/ramp') {
		const direction = dataField(record, 'direction', name);
		if (direction !== 'forward' && direction !== 'reverse') {
			throw new RangeError(`${name}.direction must be forward or reverse.`);
		}
		return Object.freeze({
			...base,
			direction,
			startVelocity: nonNegativeRational(dataField(record, 'startVelocity', name), `${name}.startVelocity`),
			endVelocity: nonNegativeRational(dataField(record, 'endVelocity', name), `${name}.endVelocity`),
			sourceStartFrame: inputRational(dataField(record, 'sourceStartFrame', name), `${name}.sourceStartFrame`),
		}) as Extract<FramescaperVideoRetimeCommandV20, { readonly type: T }>;
	}
	return Object.freeze(base) as Extract<FramescaperVideoRetimeCommandV20, { readonly type: T }>;
}

function snapshotWire(value: unknown, nullable: true): VideoRetimeCurveV16 | null;
function snapshotWire(value: unknown, nullable: false): VideoRetimeCurveV16;
function snapshotWire(value: unknown, nullable: boolean): VideoRetimeCurveV16 | null {
	if (value === null) {
		if (nullable) return null;
		throw new TypeError('A video-retime set command requires a non-null retimeMap.');
	}
	assertExactJson(value, 'video-retime command wire');
	const snapshot = structuredClone(value) as VideoRetimeCurveV16;
	return deepFreeze(snapshot);
}

function assertExactJson(value: unknown, name: string): void {
	const pending = [value];
	while (pending.length > 0) {
		const candidate = pending.pop()!;
		if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') continue;
		if (typeof candidate === 'number') {
			if (!Number.isFinite(candidate) || Object.is(candidate, -0)) throw new RangeError(`${name} numbers must be finite and canonical.`);
			continue;
		}
		if (!candidate || typeof candidate !== 'object' || candidate instanceof ArrayBuffer
			|| ArrayBuffer.isView(candidate)) throw new TypeError(`${name} must contain only JSON values.`);
		const prototype = Object.getPrototypeOf(candidate);
		if (Array.isArray(candidate) ? prototype !== Array.prototype
			: prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(`${name} must contain only plain records and arrays.`);
		}
		for (const key of Reflect.ownKeys(candidate)) {
			if (key === 'length' && Array.isArray(candidate)) continue;
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`${name} must contain only enumerable string data properties.`);
			}
			pending.push(descriptor.value);
		}
	}
}

function deepFreeze<T>(value: T): T {
	const pending: object[] = [value as object];
	while (pending.length > 0) {
		const candidate = pending.pop()!;
		if (Object.isFrozen(candidate)) continue;
		for (const key of Reflect.ownKeys(candidate)) {
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value
				&& typeof descriptor.value === 'object') pending.push(descriptor.value as object);
		}
		Object.freeze(candidate);
	}
	return value;
}

function bindingSnapshot(value: unknown): VideoRetimeCurveV16Binding {
	const record = plainRecord(value, 'video retime binding');
	assertFields(record, ['sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount'], 'video retime binding');
	return Object.freeze({
		sequenceFrameCount: positiveInteger(dataField(record, 'sequenceFrameCount', 'video retime binding'), 'sequenceFrameCount'),
		sourceInFrame: nonNegativeInteger(dataField(record, 'sourceInFrame', 'video retime binding'), 'sourceInFrame'),
		sourceFrameCount: positiveInteger(dataField(record, 'sourceFrameCount', 'video retime binding'), 'sourceFrameCount'),
	});
}

function curve(
	outerEnd: number,
	start: VideoRetimeCurveRational,
	end: VideoRetimeCurveRational,
	segment: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return {
		feature: 'video-retime', version: 2,
		points: [{ outerFrame: 0, sourceFrame: start }, { outerFrame: outerEnd, sourceFrame: end }],
		segments: [segment],
	};
}

function inputRational(value: unknown, name: string): VideoRetimeCurveRational {
	const record = plainRecord(value, name);
	assertFields(record, ['num', 'den'], name);
	const num = safeInteger(dataField(record, 'num', name), `${name}.num`);
	const den = positiveInteger(dataField(record, 'den', name), `${name}.den`);
	return canonicalRational(BigInt(num), BigInt(den), name);
}

function nonNegativeRational(value: unknown, name: string): VideoRetimeCurveRational {
	const result = inputRational(value, name);
	if (result.num < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function rational(value: number): VideoRetimeCurveRational {
	return Object.freeze({ num: value, den: 1 });
}

function addRational(left: VideoRetimeCurveRational, right: VideoRetimeCurveRational): VideoRetimeCurveRational {
	return canonicalRational(
		BigInt(left.num) * BigInt(right.den) + BigInt(right.num) * BigInt(left.den),
		BigInt(left.den) * BigInt(right.den),
		'video retime rational sum',
	);
}

function subtractRational(left: VideoRetimeCurveRational, right: VideoRetimeCurveRational): VideoRetimeCurveRational {
	return canonicalRational(
		BigInt(left.num) * BigInt(right.den) - BigInt(right.num) * BigInt(left.den),
		BigInt(left.den) * BigInt(right.den),
		'video retime rational difference',
	);
}

function multiplyRational(left: VideoRetimeCurveRational, right: VideoRetimeCurveRational): VideoRetimeCurveRational {
	return canonicalRational(
		BigInt(left.num) * BigInt(right.num), BigInt(left.den) * BigInt(right.den),
		'video retime rational product',
	);
}

function divideRational(left: VideoRetimeCurveRational, right: VideoRetimeCurveRational): VideoRetimeCurveRational {
	if (right.num === 0) throw new RangeError('A video retime rational divisor must be non-zero.');
	return canonicalRational(
		BigInt(left.num) * BigInt(right.den), BigInt(left.den) * BigInt(right.num),
		'video retime rational quotient',
	);
}

function canonicalRational(numeratorValue: bigint, denominatorValue: bigint, name: string): VideoRetimeCurveRational {
	let numerator = numeratorValue;
	let denominator = denominatorValue;
	if (denominator < 0n) {
		numerator = -numerator;
		denominator = -denominator;
	}
	const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
	numerator /= divisor;
	denominator /= divisor;
	const num = Number(numerator);
	const den = Number(denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0) {
		throw new RangeError(`${name} exceeds the persisted rational range.`);
	}
	return Object.freeze({ num, den });
}

function gcd(leftValue: bigint, rightValue: bigint): bigint {
	let left = leftValue;
	let right = rightValue;
	while (right !== 0n) [left, right] = [right, left % right];
	return left === 0n ? 1n : left;
}

function isFramescaperVideoRetimeCommandTypeV20(value: unknown): value is CommandType {
	return typeof value === 'string' && [
		'video-retime/set', 'video-retime/reset', 'video-retime/constant',
		'video-retime/reverse', 'video-retime/freeze', 'video-retime/ramp',
	].includes(value);
}

function scopeValue(value: unknown): FramescaperVideoRetimeScopeV20 {
	if (value !== 'timeline' && value !== 'project-bin') {
		throw new RangeError('Framescaper V20 video-retime command.scope must be timeline or project-bin.');
	}
	return value;
}

function identifier(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
		throw new TypeError('Framescaper V20 video-retime command.clipId must be a canonical non-empty string.');
	}
	return value;
}

function assertFields(record: Record<string, unknown>, fields: readonly string[], name: string): void {
	const allowed = new Set(fields);
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError(`${name} contains an unsupported or missing field.`);
	}
	for (const field of fields) dataField(record, field, name);
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Record<string, unknown>;
}

function dataField(record: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function safeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a canonical safe integer.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function positiveInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe-integer range.`);
	return result;
}
