/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameV1 } from '../imaging/pixel-frame-contract-v1.ts';

export type RawDecodedFrameV1 = Extract<PixelFrameV1, { descriptor: { sampleFormat: 'unorm16' } }>;
export interface RawEmbeddedPreviewV1 {
	readonly type: 'jpeg' | 'bitmap';
	readonly width: number;
	readonly height: number;
	readonly channels: number;
	readonly bits: number;
	readonly rawFlip: number;
	readonly bytes: Uint8Array<ArrayBuffer>;
}

export const LIBRAW_REQUIRED_EXPORTS_V1 = Object.freeze(['memory', '_initialize', 'raw_abi_version', 'raw_input_alloc', 'raw_open',
	'raw_decode', 'raw_output_ptr', 'raw_output_bytes', 'raw_output_width', 'raw_output_height', 'raw_output_channels', 'raw_output_bits',
	'raw_preview', 'raw_preview_ptr', 'raw_preview_bytes', 'raw_preview_type', 'raw_preview_width', 'raw_preview_height',
	'raw_preview_channels', 'raw_preview_bits', 'raw_flip', 'raw_destroy'] as const);
export const LIBRAW_ALLOWED_IMPORTS_V1 = Object.freeze(['env.emscripten_notify_memory_growth',
	'wasi_snapshot_preview1.fd_read', 'wasi_snapshot_preview1.fd_close', 'wasi_snapshot_preview1.fd_write', 'wasi_snapshot_preview1.fd_seek'] as const);
export const LIBRAW_AUXILIARY_EXPORTS_V1 = Object.freeze({ __indirect_function_table: 'table', __trap: 'function' } as const);

const MAXIMUM_MEMORY = 512 * 1024 * 1024, MAXIMUM_INPUT = 64 * 1024 * 1024, MAXIMUM_PIXELS = 16_777_216;
const NativeBytes = Uint8Array, NativeWords = Uint16Array;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
type FunctionName = Exclude<typeof LIBRAW_REQUIRED_EXPORTS_V1[number], 'memory'>;
type Native = Readonly<{ memory: WebAssembly.Memory; calls: Readonly<Record<FunctionName, (...args: number[]) => number>> }>;

/** The loader certifies the original binary's declared memory maximum; this scope
 * independently checks its native ABI, imports and actual allocations. No handle
 * or view of the Wasm heap escapes its destroy-and-wipe boundary. */
export function decodeLibRawWasmV1(module: WebAssembly.Module, bytes: Uint8Array<ArrayBuffer>): RawDecodedFrameV1 {
	return withNative(module, bytes, native => {
		status(native, 'raw_decode');
		const width = dimension(native, 'raw_output_width'), height = dimension(native, 'raw_output_height');
		const count = pixelCount(width, height);
		if (integer(native, 'raw_output_channels') !== 3 || integer(native, 'raw_output_bits') !== 16) throw new TypeError('LibRaw requires native RGB16 output.');
		const length = integer(native, 'raw_output_bytes');
		if (length !== count * 6) throw new RangeError('LibRaw RGB16 output length does not match its geometry.');
		const pointer = integer(native, 'raw_output_ptr'), source = span(native, pointer, length, 2);
		const words = new NativeWords(source.buffer, source.byteOffset, count * 3), pixels = new NativeWords(count * 4);
		for (let pixel = 0; pixel < count; pixel++) {
			pixels[pixel * 4] = words[pixel * 3]!; pixels[pixel * 4 + 1] = words[pixel * 3 + 1]!;
			pixels[pixel * 4 + 2] = words[pixel * 3 + 2]!; pixels[pixel * 4 + 3] = 65_535;
		}
		return Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1, width, height,
			sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }), pixels });
	});
}

export function readLibRawEmbeddedPreviewWasmV1(module: WebAssembly.Module, bytes: Uint8Array<ArrayBuffer>): RawEmbeddedPreviewV1 | null {
	return withNative(module, bytes, native => {
		const code = native.calls.raw_preview(); boundedMemory(native.memory);
		// Upstream's missing/unsupported embedded preview errors are nonfatal.
		if (code === -5 || code === -6) return null;
		if (code !== 0) throw new Error(`LibRaw embedded preview failed (${String(code)}).`);
		const type = integer(native, 'raw_preview_type'), length = integer(native, 'raw_preview_bytes');
		const width = integer(native, 'raw_preview_width'), height = integer(native, 'raw_preview_height');
		const channels = integer(native, 'raw_preview_channels'), bits = integer(native, 'raw_preview_bits'), rawFlip = integer(native, 'raw_flip');
		if (rawFlip > 7 || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > MAXIMUM_PIXELS
			|| length < 1 || length > 16 * 1024 * 1024) throw new RangeError('LibRaw embedded preview geometry exceeds its bounds.');
		if (type !== 1 && type !== 2) throw new RangeError('LibRaw embedded preview format is unsupported.');
		if (type === 1) {
			if (length < 2 || bits !== 8 || (channels !== 1 && channels !== 3)) throw new RangeError('LibRaw JPEG preview requires its admitted native header.');
		} else {
			pixelCount(width, height);
			if ((channels !== 1 && channels !== 3) || (bits !== 8 && bits !== 16)
				|| length !== width * height * channels * (bits / 8)) throw new RangeError('LibRaw bitmap preview requires exact admitted geometry.');
		}
		const source = span(native, integer(native, 'raw_preview_ptr'), length, 1);
		if (type === 1 && (source[0] !== 255 || source[1] !== 216)) throw new TypeError('LibRaw JPEG preview is missing its JPEG header.');
		return Object.freeze({ type: type === 1 ? 'jpeg' : 'bitmap', width, height, channels, bits, rawFlip, bytes: new NativeBytes(source) });
	});
}

function withNative<Result extends RawDecodedFrameV1 | RawEmbeddedPreviewV1 | null>(module: WebAssembly.Module,
	bytes: Uint8Array<ArrayBuffer>, consume: (native: Native) => Result): Result {
	let memory: WebAssembly.Memory | undefined, native: Native | undefined;
	let outcome: { value: Result } | { error: unknown };
	try {
		const imports = auditedImports(module);
		const instance = new WebAssembly.Instance(module, imports), exported = instance.exports;
		if (!(exported.memory instanceof WebAssembly.Memory)) throw new TypeError('LibRaw requires an exported native memory.');
		memory = exported.memory; boundedMemory(memory);
		const calls = {} as Record<FunctionName, (...args: number[]) => number>;
		for (const name of LIBRAW_REQUIRED_EXPORTS_V1) {
			if (name === 'memory') continue;
			const method = exported[name]; if (typeof method !== 'function') throw new TypeError(`LibRaw is missing native export ${name}.`);
			calls[name] = method as (...args: number[]) => number;
		}
		native = Object.freeze({ memory, calls: Object.freeze(calls) });
		calls._initialize(); boundedMemory(memory);
		if (calls.raw_abi_version() !== 1) throw new RangeError('Unsupported LibRaw native ABI.');
		if (Object.getPrototypeOf(bytes) !== NativeBytes.prototype || !(bytes.buffer instanceof ArrayBuffer)
			|| (RESIZABLE && Reflect.apply(RESIZABLE, bytes.buffer, []) === true) || bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_INPUT) {
			throw new RangeError('LibRaw requires a bounded native RAW byte span.');
		}
		const pointer = calls.raw_input_alloc(bytes.byteLength); boundedMemory(memory);
		span(native, pointer, bytes.byteLength, 1).set(bytes);
		status(native, 'raw_open'); outcome = { value: consume(native) };
	} catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try { native?.calls.raw_destroy(); } catch (error) { failures.push(error); }
	try { if (memory) { boundedMemory(memory); new NativeBytes(memory.buffer).fill(0); } } catch (error) { failures.push(error); }
	if (failures.length) {
		if ('value' in outcome && outcome.value) {
			const bytes = 'pixels' in outcome.value ? outcome.value.pixels : outcome.value.bytes;
			new NativeBytes(bytes.buffer).fill(0);
		}
		if (failures.length === 1) throw failures[0];
		throw new AggregateError(failures, 'LibRaw native operation and retirement failed.', { cause: failures[0] });
	}
	if ('value' in outcome) return outcome.value;
	throw new Error('LibRaw native scope has no operation outcome.');
}

function auditedImports(module: WebAssembly.Module): WebAssembly.Imports {
	const allowed = new Set<string>(LIBRAW_ALLOWED_IMPORTS_V1), required = new Set<string>(LIBRAW_REQUIRED_EXPORTS_V1);
	const auxiliary = new Map<string, string>(Object.entries(LIBRAW_AUXILIARY_EXPORTS_V1)), seen = new Set<string>();
	for (const item of WebAssembly.Module.exports(module)) {
		const expected = required.has(item.name) ? item.name === 'memory' ? 'memory' : 'function' : auxiliary.get(item.name);
		if (!expected || item.kind !== expected) throw new TypeError(`LibRaw has an unexpected native export ${item.name}.`);
		seen.add(item.name);
	}
	for (const name of required) if (!seen.has(name)) throw new TypeError(`LibRaw is missing native export ${name}.`);
	const imports: Record<string, Record<string, (...args: number[]) => number | void>> = {};
	for (const item of WebAssembly.Module.imports(module)) {
		const key = `${item.module}.${item.name}`;
		if (item.kind !== 'function' || !allowed.has(key)) throw new TypeError(`LibRaw has a forbidden native import ${key}.`);
		imports[item.module] ??= {};
		// All descriptor operations fail EBADF; no host filesystem is available.
		imports[item.module]![item.name] = key === 'env.emscripten_notify_memory_growth' ? () => undefined : () => 8;
	}
	return imports;
}
function boundedMemory(memory: WebAssembly.Memory): void {
	if (!(memory.buffer instanceof ArrayBuffer) || memory.buffer.byteLength < 32 * 1024 * 1024 || memory.buffer.byteLength > MAXIMUM_MEMORY) {
		throw new RangeError('LibRaw native memory exceeds its audited bounds.');
	}
}
function integer(native: Native, name: FunctionName): number {
	const value = native.calls[name](); boundedMemory(native.memory);
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`LibRaw ${name} returned an invalid unsigned scalar.`);
	return value;
}
function dimension(native: Native, name: FunctionName): number {
	const value = integer(native, name); if (value < 1 || value > 8192) throw new RangeError('LibRaw output dimension exceeds its admitted bounds.'); return value;
}
function pixelCount(width: number, height: number): number {
	const count = width * height; if (count < 1 || count > MAXIMUM_PIXELS) throw new RangeError('LibRaw output pixel count exceeds its admitted bounds.'); return count;
}
function span(native: Native, pointer: number, length: number, alignment: number): Uint8Array<ArrayBuffer> {
	boundedMemory(native.memory);
	if (!Number.isSafeInteger(pointer) || pointer < 1 || pointer % alignment !== 0 || pointer + length > native.memory.buffer.byteLength) {
		throw new RangeError('LibRaw native output pointer exceeds its admitted memory.');
	}
	return new NativeBytes(native.memory.buffer, pointer, length);
}
function status(native: Native, name: FunctionName): void {
	const code = native.calls[name](); boundedMemory(native.memory);
	if (code !== 0) throw new Error(`LibRaw ${name} failed (${String(code)}).`);
}
