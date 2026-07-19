/*
 * Narrow loader for Soundscaper's pinned WavPack WebAssembly ABI.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	WAVPACK_PCM_MAXIMUM_CHANNELS,
	WAVPACK_PCM_MAXIMUM_FRAMES,
	exactArrayBuffer,
	normalizePcmSampleRate,
	pcmRawByteLength,
	validatePcmGeometry,
} from './pcm.js';

export const WAVPACK_WASM_ABI_VERSION = 1;
export const WAVPACK_WASM_INITIAL_MEMORY_BYTES = 8 * 1024 * 1024;
export const WAVPACK_WASM_MAXIMUM_MEMORY_BYTES = 128 * 1024 * 1024;
export const WAVPACK_WASM_URL = new URL('./wavpack.wasm', import.meta.url);

export const WAVPACK_REQUIRED_EXPORTS = Object.freeze([
	'memory',
	'_initialize',
	'scwp_abi_version',
	'scwp_maximum_channels',
	'scwp_maximum_frames',
	'scwp_initial_memory_bytes',
	'scwp_maximum_memory_bytes',
	'scwp_allocate',
	'scwp_free',
	'scwp_encode_float32',
	'scwp_decode_float32',
]);

const ALLOWED_FUNCTION_IMPORTS = Object.freeze({
	'env.emscripten_notify_memory_growth': () => {},
	'env.abort': () => { throw new WavPackRuntimeError('WavPack WebAssembly aborted.', 'WAVPACK_ABORT'); },
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.proc_exit': (code) => {
		throw new WavPackRuntimeError(`WavPack WebAssembly exited with code ${code}.`, 'WAVPACK_EXIT');
	},
});

const ERROR_CODES = new Map([
	[-1, ['WAVPACK_INVALID_ARGUMENT', 'WavPack rejected invalid PCM geometry or buffer bounds.']],
	[-2, ['WAVPACK_ALLOCATION_FAILED', 'WavPack could not allocate bounded working memory.']],
	[-3, ['WAVPACK_CONFIGURATION_FAILED', 'WavPack rejected the lossless float configuration.']],
	[-4, ['WAVPACK_OUTPUT_CAPACITY', 'The encoded WavPack stream exceeded its adaptive size limit.']],
	[-5, ['WAVPACK_CODEC_FAILED', 'WavPack could not process the PCM chunk.']],
	[-6, ['WAVPACK_INVALID_STREAM', 'The persisted WavPack stream is invalid or not lossless float PCM.']],
	[-7, ['WAVPACK_GEOMETRY_MISMATCH', 'The WavPack stream does not match its persisted PCM geometry.']],
	[-8, ['WAVPACK_CHECKSUM_FAILED', 'The WavPack stream failed its block checksum or decode validation.']],
]);

export class WavPackRuntimeError extends Error {
	constructor(message, code = 'WAVPACK_RUNTIME_ERROR', options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = 'WavPackRuntimeError';
		this.code = code;
	}
}

export class WavPackWasmRuntime {
	constructor(instance) {
		if (!(instance instanceof WebAssembly.Instance)) {
			throw new TypeError('A WebAssembly.Instance is required.');
		}
		this.instance = instance;
		this.exports = normalizeExports(instance.exports);
		this.memory = this.exports.memory;
		this.exports._initialize();
		if (this.exports.scwp_abi_version() !== WAVPACK_WASM_ABI_VERSION) {
			throw new WavPackRuntimeError('The WavPack artifact reports an unsupported ABI.', 'WAVPACK_ABI_MISMATCH');
		}
		if (this.exports.scwp_maximum_channels() !== WAVPACK_PCM_MAXIMUM_CHANNELS
			|| this.exports.scwp_maximum_frames() !== WAVPACK_PCM_MAXIMUM_FRAMES
			|| this.exports.scwp_initial_memory_bytes() !== WAVPACK_WASM_INITIAL_MEMORY_BYTES
			|| this.exports.scwp_maximum_memory_bytes() !== WAVPACK_WASM_MAXIMUM_MEMORY_BYTES) {
			throw new WavPackRuntimeError('The WavPack artifact reports unexpected resource limits.', 'WAVPACK_LIMIT_MISMATCH');
		}
	}

	encode(rawInput, {
		frames,
		channelCount,
		sampleRate,
		maximumOutputBytes,
	} = {}) {
		validatePcmGeometry(frames, channelCount);
		const normalizedSampleRate = normalizePcmSampleRate(sampleRate);
		const input = exactArrayBuffer(rawInput);
		const rawBytes = pcmRawByteLength(frames, channelCount);
		const outputCapacity = Number(maximumOutputBytes);
		if (input.byteLength !== rawBytes) {
			throw new RangeError(`Raw PCM has ${input.byteLength} bytes; expected ${rawBytes}.`);
		}
		if (!Number.isSafeInteger(outputCapacity) || outputCapacity < 1 || outputCapacity > rawBytes) {
			throw new RangeError('WavPack output capacity must be a positive integer no larger than raw PCM.');
		}
		const inputPointer = this.#allocate(rawBytes);
		let outputPointer = 0;
		try {
			outputPointer = this.#allocate(outputCapacity);
			new Uint8Array(this.memory.buffer, inputPointer, rawBytes).set(new Uint8Array(input));
			const result = this.exports.scwp_encode_float32(
				inputPointer,
				frames,
				channelCount,
				normalizedSampleRate,
				outputPointer,
				outputCapacity,
			);
			if (result === -4) return null;
			if (result <= 0 || result > outputCapacity) throw runtimeResultError(result);
			return this.memory.buffer.slice(outputPointer, outputPointer + result);
		} finally {
			if (outputPointer) this.exports.scwp_free(outputPointer);
			this.exports.scwp_free(inputPointer);
		}
	}

	decode(encodedInput, {
		frames,
		channelCount,
		sampleRate,
	} = {}) {
		validatePcmGeometry(frames, channelCount);
		const normalizedSampleRate = normalizePcmSampleRate(sampleRate);
		const input = exactArrayBuffer(encodedInput);
		const rawBytes = pcmRawByteLength(frames, channelCount);
		if (!input.byteLength || input.byteLength > rawBytes) {
			throw new WavPackRuntimeError(
				'The persisted WavPack payload has an invalid bounded length.',
				'WAVPACK_INVALID_STREAM',
			);
		}
		const inputPointer = this.#allocate(input.byteLength);
		let outputPointer = 0;
		try {
			outputPointer = this.#allocate(rawBytes);
			new Uint8Array(this.memory.buffer, inputPointer, input.byteLength).set(new Uint8Array(input));
			const result = this.exports.scwp_decode_float32(
				inputPointer,
				input.byteLength,
				frames,
				channelCount,
				normalizedSampleRate,
				outputPointer,
				rawBytes,
			);
			if (result !== rawBytes) throw runtimeResultError(result);
			return this.memory.buffer.slice(outputPointer, outputPointer + rawBytes);
		} finally {
			if (outputPointer) this.exports.scwp_free(outputPointer);
			this.exports.scwp_free(inputPointer);
		}
	}

	#allocate(bytes) {
		const pointer = this.exports.scwp_allocate(bytes);
		if (!pointer) {
			throw new WavPackRuntimeError(
				`WavPack could not allocate ${bytes} bytes within its memory budget.`,
				'WAVPACK_ALLOCATION_FAILED',
			);
		}
		if (pointer + bytes > this.memory.buffer.byteLength) {
			this.exports.scwp_free(pointer);
			throw new WavPackRuntimeError('WavPack returned an out-of-bounds allocation.', 'WAVPACK_MEMORY_BOUNDS');
		}
		return pointer;
	}
}

export async function loadWavPackWasm(source = WAVPACK_WASM_URL) {
	const module = await compileModule(source);
	const imports = createImports(module);
	const instance = await WebAssembly.instantiate(module, imports);
	return new WavPackWasmRuntime(instance);
}

function runtimeResultError(result) {
	const [code, message] = ERROR_CODES.get(result) || [
		'WAVPACK_INVALID_RESULT',
		`WavPack returned unexpected result ${result}.`,
	];
	return new WavPackRuntimeError(message, code);
}

function normalizeExports(exports) {
	const normalized = { memory: exports.memory };
	for (const name of WAVPACK_REQUIRED_EXPORTS) {
		if (name === 'memory') continue;
		const value = exports[name] || exports[`_${name}`];
		if (typeof value !== 'function') {
			throw new WavPackRuntimeError(`Missing WavPack WASM export: ${name}.`, 'WAVPACK_MISSING_EXPORT');
		}
		normalized[name] = value;
	}
	if (!(normalized.memory instanceof WebAssembly.Memory)) {
		throw new WavPackRuntimeError('WavPack WASM does not export linear memory.', 'WAVPACK_MISSING_MEMORY');
	}
	return normalized;
}

async function compileModule(source) {
	if (source instanceof WebAssembly.Module) return source;
	if (source instanceof Response) return WebAssembly.compile(await source.arrayBuffer());
	if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
		return WebAssembly.compile(source);
	}
	const response = await fetch(source);
	if (!response.ok) {
		throw new WavPackRuntimeError(
			`Could not load WavPack WebAssembly (${response.status}).`,
			'WAVPACK_LOAD_FAILED',
		);
	}
	return WebAssembly.compile(await response.arrayBuffer());
}

function createImports(module) {
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		if (descriptor.kind !== 'function' || !Object.hasOwn(ALLOWED_FUNCTION_IMPORTS, key)) {
			throw new WavPackRuntimeError(`Forbidden WavPack WASM import: ${descriptor.kind} ${key}.`, 'WAVPACK_FORBIDDEN_IMPORT');
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = ALLOWED_FUNCTION_IMPORTS[key];
	}
	return imports;
}
