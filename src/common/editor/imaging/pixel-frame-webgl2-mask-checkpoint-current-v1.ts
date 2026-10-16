/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1,
	type PixelFrameWebGl2MaskCheckpointCurrentV1 as Checkpoint } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

/** Private byte-proof transport; graph and GL admission have separate owners. */
export interface PixelFrameWebGl2MaskReceiptsCurrentV1 { readonly kind: 'native-mask-receipts-v1'; }
export type PixelFrameWebGl2MaskStripeReaderCurrentV1 = (top: number, rows: number, target: Uint8Array<ArrayBuffer>) => void;
type Plan = ReturnType<typeof readPixelFrameWebGl2MaskCheckpointPlanCurrentV1>;
type Outcome = Readonly<{ error: unknown }> | Readonly<{ ok: true }>;
interface State {
	readonly plan: Plan;
	readonly signal: AbortSignal | undefined;
	readonly scratch: Uint8Array<ArrayBuffer>;
	readonly digests: Map<number, Uint8Array<ArrayBuffer>>;
	readonly pending: Set<Promise<Outcome>>;
	readonly failures: unknown[];
	phase: 'gpu' | 'cpu' | 'finished';
	admitting: boolean;
	busy: boolean;
	gpu: number;
	cpu: number;
	overlayGpu: boolean;
	overlayCpu: boolean;
	overlayDigest?: Uint8Array<ArrayBuffer>;
	matched: boolean;
}
const STATES = new WeakMap<object, State>();
const STRIPE_BYTES = 65536, HASH_RESERVE = 256;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const FILL = Uint8Array.prototype.fill, SET = Uint8Array.prototype.set;

function state(value: unknown): State {
	const owned = typeof value === 'object' && value !== null ? STATES.get(value) : undefined;
	if (!owned) throw new TypeError('Mask receipts require their live private owner.');
	return owned;
}
function fail(s: State, reason: unknown): void { if (!s.failures.some(previous => Object.is(previous, reason))) s.failures.push(reason); }
function check(s: State): void {
	checkRepairSignalV1(s.signal);
	if (s.failures.length === 1) throw s.failures[0];
	if (s.failures.length > 1) throw new AggregateError(s.failures, 'Mask checkpoint work failed.', { cause: s.failures[0] });
	if (Reflect.apply(SIZE, s.scratch.buffer, []) !== STRIPE_BYTES) throw new TypeError('Mask receipt stripe detached.');
}
function checkpoint(s: State, value: unknown, index: number): Readonly<Checkpoint> {
	const expected = s.plan.executedCheckpoints[index];
	if (!expected || value !== expected || expected.executionIndex !== index) throw new TypeError('Mask checkpoint identity/order is incomplete or changed.');
	return expected;
}
function header(p: Plan, c: Readonly<Checkpoint>, overlay: boolean): Uint8Array<ArrayBuffer> {
	// Fixed field order and JSON escaping make scalar identities unambiguous.
	// Physical header bytes are charged exactly by the fee below and wiped.
	return new TextEncoder().encode(JSON.stringify(['native-mask-checkpoint-v1', overlay ? 'overlay' : 'coverage',
		c.index, c.executionIndex, c.slotOrdinal, c.stageIndex, c.effectId, c.maskId,
		overlay ? p.finalDescriptor.width : c.width, overlay ? p.finalDescriptor.height : c.height, 'top-to-bottom']));
}
export function pixelFrameWebGl2MaskReceiptWorkingBytesCurrentV1(value: unknown): number {
	const p = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(value); let largestHeader = 0;
	for (const c of p.executedCheckpoints) {
		const h = header(p, c, false); largestHeader = Math.max(largestHeader, h.byteLength); h.fill(0);
		if (c.selected) { const h = header(p, c, true); largestHeader = Math.max(largestHeader, h.byteLength); h.fill(0); }
	}
	return STRIPE_BYTES + largestHeader + HASH_RESERVE + 32 * (p.executedCheckpoints.length + (p.selectedExecutionIndex === undefined ? 0 : 1));
}
function extent(value: unknown, width: number, height: number): void {
	const input = record(value, 'actual mask readback extent', ['width', 'height']);
	if (field(input, 'width', 'actual mask readback extent') !== width || field(input, 'height', 'actual mask readback extent') !== height) {
		throw new RangeError('Actual mask readback extent differs from its checkpoint.');
	}
}

function selected(s: State, value: unknown): Readonly<Checkpoint> {
	const index = s.plan.selectedExecutionIndex;
	if (index === undefined) throw new RangeError('Mask pipeline has no selected overlay checkpoint.');
	const c = checkpoint(s, value, index);
	if (!c.selected) throw new TypeError('Mask overlay lost its exact selected binding.');
	return c;
}
function wipe(bytes: Uint8Array<ArrayBuffer>, length = bytes.byteLength): void {
	if (Reflect.apply(SIZE, bytes.buffer, []) !== length) throw new TypeError('Mask receipt backing changed before retirement.');
	Reflect.apply(FILL, new Uint8Array(bytes.buffer), [0]);
}
function same(a: Uint8Array, b: Uint8Array): boolean {
	let difference = a.length ^ b.length;
	for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;
	return difference === 0;
}

/** Claim before any await, latch even caught/ignored child failures, and join
 * children before retirement. Readback adapters must perform synchronous native
 * reads; their own integer scratch/format validation is separately charged. */
function operation(value: unknown, work: (s: State) => Promise<void>): Promise<void> {
	const s = state(value); let claimed = false;
	const task = (async () => {
		try {
			check(s);
			if (!s.admitting || s.busy) throw new TypeError('Mask receipt work is closed or concurrent.');
			s.busy = true; claimed = true; await work(s); check(s);
		} catch (error) { fail(s, error); throw error; }
		finally { if (claimed) s.busy = false; }
	})();
	const joined = task.then((): Outcome => ({ ok: true }), (error: unknown): Outcome => ({ error }));
	s.pending.add(joined); void joined.then(() => { s.pending.delete(joined); });
	return task;
}
async function digest(s: State, c: Readonly<Checkpoint>, overlay: boolean,
	read: PixelFrameWebGl2MaskStripeReaderCurrentV1): Promise<Uint8Array<ArrayBuffer>> {
	if (typeof read !== 'function') throw new TypeError('Mask receipt requires a synchronous canonical-byte stripe reader.');
	const width = overlay ? s.plan.finalDescriptor.width : c.width;
	const height = overlay ? s.plan.finalDescriptor.height : c.height;
	if (width > STRIPE_BYTES) throw new RangeError('Mask receipt row exceeds its admitted stripe.');
	const h = header(s.plan, c, overlay), hash = sha256.create();
	let result: Uint8Array<ArrayBuffer> | undefined; const failures: unknown[] = [];
	const recordFailure = (reason: unknown) => { if (!failures.some(previous => Object.is(previous, reason))) failures.push(reason); };
	try {
		hash.update(h); const stripeRows = Math.max(1, Math.floor(STRIPE_BYTES / width));
		for (let top = 0; top < height; top += stripeRows) {
			check(s); const rows = Math.min(stripeRows, height - top), count = width * rows;
			const stripe = new Uint8Array(s.scratch.buffer, 0, count);
			Reflect.apply(FILL, s.scratch, [0]);
			// The adapter normalizes a qualified integer readback, never CPU bytes.
			const returned: unknown = read(top, rows, stripe);
			if (returned !== undefined) { await returned; throw new TypeError('Mask stripe reader must complete synchronously.'); }
			check(s); hash.update(stripe); Reflect.apply(FILL, s.scratch, [0]);
			await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(s);
		}
		result = hash.digest();
	} catch (error) { recordFailure(error); }
	// A detached lent stripe is retired once by the outer physical owner,
	// preserving an opaque read failure as the primary cause.
	for (const cleanup of [() => { hash.destroy(); }, () => { wipe(h); }, () => {
		if (Reflect.apply(SIZE, s.scratch.buffer, []) === STRIPE_BYTES) wipe(s.scratch, STRIPE_BYTES);
	}]) {
		try { cleanup(); } catch (error) { recordFailure(error); }
	}
	if (failures.length && result) try { wipe(result); } catch (error) { recordFailure(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Mask digest work and retirement failed.', { cause: failures[0] });
	if (!result) throw new TypeError('Mask digest has no completed outcome.'); return result;
}

function cpuReader(coverage: Uint8Array<ArrayBuffer>, width: number, height: number): PixelFrameWebGl2MaskStripeReaderCurrentV1 {
	if (Object.getPrototypeOf(coverage) !== Uint8Array.prototype || ['buffer', 'byteOffset', 'byteLength', 'length'].some(key => Object.hasOwn(coverage, key))) {
		throw new TypeError('Mask proof requires intrinsic coverage without geometry shadows.');
	}
	const backing = coverage.buffer, length = backing.byteLength;
	if (coverage.byteOffset !== 0 || coverage.byteLength !== width * height || length !== width * height || Reflect.apply(RESIZABLE, backing, []) !== false) {
		throw new RangeError('Mask proof requires its exact dedicated incoming coverage.');
	}
	return (top, rows, target) => {
		if (Reflect.apply(SIZE, backing, []) !== length || length === 0) throw new TypeError('Mask proof coverage detached.');
		Reflect.apply(SET, target, [new Uint8Array(backing, top * width, rows * width)]);
	};
}
export function capturePixelFrameWebGl2MaskCheckpointCurrentV1(value: unknown, checkpointValue: unknown,
	extentValue: unknown, read: PixelFrameWebGl2MaskStripeReaderCurrentV1): Promise<void> {
	return operation(value, async s => {
		if (s.phase !== 'gpu') throw new TypeError('GPU mask receipts are sealed.');
		const c = checkpoint(s, checkpointValue, s.gpu); extent(extentValue, c.width, c.height);
		const hash = await digest(s, c, false, read);
		s.digests.set(s.gpu, hash); s.gpu++;
	});
}
export function capturePixelFrameWebGl2MaskOverlayCurrentV1(value: unknown, checkpointValue: unknown,
	extentValue: unknown, read: PixelFrameWebGl2MaskStripeReaderCurrentV1): Promise<void> {
	return operation(value, async s => {
		const c = selected(s, checkpointValue);
		if (s.phase !== 'gpu' || s.overlayGpu || s.gpu <= c.executionIndex!) throw new TypeError('GPU overlay receipt is missing its incoming checkpoint or repeated.');
		extent(extentValue, s.plan.finalDescriptor.width, s.plan.finalDescriptor.height);
		s.overlayDigest = await digest(s, c, true, read); s.overlayGpu = true;
	});
}
function transition(value: unknown, work: (s: State) => void): void {
	const s = state(value);
	try { check(s); if (!s.admitting || s.busy) throw new TypeError('Mask receipt transition requires joined children.'); work(s); }
	catch (error) { fail(s, error); throw error; }
}
export function sealPixelFrameWebGl2MaskCheckpointsCurrentV1(value: unknown): void {
	transition(value, s => {
		if (s.phase !== 'gpu' || s.gpu !== s.plan.executedCheckpoints.length || s.overlayGpu !== (s.plan.selectedExecutionIndex !== undefined)) {
			throw new TypeError('GPU mask receipt count or selected overlay is incomplete.');
		}
		s.phase = 'cpu';
	});
}
export function verifyPixelFrameWebGl2MaskCheckpointCurrentV1(value: unknown, checkpointValue: unknown,
	coverage: Uint8Array<ArrayBuffer>): Promise<void> {
	return operation(value, async s => {
		if (s.phase !== 'cpu') throw new TypeError('CPU mask proof requires sealed GPU receipts.');
		const c = checkpoint(s, checkpointValue, s.cpu), actual = await digest(s, c, false, cpuReader(coverage, c.width, c.height));
		try { const expected = s.digests.get(s.cpu); if (!expected) throw new TypeError('GPU mask receipt disappeared.'); s.matched = same(actual, expected) && s.matched; }
		finally { wipe(actual); } s.cpu++;
	});
}
export function verifyPixelFrameWebGl2MaskOverlayCurrentV1(value: unknown, checkpointValue: unknown,
	coverage: Uint8Array<ArrayBuffer>): Promise<void> {
	return operation(value, async s => {
		const c = selected(s, checkpointValue);
		if (s.phase !== 'cpu' || s.overlayCpu || s.cpu <= c.executionIndex! || !s.overlayDigest) throw new TypeError('CPU overlay proof is missing or repeated.');
		const actual = await digest(s, c, true, cpuReader(coverage, s.plan.finalDescriptor.width, s.plan.finalDescriptor.height));
		try { s.matched = same(actual, s.overlayDigest) && s.matched; } finally { wipe(actual); } s.overlayCpu = true;
	});
}
export function finishPixelFrameWebGl2MaskCheckpointsCurrentV1(value: unknown): boolean {
	let matched = false;
	transition(value, s => {
		if (s.phase !== 'cpu' || s.cpu !== s.plan.executedCheckpoints.length || s.overlayCpu !== (s.plan.selectedExecutionIndex !== undefined)) {
			throw new TypeError('CPU mask proof omitted a checkpoint or selected overlay.');
		}
		s.phase = 'finished'; matched = s.matched;
	}); return matched;
}
export async function withPixelFrameWebGl2MaskReceiptsCurrentV1<Result>(planValue: unknown,
	consume: (receipts: Readonly<PixelFrameWebGl2MaskReceiptsCurrentV1>) => Result | Promise<Result>, signalValue?: AbortSignal): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const plan = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(planValue);
	if (typeof consume !== 'function') throw new TypeError('Mask receipt owner requires a scoped consumer.');
	const scope = Object.freeze({ kind: 'native-mask-receipts-v1' as const });
	const s: State = { plan, signal, scratch: new Uint8Array(STRIPE_BYTES), digests: new Map(), pending: new Set(), failures: [],
		phase: 'gpu', admitting: true, busy: false, gpu: 0, cpu: 0, overlayGpu: false, overlayCpu: false, matched: true };
	STATES.set(scope, s); let result!: Result;
	try { result = await consume(scope); } catch (error) { fail(s, error); }
	s.admitting = false;
	while (s.pending.size) await Promise.all(s.pending);
	try { check(s); if (s.phase !== 'finished') throw new TypeError('Mask receipt scope ended without complete CPU proof.'); } catch (error) { fail(s, error); }
	STATES.delete(scope);
	for (const bytes of [...s.digests.values(), ...(s.overlayDigest ? [s.overlayDigest] : []), s.scratch]) {
		try { wipe(bytes); } catch (error) { fail(s, error); }
	}
	s.digests.clear(); delete s.overlayDigest;
	if (s.failures.length === 1) throw s.failures[0];
	if (s.failures.length > 1) throw new AggregateError(s.failures, 'Mask checkpoint work and retirement failed.', { cause: s.failures[0] });
	return result;
}
