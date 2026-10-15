/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameV1 } from '../imaging/pixel-frame-contract-v1.ts';

export type RawRecoveryProfileV2 = 'linear-headroom-v1' | 'highlight-recovery-v1';
export type RawRecoveryPixelFrameV2 = Extract<PixelFrameV1, { descriptor: { sampleFormat: 'float32' } }>;
export interface RawRecoveryFrameV2 {
	readonly frame: RawRecoveryPixelFrameV2;
	readonly rawFlip: number;
	readonly profile: RawRecoveryProfileV2;
	/** Descriptive same-instance normalization; already applied to native RGB. */
	readonly exposureScale: number;
}
export const LIBRAW_REQUIRED_EXPORTS_V2 = Object.freeze(['memory', '_initialize', 'raw_abi_version', 'raw_profile_version',
	'raw_input_alloc', 'raw_open', 'raw_decode', 'raw_output_ptr', 'raw_output_bytes', 'raw_output_width', 'raw_output_height',
	'raw_output_channels', 'raw_output_bits', 'raw_flip', 'raw_highlight_mode', 'raw_exposure_scale', 'raw_destroy'] as const);
export const LIBRAW_ALLOWED_IMPORTS_V2 = Object.freeze(['env.emscripten_notify_memory_growth',
	'wasi_snapshot_preview1.fd_read', 'wasi_snapshot_preview1.fd_close', 'wasi_snapshot_preview1.fd_write', 'wasi_snapshot_preview1.fd_seek'] as const);
export const LIBRAW_AUXILIARY_EXPORTS_V2 = Object.freeze({ __indirect_function_table: 'table', __trap: 'function' } as const);

const MAXIMUM_MEMORY = 512 * 1024 * 1024, MAXIMUM_INPUT = 64 * 1024 * 1024, MAXIMUM_PIXELS = 16_777_216;
const NativeBytes = Uint8Array, NativeFloats = Float32Array;
const LITTLE_ENDIAN = new NativeFloats(NativeBytes.of(0, 0, 128, 63).buffer)[0] === 1;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
type FunctionName = Exclude<typeof LIBRAW_REQUIRED_EXPORTS_V2[number], 'memory'>;
type Native = Readonly<{ memory: WebAssembly.Memory; calls: Readonly<Record<FunctionName, (...args: number[]) => number>> }>;

/** A separate native ABI captures signed RGB before the ushort RGB conversion.
 * Only the two fixed profiles exist; no native option or heap view escapes. */
export function decodeLibRawRecoveryWasmV2(module: WebAssembly.Module, bytes: Uint8Array<ArrayBuffer>,
	profile: RawRecoveryProfileV2): Readonly<RawRecoveryFrameV2> {
	const mode = profile === 'linear-headroom-v1' ? 1 : profile === 'highlight-recovery-v1' ? 3 : undefined;
	if (mode === undefined) throw new RangeError('Unsupported fixed RAW recovery profile.');
	const source = privateInput(bytes);
	let memory: WebAssembly.Memory | undefined, native: Native | undefined;
	let outcome: { value: Readonly<RawRecoveryFrameV2> } | { error: unknown };
	try {
		const instance = new WebAssembly.Instance(module, auditedImports(module)), exported = instance.exports;
		if (!(exported.memory instanceof WebAssembly.Memory)) throw new TypeError('LibRaw recovery requires exported native memory.');
		memory = exported.memory; boundedMemory(memory);
		const calls = {} as Record<FunctionName, (...args: number[]) => number>;
		for (const name of LIBRAW_REQUIRED_EXPORTS_V2) {
			if (name === 'memory') continue;
			const method = exported[name]; if (typeof method !== 'function') throw new TypeError(`LibRaw recovery is missing ${name}.`);
			calls[name] = method as (...args: number[]) => number;
		}
		native = Object.freeze({ memory, calls: Object.freeze(calls) }); calls._initialize(); boundedMemory(memory);
		if (calls.raw_abi_version() !== 2 || calls.raw_profile_version() !== 1) throw new RangeError('Unsupported LibRaw recovery ABI/profile version.');
		const pointer = calls.raw_input_alloc(source.byteLength); boundedMemory(memory);
		span(native, pointer, source.byteLength, 1).set(source); status(native, 'raw_open');
		outcome = { value: decode(native, profile, mode) };
	} catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try { native?.calls.raw_destroy(); } catch (error) { failures.push(error); }
	try { if (memory) { boundedMemory(memory); new NativeBytes(memory.buffer).fill(0); } } catch (error) { failures.push(error); }
	if (failures.length) {
		if ('value' in outcome) new NativeBytes(outcome.value.frame.pixels.buffer).fill(0);
		if (failures.length === 1) throw failures[0];
		throw new AggregateError(failures, 'LibRaw recovery native operation and retirement failed.', { cause: failures[0] });
	}
	if ('value' in outcome) return outcome.value;
	throw new Error('LibRaw recovery native scope has no outcome.');
}

function decode(native: Native, profile: RawRecoveryProfileV2, mode: 1 | 3): Readonly<RawRecoveryFrameV2> {
	status(native, 'raw_decode', mode);
	if (integer(native, 'raw_profile_version') !== 1 || integer(native, 'raw_highlight_mode') !== mode) {
		throw new RangeError('LibRaw recovery returned a different fixed profile.');
	}
	const width = dimension(native, 'raw_output_width'), height = dimension(native, 'raw_output_height'), count = width * height;
	if (count > MAXIMUM_PIXELS || integer(native, 'raw_output_channels') !== 3 || integer(native, 'raw_output_bits') !== 32) {
		throw new RangeError('LibRaw recovery requires bounded native RGB Float32.');
	}
	const length = integer(native, 'raw_output_bytes'), rawFlip = integer(native, 'raw_flip');
	const exposureScale = native.calls.raw_exposure_scale(); boundedMemory(native.memory);
	if (length !== count * 12 || rawFlip > 7 || !Number.isFinite(exposureScale) || exposureScale < 1 || exposureScale > 65_536) {
		throw new RangeError('LibRaw recovery output geometry or normalization is invalid.');
	}
	const source = span(native, integer(native, 'raw_output_ptr'), length, 4);
	const rgb = LITTLE_ENDIAN ? new NativeFloats(source.buffer, source.byteOffset, count * 3) : undefined;
	const littleEndian = new DataView(source.buffer, source.byteOffset, length), pixels = new NativeFloats(count * 4);
	try {
		for (let pixel = 0; pixel < count; pixel++) {
			for (let channel = 0; channel < 3; channel++) {
				const index = pixel * 3 + channel;
				const value = rgb ? rgb[index]! : littleEndian.getFloat32(index * 4, true);
				if (!Number.isFinite(value)) throw new RangeError('LibRaw recovery RGB samples must be finite.');
				pixels[pixel * 4 + channel] = value;
			}
			pixels[pixel * 4 + 3] = 1;
		}
		return Object.freeze({ profile, rawFlip, exposureScale, frame: Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1,
			width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }), pixels }) });
	} catch (error) { new NativeBytes(pixels.buffer).fill(0); throw error; }
}

function privateInput(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
	if (!(value instanceof NativeBytes) || Object.getPrototypeOf(value) !== NativeBytes.prototype) throw new TypeError('LibRaw recovery requires native RAW bytes.');
	for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value, name)) throw new TypeError('RAW recovery input may not shadow its native geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer, length = Number(Reflect.apply(LENGTH, value, []));
	if (!(buffer instanceof ArrayBuffer) || (RESIZABLE && Reflect.apply(RESIZABLE, buffer, []) === true) || Number(Reflect.apply(SIZE, buffer, [])) > MAXIMUM_INPUT
		|| length < 1 || length > MAXIMUM_INPUT) throw new RangeError('LibRaw recovery input exceeds its fixed physical byte bound.');
	return new NativeBytes(buffer, Number(Reflect.apply(OFFSET, value, [])), length);
}
function auditedImports(module: WebAssembly.Module): WebAssembly.Imports {
	const allowed = new Set<string>(LIBRAW_ALLOWED_IMPORTS_V2), required = new Set<string>(LIBRAW_REQUIRED_EXPORTS_V2);
	const auxiliary = new Map<string, string>(Object.entries(LIBRAW_AUXILIARY_EXPORTS_V2)), seen = new Set<string>();
	for (const item of WebAssembly.Module.exports(module)) {
		const kind = required.has(item.name) ? item.name === 'memory' ? 'memory' : 'function' : auxiliary.get(item.name);
		if (!kind || item.kind !== kind) throw new TypeError(`LibRaw recovery has an unexpected export ${item.name}.`);
		seen.add(item.name);
	}
	for (const name of required) if (!seen.has(name)) throw new TypeError(`LibRaw recovery is missing ${name}.`);
	const imports: Record<string, Record<string, (...args: number[]) => number | void>> = {};
	for (const item of WebAssembly.Module.imports(module)) {
		const key = `${item.module}.${item.name}`;
		if (item.kind !== 'function' || !allowed.has(key)) throw new TypeError(`LibRaw recovery has a forbidden import ${key}.`);
		imports[item.module] ??= {};
		// Descriptor operations are inert EBADF; decoding grants no host I/O.
		imports[item.module]![item.name] = key === 'env.emscripten_notify_memory_growth' ? () => undefined : () => 8;
	}
	return imports;
}
function boundedMemory(memory: WebAssembly.Memory): void {
	if (!(memory.buffer instanceof ArrayBuffer) || memory.buffer.byteLength < 32 * 1024 * 1024 || memory.buffer.byteLength > MAXIMUM_MEMORY) {
		throw new RangeError('LibRaw recovery memory exceeds its audited bounds.');
	}
}
function integer(native: Native, name: FunctionName): number {
	const value = native.calls[name](); boundedMemory(native.memory);
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`LibRaw recovery ${name} returned an invalid scalar.`);
	return value;
}
function dimension(native: Native, name: FunctionName): number {
	const value = integer(native, name); if (value < 16 || value > 8192) throw new RangeError('LibRaw recovery output dimension exceeds its declared profile.'); return value;
}
function span(native: Native, pointer: number, length: number, alignment: number): Uint8Array<ArrayBuffer> {
	boundedMemory(native.memory);
	if (!Number.isSafeInteger(pointer) || pointer < 1 || pointer % alignment !== 0 || pointer + length > native.memory.buffer.byteLength) {
		throw new RangeError('LibRaw recovery pointer exceeds its admitted native memory.');
	}
	return new NativeBytes(native.memory.buffer, pointer, length);
}
function status(native: Native, name: 'raw_open' | 'raw_decode', ...args: number[]): void {
	const value = native.calls[name](...args); boundedMemory(native.memory);
	if (value !== 0) throw new Error(`LibRaw recovery ${name} failed (${String(value)}).`);
}
