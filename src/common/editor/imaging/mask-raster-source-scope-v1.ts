/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1,
	type BrushMaskResourceReferenceV1, type BrushMaskResourceV1 } from './brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from './mask-raster-source-port-v1.ts';

export interface MaskRasterSourceScopeV1 { readonly kind: 'mask-raster-source-scope-v1'; }
interface Retained { readonly resource: Readonly<BrushMaskResourceV1>; readonly backing: ArrayBuffer; }
interface ScopeState {
	readonly references: ReadonlyMap<string, Readonly<BrushMaskResourceReferenceV1>>;
	readonly retained: ReadonlyMap<string, Retained>;
	readonly signal: AbortSignal | undefined;
	readonly children: Set<Promise<void>>;
	readonly fail: (reason: unknown) => void;
	admittingWork: boolean;
}
const SCOPES = new WeakMap<object, ScopeState>();
const REF_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);
const MAX_REFERENCES = 4094, MAX_IDENTITY_BYTES = 16_777_216;
const NativeBytes = Uint8Array, SET_BYTES = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, ADD = AbortSignal.prototype.addEventListener, REMOVE = AbortSignal.prototype.removeEventListener;
const SET_SIZE = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!, SET_VALUES = Set.prototype.values;
const SET_NEXT = (Object.getPrototypeOf(new Set().values()) as { next: (this: SetIterator<unknown>) => IteratorResult<unknown> }).next;

/** Capture the actual source receiver and its own callable before yielding.
 * No function metadata, inherited getter, or serialized body map is authority. */
export function captureMaskRasterSourceV1(value: unknown): Readonly<MaskRasterSourcePortV1> {
	if (value === null || typeof value !== 'object') throw new TypeError('Brush rendering requires a selected body source.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'withBytes');
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
		throw new TypeError('Brush sources require an own callable withBytes method.');
	}
	const method = descriptor.value as MaskRasterSourcePortV1['withBytes'];
	return Object.freeze({ withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
		return Reflect.apply(method, value, [reference, consume, options]) as Promise<Result>;
	} });
}

/** Complete serial authentication precedes scoped use. Authenticate unused
 * declarations too; copy only selected alpha and retain no borrowed body.
 * This direct capability has the existing 4094-reference/16MiB identity bound.
 * The renderer separately admits its full 64MiB graph/body/overlay overlap.
 * Each source outcome and any forgotten authentication child join before the
 * next read. Consumer settlement precedes authority retirement and wipes. */
export async function withMaskRasterSourceScopeV1<Result>(references: readonly Readonly<BrushMaskResourceReferenceV1>[],
	retainedStorageKeys: ReadonlySet<string>, source: MaskRasterSourcePortV1,
	consume: (scope: Readonly<MaskRasterSourceScopeV1>) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> {
	const capturedSignal = captureSignal(signal); check(capturedSignal);
	if (typeof consume !== 'function') throw new TypeError('Brush scopes require a joined consumer.');
	const capturedReferences = captureReferences(references), keys = captureKeys(retainedStorageKeys, capturedReferences);
	const capturedSource = captureMaskRasterSourceV1(source);
	const retained = new Map<string, Retained>(), failures: unknown[] = [];
	const scope = Object.freeze({ kind: 'mask-raster-source-scope-v1' as const });
	function fail(reason: unknown): void { if (!failures.some(previous => Object.is(previous, reason))) failures.push(reason); }
	function refused(): void {
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Brush authentication, source retirement or consumer failed.', { cause: failures[0] });
	}
	const cancelled = () => { try { check(capturedSignal); } catch (error) { fail(error); } };
	let listening = false;
	try {
		if (capturedSignal !== undefined) { Reflect.apply(ADD, capturedSignal, ['abort', cancelled, { once: true }]); listening = true; }
		check(capturedSignal);
		for (const reference of capturedReferences.values()) {
			check(capturedSignal); await authenticate(reference); refused(); check(capturedSignal);
		}
		const state: ScopeState = { references: capturedReferences, retained, signal: capturedSignal,
			children: new Set(), fail, admittingWork: true };
		SCOPES.set(scope, state);
		let result!: Result;
		try { result = await consume(scope); } catch (error) { fail(error); }
		state.admittingWork = false;
		await Promise.all(state.children);
		try { check(capturedSignal); } catch (error) { fail(error); }
		refused(); return result;
	} finally {
		SCOPES.delete(scope);
		if (listening) Reflect.apply(REMOVE, capturedSignal!, ['abort', cancelled]);
		for (const entry of retained.values()) if (Reflect.apply(SIZE, entry.backing, []) !== 0) {
			Reflect.apply(FILL, new NativeBytes(entry.backing), [0]);
		}
		retained.clear();
	}

	async function authenticate(reference: Readonly<BrushMaskResourceReferenceV1>): Promise<void> {
		let live = true, claimed = false, child: Promise<void> | undefined, deliveryRefusal: TypeError | undefined;
		const accept = (bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
			if (!live || claimed) {
				deliveryRefusal ??= new TypeError('Brush body delivery is repeated or retired.'); const error = deliveryRefusal; if (live) fail(error);
				const rejected = Promise.reject<void>(error); void rejected.catch(() => undefined); return rejected;
			}
			// Claim before cancellation/body admission or any caller reflection.
			claimed = true;
			child = withBrushMaskResourceV1({ reference, bytes, signal: capturedSignal }, resource => {
				if (!keys.has(reference.storageKey)) return;
				const alpha = new NativeBytes(reference.width * reference.height), backing = alpha.buffer;
				Reflect.apply(SET_BYTES, alpha, [resource.alpha]);
				retained.set(reference.storageKey, { resource: Object.freeze({ reference, alpha }), backing });
			});
			void child.catch(error => { fail(error); }); return child;
		};
		try { await capturedSource.withBytes(reference, accept, { signal: capturedSignal }); }
		catch (error) { fail(error); }
		live = false;
		if (child !== undefined) await child.catch(error => { fail(error); });
		else if (failures.length === 0) fail(new TypeError('Brush source completed without its authenticated body.'));
	}
}

/** Prove every declaration belongs to this complete authenticated closure,
 * including graphs whose inputs are unused. Scalar copies grant no authority. */
export function assertMaskRasterSourceScopeV1(scope: unknown, references: readonly Readonly<BrushMaskResourceReferenceV1>[]): void {
	const state = currentScope(scope), required = captureReferences(references); check(state.signal);
	for (const reference of required.values()) if (!state.references.has(reference.storageKey)) {
		throw new TypeError('Brush graph declarations are outside the authenticated scope.');
	}
}

/** Claim a native handled child before invoking its callback synchronously.
 * Request/current-frame admission therefore precedes the caller's first yield.
 * Every admitted outcome joins the scope, even if the caller ignores/catches
 * it. Top-consumer settlement seals new claims while existing children drain. */
export function withMaskRasterSourceScopeWorkV1<Result>(scope: unknown, work: () => Result | Promise<Result>): Promise<Result> {
	let state: ScopeState;
	try {
		state = currentScope(scope);
		if (!state.admittingWork) throw new TypeError('Brush scope work admission is sealed.');
		if (state.children.size !== 0) throw new TypeError('Brush scope work must run serially.');
	} catch (error) {
		const refused = Promise.reject<Result>(error); void refused.catch(() => undefined); return refused;
	}
	let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
	const execution = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
	const pending = execution.then(value => { currentScope(scope); return value; });
	const joined = pending.then(() => { state.children.delete(joined); }, (error: unknown) => {
		state.fail(error); state.children.delete(joined);
	});
	state.children.add(joined);
	try {
		if (typeof work !== 'function') throw new TypeError('Brush scope work requires a callable.');
		resolve(Reflect.apply(work, undefined, []) as Result | Promise<Result>);
	} catch (error) { reject(error); }
	return pending;
}

/** Resource component peak for the entire genuine scope, including planes
 * outside a particular graph subset. Four encoded spans and two digests
 * coexist conservatively; graph/range/projection work belongs to the host. */
export function maskRasterSourceScopeWorkingBytesV1(scope: unknown): number {
	const state = currentScope(scope); let alpha = 0, largestBody = 0;
	for (const reference of state.references.values()) largestBody = Math.max(largestBody, reference.byteLength);
	for (const entry of state.retained.values()) alpha += entry.resource.reference.width * entry.resource.reference.height;
	return alpha + 4 * largestBody + (state.references.size === 0 ? 0 : 64);
}

/** Alpha is borrowed until the owning scope consumer joins. No caller alpha
 * map, clone, expired scope or declared-but-unselected input exposes a plane. */
export function scopedBrushMaskResourceV1(scope: unknown, storageKey: string): Readonly<BrushMaskResourceV1> {
	const state = currentScope(scope);
	if (typeof storageKey !== 'string') throw new TypeError('Brush lookups require a primitive storage key.');
	const entry = state.retained.get(storageKey);
	if (!entry) throw new TypeError('Brush plane is outside the retained scoped selection.');
	return entry.resource;
}

function currentScope(value: unknown): ScopeState {
	const state = SCOPES.get(value as object);
	if (!state) throw new TypeError('Brush scope requires a genuine active owner identity.');
	check(state.signal); return state;
}
function captureReferences(value: unknown): Map<string, Readonly<BrushMaskResourceReferenceV1>> {
	const values = array(value, 'brush scope references', 0, MAX_REFERENCES), references = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
	let bytes = 0;
	for (const value of values) {
		const input = record(value, 'brush scope reference', REF_FIELDS);
		const reference = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'brush scope reference'));
		for (const key of REF_FIELDS) if (field(input, key, 'brush scope reference') !== reference[key as keyof BrushMaskResourceReferenceV1]) {
			throw new TypeError('Brush scope reference differs from its canonical identity.');
		}
		if (references.has(reference.storageKey)) continue;
		bytes += reference.byteLength;
		if (bytes > MAX_IDENTITY_BYTES) throw new RangeError('Brush scope exceeds its complete identity byte bound.');
		references.set(reference.storageKey, reference);
	}
	return references;
}
function captureKeys(value: unknown, references: ReadonlyMap<string, Readonly<BrushMaskResourceReferenceV1>>): Set<string> {
	const size = Reflect.apply(SET_SIZE, value, []) as number;
	if (size > MAX_REFERENCES) throw new RangeError('Brush retained selection exceeds its capacity.');
	const iterator = Reflect.apply(SET_VALUES, value, []) as SetIterator<unknown>, keys = new Set<string>();
	for (let index = 0; index < size; index++) {
		const item = Reflect.apply(SET_NEXT, iterator, []) as IteratorResult<unknown>;
		if (item.done || typeof item.value !== 'string' || !references.has(item.value)) throw new TypeError('Brush retained selection requires captured declared keys.');
		keys.add(item.value);
	}
	if (!(Reflect.apply(SET_NEXT, iterator, []) as IteratorResult<unknown>).done) throw new TypeError('Brush retained selection changed during capture.');
	return keys;
}
function captureSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value as object, key))) {
		throw new TypeError('Brush scopes require an unshadowed native cancellation signal.');
	}
	return value as AbortSignal;
}
function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
