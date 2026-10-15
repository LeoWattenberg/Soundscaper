/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { readPixelFrameV1 } from '../imaging/pixel-frame-contract-v1.ts';
import { loadLibRawRecoveryModuleV2 } from './libraw-runtime-asset-v2.ts';
import type { RawRecoveryFrameV2, RawRecoveryPixelFrameV2, RawRecoveryProfileV2 } from './libraw-wasm-instance-v2.ts';
import { withRawRecoveryFrameAuthorityV1 } from './internal/raw-recovery-frame-authority-v1.ts';

export type { RawRecoveryFrameV2, RawRecoveryPixelFrameV2, RawRecoveryProfileV2 } from './libraw-wasm-instance-v2.ts';
type WorkerEvent = Readonly<{ data?: unknown }>;
type Listener = (event: WorkerEvent) => void;
type EventName = 'message' | 'error' | 'messageerror';
export interface LibRawWorkerPortV2 {
	postMessage(message: unknown, transfer: Transferable[]): void;
	addEventListener(type: EventName, listener: Listener): void;
	removeEventListener(type: EventName, listener: Listener): void;
	terminate(): void | Promise<unknown>;
}
export interface LibRawRuntimeOptionsV2 {
	readonly loadModule?: () => Promise<WebAssembly.Module>;
	readonly createWorker?: () => LibRawWorkerPortV2;
}
type Plane = Readonly<{ buffer: ArrayBuffer; length: number }>;
const NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const CHECK = AbortSignal.prototype.throwIfAborted;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const FRAME_LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 256 * 1024 * 1024 });
const INPUT_LIMIT = 64 * 1024 * 1024;

/** Derived fixed-profile pixels, never a replacement canonical Original. One
 * private worker owns each job and must terminate before the scoped consumer.
 * Max decode overlap is 512 MiB Wasm + 256 MiB RGBA + 64 MiB caller backing +
 * 64 MiB input snapshot = 896 MiB, inside the existing one-GiB decode policy. */
export async function withDecodedRawRecoveryFrameV2<Result>(value: unknown,
	consume: (view: Readonly<RawRecoveryFrameV2>) => Result | Promise<Result>, options: Readonly<LibRawRuntimeOptionsV2> = {}): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('RAW recovery cancellation must be own data.');
	const signal = signalField?.value as unknown;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }; check();
	let input: Uint8Array<ArrayBuffer> | undefined, plane: Plane | undefined, decoded: Readonly<RawRecoveryFrameV2> | undefined;
	let outcome: { value: Result } | { error: unknown };
	try {
		const request = record(value, 'RAW recovery request', ['bytes', 'profile', 'signal'], ['bytes', 'profile']);
		const profile = readProfile(field(request, 'profile', 'RAW recovery request'));
		const config = record(options, 'RAW recovery runtime options', ['loadModule', 'createWorker'], []);
		const loader = Object.hasOwn(config, 'loadModule') ? field(config, 'loadModule', 'RAW recovery runtime options') : loadLibRawRecoveryModuleV2;
		const factory = Object.hasOwn(config, 'createWorker') ? field(config, 'createWorker', 'RAW recovery runtime options') : defaultWorker;
		if (typeof loader !== 'function' || typeof factory !== 'function' || typeof consume !== 'function') throw new TypeError('RAW recovery requires callable scoped capabilities.');
		input = captureInput(field(request, 'bytes', 'RAW recovery request')); check();
		const loaded: unknown = Reflect.apply(loader, options, []), module: unknown = await loaded; check();
		if (!(module instanceof WebAssembly.Module)) throw new TypeError('RAW recovery requires its audited compiled module.');
		await runWorker(module, input, profile, factory as () => LibRawWorkerPortV2, options, signal, check, value => {
			plane = transferredPlane(value);
			// Pin closed metadata and this exact physical plane before retirement
			// can yield to a transport retaining the original response object.
			decoded = readResponse(value, profile);
		});
		check();
		if (!decoded) throw new Error('RAW recovery worker has no admitted frame.');
		// Recheck the pinned storage after the writer has joined, retaining the
		// captured scalars and plane even if the transport replaced its packet.
		outcome = { value: await withRawRecoveryFrameAuthorityV1(readResponse({ schemaVersion: 2, kind: 'recovery', ...decoded }, profile), consume) }; check();
	} catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try { if (plane) wipe(plane); } catch (error) { failures.push(error); }
	try { if (input && Number(Reflect.apply(SIZE, input.buffer, [])) > 0) new NativeBytes(input.buffer).fill(0); } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'RAW recovery operation and physical retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('RAW recovery scope has no outcome.');
}

async function runWorker(module: WebAssembly.Module, bytes: Uint8Array<ArrayBuffer>, profile: RawRecoveryProfileV2,
	factory: () => LibRawWorkerPortV2, receiver: object, signal: unknown, check: () => void, receive: (value: unknown) => void): Promise<unknown> {
	const worker: unknown = Reflect.apply(factory, receiver, []), terminate = captureMethod(worker, 'terminate');
	let remove: ReturnType<typeof captureMethod> | undefined, result: { value: unknown } | { error: unknown };
	let onMessage: Listener | undefined, onError: Listener | undefined, onUnreadable: Listener | undefined, onAbort: (() => void) | undefined;
	const cleanup: unknown[] = [];
	try {
		const add = captureMethod(worker, 'addEventListener'), post = captureMethod(worker, 'postMessage');
		remove = captureMethod(worker, 'removeEventListener'); check();
		result = await new Promise<{ value: unknown } | { error: unknown }>(resolve => {
			let settled = false;
			const settle = (outcome: { value: unknown } | { error: unknown }) => { if (!settled) { settled = true; resolve(outcome); } };
			onMessage = event => {
				if (settled) {
					// Cancellation seals publication, not physical ownership of already
					// queued transfers. Keep this listener until actual worker exit.
					try { const late = transferredPlane(event.data); if (late) wipe(late); } catch (error) { cleanup.push(error); }
					return;
				}
				try { receive(event.data); settle({ value: event.data }); } catch (error) { settle({ error }); }
			};
			onError = () => { settle({ error: new Error('LibRaw recovery worker failed.') }); };
			onUnreadable = () => { settle({ error: new TypeError('LibRaw recovery worker response could not be read.') }); };
			onAbort = () => { try { check(); } catch (error) { settle({ error }); } };
			try {
				Reflect.apply(add, worker, ['message', onMessage]); Reflect.apply(add, worker, ['error', onError]);
				Reflect.apply(add, worker, ['messageerror', onUnreadable]);
				if (signal !== undefined) Reflect.apply(ADD, signal, ['abort', onAbort, { once: true }]);
				check(); Reflect.apply(post, worker, [{ schemaVersion: 2, kind: 'recovery', module, bytes, profile }, [bytes.buffer]]);
			} catch (error) { settle({ error }); }
		});
	} catch (error) { result = { error }; }
	for (const [name, listener] of [['error', onError], ['messageerror', onUnreadable]] as const) {
		try { if (remove && listener) Reflect.apply(remove, worker, [name, listener]); } catch (error) { cleanup.push(error); }
	}
	try { if (signal !== undefined && onAbort) Reflect.apply(REMOVE, signal, ['abort', onAbort]); } catch (error) { cleanup.push(error); }
	try { const retired: unknown = Reflect.apply(terminate, worker, []); await retired; } catch (error) { cleanup.push(error); }
	try { if (remove && onMessage) Reflect.apply(remove, worker, ['message', onMessage]); } catch (error) { cleanup.push(error); }
	if ('value' in result) { try { check(); } catch (error) { result = { error }; } }
	const failures = 'error' in result ? [result.error, ...cleanup] : cleanup;
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'RAW recovery worker operation and retirement failed.', { cause: failures[0] });
	if ('value' in result) return result.value;
	throw new Error('RAW recovery worker has no outcome.');
}

function readResponse(value: unknown, profile: RawRecoveryProfileV2): Readonly<RawRecoveryFrameV2> {
	const input = record(value, 'RAW recovery worker response', ['schemaVersion', 'kind', 'frame', 'rawFlip', 'profile', 'exposureScale', 'error'], ['schemaVersion', 'kind']);
	if (field(input, 'schemaVersion', 'RAW recovery worker response') !== 2) throw new RangeError('Unsupported RAW recovery response version.');
	if (field(input, 'kind', 'RAW recovery worker response') === 'error') {
		record(value, 'RAW recovery error response', ['schemaVersion', 'kind', 'error']);
		const error = record(field(input, 'error', 'RAW recovery worker response'), 'RAW recovery worker error', ['name', 'message']);
		const message = field(error, 'message', 'RAW recovery worker error');
		if (typeof message !== 'string' || message.length > 1024 || field(error, 'name', 'RAW recovery worker error') !== 'Error') {
			throw new TypeError('RAW recovery worker returned an invalid error.');
		}
		throw new Error(message);
	}
	if (field(input, 'kind', 'RAW recovery worker response') !== 'recovery') throw new TypeError('RAW recovery response does not match its operation.');
	record(value, 'RAW recovery success response', ['schemaVersion', 'kind', 'frame', 'rawFlip', 'profile', 'exposureScale']);
	if (readProfile(field(input, 'profile', 'RAW recovery worker response')) !== profile) throw new RangeError('RAW recovery returned a different fixed profile.');
	const frame = readPixelFrameV1(field(input, 'frame', 'RAW recovery worker response'), FRAME_LIMITS);
	if (frame.descriptor.sampleFormat !== 'float32' || frame.descriptor.primaries !== 'srgb' || frame.descriptor.transfer !== 'linear'
		|| !(frame.pixels instanceof Float32Array) || Object.getPrototypeOf(frame.pixels) !== Float32Array.prototype
		|| frame.descriptor.width < 16 || frame.descriptor.height < 16) throw new TypeError('RAW recovery requires native linear sRGB RGBA Float32.');
	privateOutput(frame.pixels);
	for (let index = 3; index < frame.pixels.length; index += 4) if (frame.pixels[index] !== 1) throw new RangeError('RAW recovery alpha must remain opaque.');
	const rawFlip = field(input, 'rawFlip', 'RAW recovery worker response'), exposureScale = field(input, 'exposureScale', 'RAW recovery worker response');
	if (typeof rawFlip !== 'number' || !Number.isSafeInteger(rawFlip) || rawFlip < 0 || rawFlip > 7
		|| typeof exposureScale !== 'number' || !Number.isFinite(exposureScale) || exposureScale < 1 || exposureScale > 65_536) {
		throw new RangeError('RAW recovery requires bounded native orientation and normalization.');
	}
	return Object.freeze({ frame: frame as RawRecoveryPixelFrameV2, rawFlip, profile, exposureScale });
}
function readProfile(value: unknown): RawRecoveryProfileV2 {
	if (value !== 'linear-headroom-v1' && value !== 'highlight-recovery-v1') throw new RangeError('RAW recovery requires an explicit supported fixed profile.');
	return value;
}
function captureInput(value: unknown): Uint8Array<ArrayBuffer> {
	if (!(value instanceof NativeBytes) || Object.getPrototypeOf(value) !== NativeBytes.prototype) throw new TypeError('RAW recovery input requires native Uint8Array bytes.');
	for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value, name)) throw new TypeError('RAW recovery input may not shadow its native geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer, length = Number(Reflect.apply(LENGTH, value, []));
	if (!(buffer instanceof ArrayBuffer) || (RESIZABLE && Reflect.apply(RESIZABLE, buffer, []) === true) || length < 1 || length > INPUT_LIMIT
		|| Number(Reflect.apply(SIZE, buffer, [])) > INPUT_LIMIT) throw new RangeError('RAW recovery input exceeds its 64 MiB physical byte bound.');
	return new NativeBytes(new NativeBytes(buffer, Number(Reflect.apply(OFFSET, value, [])), length));
}
function transferredPlane(value: unknown): Plane | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const frame: unknown = Object.getOwnPropertyDescriptor(value, 'frame')?.value;
	if (typeof frame !== 'object' || frame === null) return undefined;
	const pixels: unknown = Object.getOwnPropertyDescriptor(frame, 'pixels')?.value;
	if (!ArrayBuffer.isView(pixels)) return undefined;
	const buffer = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer;
	if (!(buffer instanceof ArrayBuffer) || (RESIZABLE && Reflect.apply(RESIZABLE, buffer, []) === true)) throw new TypeError('RAW recovery output requires fixed private storage.');
	return Object.freeze({ buffer, length: Number(Reflect.apply(SIZE, buffer, [])) });
}
function wipe(plane: Plane): void {
	if (Number(Reflect.apply(SIZE, plane.buffer, [])) !== plane.length) throw new TypeError('RAW recovery output detached or changed before physical retirement.');
	new NativeBytes(plane.buffer).fill(0);
}
function privateOutput(view: Float32Array): void {
	const buffer = Reflect.apply(BUFFER, view, []) as ArrayBuffer, length = Number(Reflect.apply(SIZE, buffer, []));
	if (Reflect.apply(OFFSET, view, []) !== 0 || Reflect.apply(LENGTH, view, []) !== length || length > FRAME_LIMITS.maximumBytes) {
		throw new RangeError('RAW recovery output requires exact bounded private backing.');
	}
}
function captureMethod(value: unknown, name: string): (...args: unknown[]) => unknown {
	let current = value;
	for (let depth = 0; typeof current === 'object' && current !== null && depth < 16; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(current, name);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError(`RAW recovery worker requires an inert ${name} method.`);
			return descriptor.value as (...args: unknown[]) => unknown;
		}
		current = Object.getPrototypeOf(current) as unknown;
	}
	throw new TypeError(`RAW recovery worker requires ${name}.`);
}
function defaultWorker(): LibRawWorkerPortV2 {
	return new Worker(new URL('./libraw-worker-v2.ts', import.meta.url), { type: 'module', name: 'lightscaper-libraw-recovery' }) as unknown as LibRawWorkerPortV2;
}
