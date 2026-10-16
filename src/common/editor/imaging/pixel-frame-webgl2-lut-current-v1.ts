/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1, VIDEO_COLOR_LIMITS_V1, type VideoCubeLutReferenceV1 } from '../cube-lut-reference-contract.ts';
import { captureCubeLutSourceV1 } from './cube-lut-source-scope-v1.ts';
import type { CubeLutSourcePortV1 } from './cube-lut-source-port-v1.ts';
import { withCubeLutResourceV1 } from './cube-lut-resource-v1.ts';
import { LINEAR_LUT_TRANSIENT_RESERVE_BYTES_V1, sampleLinearCubeLutChannelCurrentV1, type LinearCubeLutSamplingTableCurrentV1 } from './linear-cube-lut-sampling-current-v1.ts';
import type { LinearColorChannelsV1 } from './pixel-frame-linear-chroma-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedPixelFrameWebGl2LutCurrentV1 {
	readonly id: string;
	readonly type: 'cube-lut-profile-v1';
	readonly kind: 8;
	readonly reference: Readonly<VideoCubeLutReferenceV1>;
}
export interface PixelFrameWebGl2LutPlanCurrentV1 {
	readonly references: readonly Readonly<VideoCubeLutReferenceV1>[];
	readonly oracleBytes: number;
	readonly uploadBytes: number;
	readonly textureBytes: number;
	readonly capturePeakBytes: number;
	readonly maximumSize: number;
	readonly eligible: boolean;
}
export interface PixelFrameWebGl2LutResourcesCurrentV1 {
	readonly maximumSize: number;
	writeChannels(pass: unknown, red: number, green: number, blue: number, target: LinearColorChannelsV1): void;
	writeUpload(pass: unknown, target: Float32Array<ArrayBuffer>): number;
	supported(pass: unknown): boolean;
}
interface Table extends LinearCubeLutSamplingTableCurrentV1 {
	readonly reference: Readonly<VideoCubeLutReferenceV1>;
	readonly values: Float64Array<ArrayBuffer>;
	readonly supported: boolean;
}
const MAXIMUM = 768 * 1024 * 1024;
const NativeDoubles = Float64Array, NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'length')!.get!;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const FILL = NativeBytes.prototype.fill;
const PREPARED = new WeakMap<object, Readonly<PreparedPixelFrameWebGl2LutCurrentV1>>();

export function preparePixelFrameWebGl2LutCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2LutCurrentV1> {
	const input = record(value, 'native GPU LUT pass', ['id', 'reference']), id = field(input, 'id', 'native GPU LUT pass');
	if (typeof id !== 'string' || id.length < 1 || id.length > 128) throw new TypeError('Native GPU LUT requires a bounded effect ID.');
	const pass = Object.freeze({ id, type: 'cube-lut-profile-v1' as const, kind: 8 as const,
		reference: normalizeVideoCubeLutReferenceV1(field(input, 'reference', 'native GPU LUT pass')) });
	PREPARED.set(pass, pass); return pass;
}
export function isPixelFrameWebGl2LutCurrentV1(value: unknown): value is Readonly<PreparedPixelFrameWebGl2LutCurrentV1> {
	return typeof value === 'object' && value !== null && PREPARED.has(value);
}
export function readPixelFrameWebGl2LutCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2LutCurrentV1> {
	if (!isPixelFrameWebGl2LutCurrentV1(value)) throw new TypeError('Native GPU LUT requires an owning prepared pass.');
	return PREPARED.get(value)!;
}
function capture(value: unknown) {
	return Object.freeze(array(value, 'native GPU LUT passes', 0, 256).map(readPixelFrameWebGl2LutCurrentV1));
}
function plan(passes: readonly Readonly<PreparedPixelFrameWebGl2LutCurrentV1>[]): Readonly<PixelFrameWebGl2LutPlanCurrentV1> {
	const references = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	let oracleBytes = 0, uploadBytes = 0, capturePeakBytes = 0, maximumSize = 0;
	for (const pass of passes) {
		const reference = pass.reference, previous = references.get(reference.storageKey);
		if (previous) {
			if (JSON.stringify(previous) !== JSON.stringify(reference)) throw new RangeError('Native GPU LUT references conflict on one immutable storage identity.');
			continue;
		}
		references.set(reference.storageKey, reference);
		oracleBytes += reference.size ** 3 * 3 * 8;
		uploadBytes = Math.max(uploadBytes, reference.size ** 3 * 4 * 4);
		maximumSize = Math.max(maximumSize, reference.size);
		// The source may lend an authenticated subview of a larger fixed backing.
		capturePeakBytes = Math.max(capturePeakBytes, oracleBytes + LINEAR_LUT_TRANSIENT_RESERVE_BYTES_V1
			+ VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes + reference.byteLength);
	}
	return Object.freeze({ references: Object.freeze([...references.values()]), oracleBytes, uploadBytes, textureBytes: uploadBytes,
		capturePeakBytes, maximumSize, eligible: Math.max(capturePeakBytes, oracleBytes + uploadBytes * 2) <= MAXIMUM });
}

/** Valid capacity profiles stay metadata. The caller may select complete CPU
 * processing, which only retains one parsed LUT at a time, before GPU I/O. */
export function planPixelFrameWebGl2LutsCurrentV1(value: unknown): Readonly<PixelFrameWebGl2LutPlanCurrentV1> {
	return plan(capture(value));
}

function uploadBank(value: unknown, minimum: number): Float32Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Float32Array') throw new TypeError('Native GPU LUT upload requires a Float32 bank.');
	for (const name of ['buffer', 'byteOffset', 'byteLength', 'length']) if (Object.hasOwn(value as object, name)) throw new TypeError('Native GPU LUT upload may not shadow native geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer, length = Number(Reflect.apply(LENGTH, value, []));
	if (Reflect.apply(RESIZABLE, buffer, []) !== false || Reflect.apply(OFFSET, value, []) !== 0
		|| Reflect.apply(SIZE, buffer, []) !== length * 4 || length < minimum || length > VIDEO_COLOR_LIMITS_V1.maximumCubeLutSize ** 3 * 4) {
		throw new RangeError('Native GPU LUT upload requires a dedicated bounded fixed bank of sufficient length.');
	}
	return value as Float32Array<ArrayBuffer>;
}

/** Snapshot each parser-authenticated table into private Double storage, joining
 * its source operation and child independently. No parsed body or source byte
 * borrow survives into the next source or final scoped resource consumer. */
export async function withPixelFrameWebGl2LutsCurrentV1<Result>(value: unknown, sourceValue: unknown,
	consume: (resources: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>) => Result | Promise<Result>, signalValue?: AbortSignal): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue), check = () => { checkRepairSignalV1(signal); }; check();
	if (typeof consume !== 'function') throw new TypeError('Native GPU LUT resources require a scoped consumer.');
	const passes = capture(value), metadata = plan(passes);
	if (!metadata.eligible) throw new RangeError('Native GPU LUT resources exceed their 768 MiB working capacity.');
	const source = metadata.references.length ? captureCubeLutSourceV1(sourceValue) : undefined;
	const tables = new Map<string, Table>(), owned = new Map<ArrayBuffer, number>(), enrolled = new Set(passes);
	let live = true;
	const tableFor = (value: unknown): Table => {
		if (!live) throw new TypeError('Native GPU LUT resources are retired.'); check();
		const pass = readPixelFrameWebGl2LutCurrentV1(value);
		if (!enrolled.has(pass)) throw new TypeError('Native GPU LUT pass is not enrolled in this resource scope.');
		const table = tables.get(pass.reference.storageKey);
		if (!table) throw new TypeError('Native GPU LUT has no authenticated table in this scope.'); return table;
	};
	const resources: Readonly<PixelFrameWebGl2LutResourcesCurrentV1> = Object.freeze({ maximumSize: metadata.maximumSize,
		supported(value: unknown) { return tableFor(value).supported; },
		writeChannels(value: unknown, red: number, green: number, blue: number, target: LinearColorChannelsV1) {
			const table = tableFor(value);
			if (typeof red !== 'number' || !Number.isFinite(red) || typeof green !== 'number' || !Number.isFinite(green)
				|| typeof blue !== 'number' || !Number.isFinite(blue)) throw new TypeError('Native GPU LUT requires finite RGB samples.');
			const r = sampleLinearCubeLutChannelCurrentV1(table, red, green, blue, 0), g = sampleLinearCubeLutChannelCurrentV1(table, red, green, blue, 1), b = sampleLinearCubeLutChannelCurrentV1(table, red, green, blue, 2);
			target.red = r; target.green = g; target.blue = b;
		},
		writeUpload(value: unknown, target: Float32Array<ArrayBuffer>) {
			const table = tableFor(value);
			if (!table.supported) throw new RangeError('Native GPU LUT has unsupported Float32 domain or lattice values.');
			const count = table.reference.size ** 3 * 4, bank = uploadBank(target, count);
			for (let from = 0, to = 0; to < count; from += 3, to += 4) {
				bank[to] = table.values[from]!; bank[to + 1] = table.values[from + 1]!; bank[to + 2] = table.values[from + 2]!; bank[to + 3] = 1;
			}
			check(); return count;
		},
	});
	const copy = async (reference: Readonly<VideoCubeLutReferenceV1>, bytes: Uint8Array<ArrayBuffer>) => {
		await withCubeLutResourceV1({ reference, bytes, ...(signal ? { signal } : {}) }, async resource => {
			check(); const values = new NativeDoubles(reference.size ** 3 * 3), buffer = Reflect.apply(BUFFER, values, []) as ArrayBuffer;
			owned.set(buffer, Number(Reflect.apply(SIZE, buffer, [])));
			let supported = reference.domainMin.every((value, channel) => Math.fround(value) < Math.fround(reference.domainMax[channel]!));
			const budget = new RepairTaskBudgetV1(check);
			for (let index = 0; index < values.length; index++) {
				const scalar = resource.body.values[index]!; values[index] = scalar;
				if (!Number.isFinite(Math.fround(scalar))) supported = false;
				if (budget.visit()) await budget.yield();
			}
			check(); tables.set(reference.storageKey, Object.freeze({ reference, values, supported, size: reference.size,
				domainMin: reference.domainMin, domainMax: reference.domainMax }));
		});
	};
	let outcome: { value: Result } | { error: unknown };
	try {
		for (const reference of metadata.references) await captureTable(reference, source!, copy, signal);
		check(); const result = await consume(resources); check(); outcome = { value: result };
	} catch (error) { outcome = { error }; }
	live = false;
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	for (const [buffer, length] of owned) try {
		if (Reflect.apply(SIZE, buffer, []) !== length) throw new TypeError('Native GPU LUT oracle backing changed before physical retirement.');
		Reflect.apply(FILL, new NativeBytes(buffer), [0]);
	} catch (error) { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); }
	owned.clear(); tables.clear();
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Native GPU LUT operation and oracle retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value; throw new Error('Native GPU LUT operation has no outcome.');
}

async function captureTable(reference: Readonly<VideoCubeLutReferenceV1>, source: Readonly<CubeLutSourcePortV1>,
	copy: (reference: Readonly<VideoCubeLutReferenceV1>, bytes: Uint8Array<ArrayBuffer>) => Promise<void>, signal?: AbortSignal): Promise<void> {
	let live = true, called = false, child: Promise<void> | undefined;
	const failures: unknown[] = [], fail = (error: unknown) => { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); };
	try {
		await source.withBytes(reference, bytes => {
			if (!live || called) { const error = new TypeError('Native GPU LUT source consumer is repeated or retired.'); if (live) fail(error); throw error; }
			called = true; child = copy(reference, bytes); void child.catch(fail); return child;
		}, signal ? { signal } : {});
	} catch (error) { fail(error); }
	live = false;
	if (child) try { await child; } catch (error) { fail(error); }
	else if (!failures.length) fail(new TypeError('Native GPU LUT source completed without delivering a body.'));
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, 'Native GPU LUT source and authenticated copy failed.', { cause: failures[0] });
	checkRepairSignalV1(signal);
}
