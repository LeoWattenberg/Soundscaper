/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { readPixelFrameV1 } from '../imaging/pixel-frame-contract-v1.ts';
import { loadLibRawModuleV1 } from './libraw-runtime-asset-v1.ts';
import type { RawDecodedFrameV1, RawDecodedOriginalV1, RawEmbeddedPreviewV1 } from './libraw-wasm-instance-v1.ts';

export type { RawDecodedFrameV1, RawDecodedOriginalV1, RawEmbeddedPreviewV1 } from './libraw-wasm-instance-v1.ts';
type WorkerEvent = Readonly<{ data?: unknown }>;
type Listener = (event: WorkerEvent) => void;
type EventName = 'message' | 'error' | 'messageerror';
export interface LibRawWorkerPortV1 {
	postMessage(message: unknown, transfer: Transferable[]): void;
	addEventListener(type: EventName, listener: Listener): void;
	removeEventListener(type: EventName, listener: Listener): void;
	terminate(): void | Promise<unknown>;
}
export interface LibRawRuntimeOptionsV1 {
	readonly loadModule?: () => Promise<WebAssembly.Module>;
	readonly createWorker?: () => LibRawWorkerPortV1;
}
type Plane = Readonly<{ buffer: ArrayBuffer; length: number }>;
const NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const FRAME_LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 128 * 1024 * 1024 });

/** Every job owns one dedicated native worker. Its termination (including an
 * asynchronous adapter's exit) precedes the consumer, so the decoder heap never
 * overlaps the caller's deep working render. Caller input remains unchanged. */
export function withDecodedRawFrameV1<Result>(value: unknown, consume: (frame: RawDecodedFrameV1) => Result | Promise<Result>,
	options: Readonly<LibRawRuntimeOptionsV1> = {}): Promise<Result> {
	return withJob(value, 'decode', consume, readFrame, options);
}
export function withDecodedRawOriginalV1<Result>(value: unknown, consume: (view: Readonly<RawDecodedOriginalV1>) => Result | Promise<Result>,
	options: Readonly<LibRawRuntimeOptionsV1> = {}): Promise<Result> {
	return withJob(value, 'original', consume, readOriginal, options);
}
export function withRawEmbeddedPreviewV1<Result>(value: unknown, consume: (preview: RawEmbeddedPreviewV1 | null) => Result | Promise<Result>,
	options: Readonly<LibRawRuntimeOptionsV1> = {}): Promise<Result> {
	return withJob(value, 'preview', consume, readPreview, options);
}

async function withJob<Value, Result>(value: unknown, kind: 'decode' | 'preview' | 'original', consume: (value: Value) => Result | Promise<Result>,
	parse: (value: unknown) => Value, options: Readonly<LibRawRuntimeOptionsV1>): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('RAW cancellation must be an own data property.');
	const signal = signalField?.value as unknown;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }; check();
	let input: Uint8Array<ArrayBuffer> | undefined, plane: Plane | undefined;
	let outcome: { value: Result } | { error: unknown };
	try {
		const request = record(value, 'RAW request', ['bytes', 'signal'], ['bytes']);
		const config = record(options, 'RAW runtime options', ['loadModule', 'createWorker'], []);
		const loader = Object.hasOwn(config, 'loadModule') ? field(config, 'loadModule', 'RAW runtime options') : loadLibRawModuleV1;
		const factory = Object.hasOwn(config, 'createWorker') ? field(config, 'createWorker', 'RAW runtime options') : defaultWorker;
		if (typeof loader !== 'function' || typeof factory !== 'function' || typeof consume !== 'function') throw new TypeError('RAW runtime requires callable scoped capabilities.');
		input = captureInput(field(request, 'bytes', 'RAW request')); check();
		const loaded: unknown = Reflect.apply(loader, options, []), module: unknown = await loaded; check();
		if (!(module instanceof WebAssembly.Module)) throw new TypeError('RAW runtime requires its audited compiled module.');
		const message = await runWorker(module, input, kind, factory as () => LibRawWorkerPortV1, options, signal, check, response => {
			plane = transferredPlane(response);
		});
		check(); outcome = { value: await consume(parse(message)) }; check();
	} catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try { if (plane) wipe(plane); } catch (error) { failures.push(error); }
	try { if (input && Number(Reflect.apply(SIZE, input.buffer, [])) > 0) new NativeBytes(input.buffer).fill(0); } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'RAW operation and physical retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('RAW scope has no operation outcome.');
}

async function runWorker(module: WebAssembly.Module, bytes: Uint8Array<ArrayBuffer>, kind: 'decode' | 'preview' | 'original',
	factory: () => LibRawWorkerPortV1, receiver: object, signal: unknown, check: () => void, receive: (value: unknown) => void): Promise<unknown> {
	const worker: unknown = Reflect.apply(factory, receiver, []);
	const terminate = captureMethod(worker, 'terminate');
	let remove: ReturnType<typeof captureMethod> | undefined;
	let result: { value: unknown } | { error: unknown };
	let onMessage: Listener | undefined, onError: Listener | undefined, onUnreadable: Listener | undefined;
	let onAbort: (() => void) | undefined;
	const cleanup: unknown[] = [];
	try {
		const add = captureMethod(worker, 'addEventListener'), post = captureMethod(worker, 'postMessage');
		remove = captureMethod(worker, 'removeEventListener'); check();
		result = await new Promise<{ value: unknown } | { error: unknown }>(resolve => {
			let settled = false;
			const settle = (value: { value: unknown } | { error: unknown }) => { if (!settled) { settled = true; resolve(value); } };
			onMessage = event => {
				if (settled) {
					// A transferred response can already be queued when cancellation
					// seals publication. Keep retiring its host-owned plane until exit.
					try { const late = transferredPlane(event.data); if (late) wipe(late); } catch (error) { cleanup.push(error); }
					return;
				}
				try { receive(event.data); settle({ value: event.data }); } catch (error) { settle({ error }); }
			};
			onError = () => { settle({ error: new Error('LibRaw worker failed.') }); };
			onUnreadable = () => { settle({ error: new TypeError('LibRaw worker response could not be read.') }); };
			onAbort = () => { try { check(); } catch (error) { settle({ error }); } };
			try {
				Reflect.apply(add, worker, ['message', onMessage]); Reflect.apply(add, worker, ['error', onError]);
				Reflect.apply(add, worker, ['messageerror', onUnreadable]);
				if (signal !== undefined) Reflect.apply(ADD, signal, ['abort', onAbort, { once: true }]);
				check(); Reflect.apply(post, worker, [{ schemaVersion: 1, kind, module, bytes }, [bytes.buffer]]);
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
	if (failures.length > 1) throw new AggregateError(failures, 'RAW worker operation and retirement failed.', { cause: failures[0] });
	if ('value' in result) return result.value;
	throw new Error('RAW worker has no operation outcome.');
}

function readResponse(value: unknown, kind: 'frame' | 'preview' | 'original') {
	const input = record(value, 'RAW worker response', kind === 'original' ? ['schemaVersion', 'kind', 'frame', 'rawFlip', 'error']
		: ['schemaVersion', 'kind', 'frame', 'preview', 'error'], ['schemaVersion', 'kind']);
	if (field(input, 'schemaVersion', 'RAW worker response') !== 1) throw new RangeError('Unsupported RAW worker response version.');
	if (field(input, 'kind', 'RAW worker response') === 'error') {
		record(value, 'RAW worker error response', ['schemaVersion', 'kind', 'error']);
		const error = record(field(input, 'error', 'RAW worker response'), 'RAW worker error', ['name', 'message']);
		const message = field(error, 'message', 'RAW worker error');
		if (typeof message !== 'string' || message.length > 1024) throw new TypeError('RAW worker returned an invalid error.');
		throw new Error(message);
	}
	if (field(input, 'kind', 'RAW worker response') !== kind) throw new TypeError('RAW worker response does not match its operation.');
	if (kind === 'original') return record(value, 'RAW worker Original response', ['schemaVersion', 'kind', 'frame', 'rawFlip']);
	record(value, 'RAW worker success response', ['schemaVersion', 'kind', kind === 'frame' ? 'frame' : 'preview']);
	return field(input, kind === 'frame' ? 'frame' : 'preview', 'RAW worker response');
}
function readFrame(value: unknown): RawDecodedFrameV1 {
	return readNativeFrame(readResponse(value, 'frame'));
}
function readOriginal(value: unknown): Readonly<RawDecodedOriginalV1> {
	const input = readResponse(value, 'original') as Readonly<Record<string, unknown>>;
	return Object.freeze({ frame: readNativeFrame(field(input, 'frame', 'RAW Original')), rawFlip: scalar(input, 'rawFlip', 0, 7) });
}
function readNativeFrame(value: unknown): RawDecodedFrameV1 {
	const frame = readPixelFrameV1(value, FRAME_LIMITS);
	if (frame.descriptor.sampleFormat !== 'unorm16' || frame.descriptor.primaries !== 'srgb' || frame.descriptor.transfer !== 'linear'
		|| !(frame.pixels instanceof Uint16Array)) throw new TypeError('RAW worker requires linear sRGB RGBA16.');
	privateOutput(frame.pixels);
	return frame as RawDecodedFrameV1;
}
function readPreview(value: unknown): RawEmbeddedPreviewV1 | null {
	const result = readResponse(value, 'preview'); if (result === null) return null;
	const input = record(result, 'RAW embedded preview', ['type', 'width', 'height', 'channels', 'bits', 'rawFlip', 'bytes']);
	const type = field(input, 'type', 'RAW embedded preview'), width = scalar(input, 'width', 1, 8192), height = scalar(input, 'height', 1, 8192);
	const channels = scalar(input, 'channels', 1, 3), bits = scalar(input, 'bits', 8, 16), rawFlip = scalar(input, 'rawFlip', 0, 7);
	const bytes = field(input, 'bytes', 'RAW embedded preview');
	if (typeof bytes === 'object' && bytes !== null) for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) {
		if (Object.hasOwn(bytes, name)) throw new TypeError('RAW embedded preview may not shadow its native geometry.');
	}
	if (!(bytes instanceof NativeBytes) || Object.getPrototypeOf(bytes) !== NativeBytes.prototype || bytes.byteLength < 1 || bytes.byteLength > 16 * 1024 * 1024
		|| width * height > FRAME_LIMITS.maximumPixels || (channels !== 1 && channels !== 3) || (bits !== 8 && bits !== 16)) throw new RangeError('RAW embedded preview exceeds its admitted bounds.');
	privateOutput(bytes);
	if (type === 'jpeg') {
		if (bits !== 8 || bytes[0] !== 255 || bytes[1] !== 216) throw new TypeError('RAW embedded preview requires its actual JPEG bytes.');
	} else if (type !== 'bitmap' || bytes.byteLength !== width * height * channels * (bits / 8)) throw new TypeError('RAW embedded bitmap geometry does not match its bytes.');
	return Object.freeze({ type, width, height, channels, bits, rawFlip, bytes: bytes as Uint8Array<ArrayBuffer> });
}
function scalar(input: Readonly<Record<string, unknown>>, name: string, low: number, high: number): number {
	const value = field(input, name, 'RAW embedded preview');
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < low || value > high) throw new RangeError('RAW preview requires bounded integer metadata.'); return value;
}
function captureInput(value: unknown): Uint8Array<ArrayBuffer> {
	if (!(value instanceof NativeBytes) || Object.getPrototypeOf(value) !== NativeBytes.prototype) throw new TypeError('RAW input requires a native Uint8Array.');
	for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value, name)) throw new TypeError('RAW input may not shadow its native geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer, length = Number(Reflect.apply(LENGTH, value, [])), offset = Number(Reflect.apply(OFFSET, value, []));
	if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) === true || length < 1 || length > 64 * 1024 * 1024) throw new RangeError('RAW input exceeds its 64 MiB byte bound.');
	return new NativeBytes(new NativeBytes(buffer, offset, length));
}
function transferredPlane(value: unknown): Plane | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const frame: unknown = Object.getOwnPropertyDescriptor(value, 'frame')?.value, preview: unknown = Object.getOwnPropertyDescriptor(value, 'preview')?.value;
	const body = typeof frame === 'object' && frame !== null ? frame : preview;
	if (typeof body !== 'object' || body === null) return undefined;
	const view: unknown = Object.getOwnPropertyDescriptor(body, frame === body ? 'pixels' : 'bytes')?.value;
	if (!ArrayBuffer.isView(view)) return undefined;
	const buffer = Reflect.apply(BUFFER, view, []) as ArrayBuffer;
	if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) === true) throw new TypeError('RAW worker output requires fixed private storage.');
	return Object.freeze({ buffer, length: Number(Reflect.apply(SIZE, buffer, [])) });
}
function wipe(plane: Plane): void {
	if (Number(Reflect.apply(SIZE, plane.buffer, [])) !== plane.length) throw new TypeError('RAW output was detached or changed before physical retirement.');
	new NativeBytes(plane.buffer).fill(0);
}
function privateOutput(view: Uint8Array | Uint16Array): void {
	const buffer = Reflect.apply(BUFFER, view, []) as ArrayBuffer;
	const length = Number(Reflect.apply(SIZE, buffer, []));
	if (Reflect.apply(OFFSET, view, []) !== 0 || Reflect.apply(LENGTH, view, []) !== length || length > FRAME_LIMITS.maximumBytes) {
		throw new RangeError('RAW output requires exact bounded private backing storage.');
	}
}
function captureMethod(value: unknown, name: string): (...args: unknown[]) => unknown {
	let current = value;
	for (let depth = 0; typeof current === 'object' && current !== null && depth < 16; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(current, name);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError(`RAW worker requires an inert ${name} method.`);
			return descriptor.value as (...args: unknown[]) => unknown;
		}
		current = Object.getPrototypeOf(current) as unknown;
	}
	throw new TypeError(`RAW worker requires ${name}.`);
}
function defaultWorker(): LibRawWorkerPortV1 {
	return new Worker(new URL('./libraw-worker-v1.ts', import.meta.url), { type: 'module', name: 'lightscaper-libraw' }) as unknown as LibRawWorkerPortV1;
}
