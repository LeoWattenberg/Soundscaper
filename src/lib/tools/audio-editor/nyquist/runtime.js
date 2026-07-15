/*
 * Loader and narrow JavaScript adapter for the browser Nyx WebAssembly ABI.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	NYQUIST_MAX_CHANNELS,
	NYQUIST_MAX_SOURCE_BYTES,
	NYQUIST_MAX_TEXT_BYTES,
	NYQUIST_MAX_TOTAL_AUDIO_SAMPLES,
	NYQUIST_WASM_ABI_VERSION,
	buildNyquistEvaluationSource,
	normalizeNyquistRequest,
	normalizeNyquistResult,
} from './protocol.js';

export const NYQUIST_WASM_URL = new URL('./nyquist.wasm', import.meta.url);

export const NYQUIST_REQUIRED_EXPORTS = Object.freeze([
	'memory',
	'_initialize',
	'nyq_abi_version',
	'nyq_create',
	'nyq_destroy',
	'nyq_input_pointer',
	'nyq_eval',
	'nyq_render_audio',
	'nyq_result_type',
	'nyq_audio_channels',
	'nyq_audio_frames',
	'nyq_audio_pointer',
	'nyq_result_int',
	'nyq_result_double',
	'nyq_result_string',
	'nyq_label_count',
	'nyq_label_start',
	'nyq_label_end',
	'nyq_label_text',
	'nyq_output',
	'nyq_error',
	'nyq_alloc',
	'nyq_free',
]);

const RESULT_ERROR = 0;
const RESULT_AUDIO = 1;
const RESULT_INTEGER = 2;
const RESULT_DOUBLE = 3;
const RESULT_STRING = 4;
const RESULT_LABELS = 5;
const RESULT_LIST = 6;
const RESULT_TYPES = new Set([
	RESULT_ERROR,
	RESULT_AUDIO,
	RESULT_INTEGER,
	RESULT_DOUBLE,
	RESULT_STRING,
	RESULT_LABELS,
	RESULT_LIST,
]);
const MAX_WASM_MEMORY_BYTES = 256 * 1024 * 1024;
const WASI_SUCCESS = 0;
const WASI_BADF = 8;
const WASI_FAULT = 21;
const WASI_NOSYS = 52;
const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export class NyquistRuntimeError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = 'NyquistRuntimeError';
		this.code = options.code || 'NYQUIST_RUNTIME_ERROR';
		this.output = options.output || '';
		if (options.cause !== undefined) this.cause = options.cause;
	}
}

export class NyquistWasmRuntime {
	constructor(instance) {
		if (!(instance instanceof WebAssembly.Instance)) throw new TypeError('A WebAssembly.Instance is required.');
		this.instance = instance;
		this.exports = normalizeExports(instance.exports);
		this.memory = this.exports.memory;
		assertMemorySize(this.memory);
		this.exports._initialize();
		assertMemorySize(this.memory);
		const abiVersion = this.exports.nyq_abi_version();
		if (abiVersion !== NYQUIST_WASM_ABI_VERSION) {
			throw new NyquistRuntimeError(
				`Unsupported Nyquist WASM ABI ${abiVersion}; expected ${NYQUIST_WASM_ABI_VERSION}.`,
				{ code: 'NYQUIST_ABI_MISMATCH' },
			);
		}
	}

	evaluate(request, hooks = {}) {
		const normalized = normalizeNyquistRequest(request);
		return evaluateWithExports(normalized, this, hooks);
	}
}

export async function loadNyquistWasm(source = NYQUIST_WASM_URL) {
	const module = await compileModule(source);
	const importState = { memory: null };
	const imports = createImports(module, importState);
	const instance = await WebAssembly.instantiate(module, imports);
	importState.memory = instance.exports.memory;
	return new NyquistWasmRuntime(instance);
}

export async function evaluateNyquist(request, runtime, hooks = {}) {
	const normalized = normalizeNyquistRequest(request);
	if (runtime instanceof NyquistWasmRuntime) return evaluateWithExports(normalized, runtime, hooks);
	if (!runtime || typeof runtime.evaluate !== 'function') throw new TypeError('A Nyquist WASM runtime is required.');
	return normalizeNyquistResult(await runtime.evaluate(normalized, hooks));
}

function evaluateWithExports(request, runtime, hooks) {
	const isCancelled = typeof hooks.isCancelled === 'function' ? hooks.isCancelled : () => false;
	const onProgress = typeof hooks.onProgress === 'function' ? hooks.onProgress : () => {};
	throwIfCancelled(isCancelled);
	onProgress(0);
	const { exports, memory } = runtime;
	const channelCount = request.channels.length;
	const inputFrames = request.channels[0]?.length || 0;
	const handle = exports.nyq_create(request.sampleRate, channelCount, inputFrames);
	if (!handle) {
		throw new NyquistRuntimeError('Nyquist could not allocate an evaluation session.', {
			code: 'NYQUIST_ALLOCATION_FAILED',
		});
	}
	let sourcePointer = 0;
	try {
		assertMemorySize(memory);
		copyInputAudio(request.channels, handle, exports, memory);
		const preparedSource = buildNyquistEvaluationSource(request, { normalized: true });
		const bytes = encoder.encode(preparedSource);
		if (bytes.byteLength > NYQUIST_MAX_SOURCE_BYTES) throw new RangeError('Prepared Nyquist source is too large.');
		sourcePointer = exports.nyq_alloc(bytes.byteLength + 1);
		if (!sourcePointer) {
			throw new NyquistRuntimeError('Nyquist could not allocate source memory.', {
				code: 'NYQUIST_ALLOCATION_FAILED',
			});
		}
		writeBytes(memory, sourcePointer, bytes, 'Nyquist source');
		new Uint8Array(memory.buffer, sourcePointer + bytes.byteLength, 1)[0] = 0;
		throwIfCancelled(isCancelled);
		const evaluatedType = exports.nyq_eval(handle, sourcePointer, bytes.byteLength);
		exports.nyq_free(sourcePointer);
		sourcePointer = 0;
		assertMemorySize(memory);
		throwIfCancelled(isCancelled);
		const resultType = exports.nyq_result_type(handle);
		const output = readCString(memory, exports.nyq_output(handle), 'Nyquist output', true);
		if (!RESULT_TYPES.has(evaluatedType) || !RESULT_TYPES.has(resultType) || evaluatedType !== resultType) {
			throw new NyquistRuntimeError('Nyquist returned an invalid result discriminator.', {
				code: 'NYQUIST_INVALID_RESULT',
				output,
			});
		}
		if (resultType === RESULT_ERROR) throwEvaluationError(handle, exports, memory, output);
		if (resultType === RESULT_AUDIO) {
			onProgress(0.5);
			const status = exports.nyq_render_audio(handle, request.maxOutputFrames);
			assertMemorySize(memory);
			throwIfCancelled(isCancelled);
			if (status !== 0) throwEvaluationError(handle, exports, memory, output, 'NYQUIST_RENDER_FAILED');
			const finalOutput = readCString(memory, exports.nyq_output(handle), 'Nyquist output', true);
			const result = readAudioResult(handle, exports, memory, request.sampleRate, request.maxOutputFrames, finalOutput);
			onProgress(1);
			return result;
		}
		let result;
		if (resultType === RESULT_INTEGER) {
			result = {
				type: 'number',
				value: exports.nyq_result_int(handle),
				numericType: 'integer',
				output,
			};
		} else if (resultType === RESULT_DOUBLE) {
			result = {
				type: 'number',
				value: exports.nyq_result_double(handle),
				numericType: 'double',
				output,
			};
		} else if (resultType === RESULT_STRING) {
			result = {
				type: 'message',
				message: readCString(memory, exports.nyq_result_string(handle), 'Nyquist string result', true),
				output,
			};
		} else if (resultType === RESULT_LABELS) {
			result = readLabelResult(handle, exports, memory, output);
		} else {
			result = {
				type: 'message',
				message: output || 'Nyquist returned no audio, labels, message, or number.',
				output,
			};
		}
		onProgress(1);
		return normalizeNyquistResult(result);
	} catch (error) {
		if (error?.name === 'AbortError' || error instanceof NyquistRuntimeError || error instanceof TypeError || error instanceof RangeError) {
			throw error;
		}
		throw new NyquistRuntimeError(error instanceof Error ? error.message : String(error), {
			code: 'NYQUIST_WASM_TRAP',
			cause: error,
		});
	} finally {
		if (sourcePointer) exports.nyq_free(sourcePointer);
		exports.nyq_destroy(handle);
	}
}

function copyInputAudio(channels, handle, exports, memory) {
	const frames = channels[0]?.length || 0;
	for (let channel = 0; channel < channels.length; channel += 1) {
		const pointer = exports.nyq_input_pointer(handle, channel);
		if (frames > 0 && !pointer) {
			throw new NyquistRuntimeError(`Nyquist returned a null input pointer for channel ${channel}.`, {
				code: 'NYQUIST_INVALID_POINTER',
			});
		}
		assertMemoryRange(memory, pointer, frames * Float32Array.BYTES_PER_ELEMENT, `Nyquist input channel ${channel}`);
		if (pointer % Float32Array.BYTES_PER_ELEMENT !== 0) {
			throw new NyquistRuntimeError(`Nyquist returned a misaligned input pointer for channel ${channel}.`, {
				code: 'NYQUIST_INVALID_POINTER',
			});
		}
		if (frames > 0) new Float32Array(memory.buffer, pointer, frames).set(channels[channel]);
	}
}

function readAudioResult(handle, exports, memory, sampleRate, maximumFrames, output) {
	const channelCount = exports.nyq_audio_channels(handle);
	const frameCount = exports.nyq_audio_frames(handle);
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > NYQUIST_MAX_CHANNELS) {
		throw new NyquistRuntimeError('Nyquist returned an invalid audio channel count.', { code: 'NYQUIST_INVALID_RESULT', output });
	}
	if (!Number.isSafeInteger(frameCount) || frameCount < 0 || frameCount > maximumFrames) {
		throw new NyquistRuntimeError('Nyquist audio exceeded its bounded output length.', { code: 'NYQUIST_OUTPUT_LIMIT', output });
	}
	if (frameCount * channelCount > NYQUIST_MAX_TOTAL_AUDIO_SAMPLES) {
		throw new NyquistRuntimeError('Nyquist audio exceeded its output memory limit.', { code: 'NYQUIST_OUTPUT_LIMIT', output });
	}
	const channels = Array.from({ length: channelCount }, (_, channel) => {
		const pointer = exports.nyq_audio_pointer(handle, channel);
		if (frameCount > 0 && !pointer) {
			throw new NyquistRuntimeError(`Nyquist returned a null output pointer for channel ${channel}.`, {
				code: 'NYQUIST_INVALID_POINTER',
				output,
			});
		}
		assertMemoryRange(memory, pointer, frameCount * Float32Array.BYTES_PER_ELEMENT, `Nyquist output channel ${channel}`);
		if (pointer % Float32Array.BYTES_PER_ELEMENT !== 0) {
			throw new NyquistRuntimeError(`Nyquist returned a misaligned output pointer for channel ${channel}.`, {
				code: 'NYQUIST_INVALID_POINTER',
				output,
			});
		}
		return new Float32Array(new Float32Array(memory.buffer, pointer, frameCount));
	});
	return normalizeNyquistResult({ type: 'audio', channels, sampleRate, frameCount, output });
}

function readLabelResult(handle, exports, memory, output) {
	const count = exports.nyq_label_count(handle);
	if (!Number.isInteger(count) || count < 0 || count > 65_536) {
		throw new NyquistRuntimeError('Nyquist returned an invalid label count.', { code: 'NYQUIST_INVALID_RESULT', output });
	}
	const labels = [];
	let remainingTextBytes = NYQUIST_MAX_TEXT_BYTES;
	for (let index = 0; index < count; index += 1) {
		const text = readCString(
			memory,
			exports.nyq_label_text(handle, index),
			`Nyquist aggregate label text at label ${index}`,
			true,
			remainingTextBytes,
		);
		const textBytes = encoder.encode(text).byteLength;
		if (textBytes > remainingTextBytes) {
			throw new NyquistRuntimeError('Nyquist aggregate label text exceeded its output size limit.', {
				code: 'NYQUIST_OUTPUT_LIMIT',
				output,
			});
		}
		remainingTextBytes -= textBytes;
		labels.push({
			start: exports.nyq_label_start(handle, index),
			end: exports.nyq_label_end(handle, index),
			text,
		});
	}
	return normalizeNyquistResult({ type: 'labels', labels, output });
}

function throwEvaluationError(handle, exports, memory, output, code = 'NYQUIST_EVALUATION_FAILED') {
	const detail = readCString(memory, exports.nyq_error(handle), 'Nyquist error', true);
	const finalOutput = readCString(memory, exports.nyq_output(handle), 'Nyquist output', true) || output;
	throw new NyquistRuntimeError(detail || 'Nyquist evaluation failed.', { code, output: finalOutput });
}

async function compileModule(source) {
	if (source instanceof WebAssembly.Module) return source;
	if (source instanceof ArrayBuffer) return WebAssembly.compile(source);
	if (ArrayBuffer.isView(source)) {
		return WebAssembly.compile(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
	}
	let response;
	try {
		response = source instanceof Response ? source : await fetch(source);
	} catch (error) {
		throw new NyquistRuntimeError('Unable to load Nyquist WebAssembly.', {
			code: 'NYQUIST_WASM_UNAVAILABLE',
			cause: error,
		});
	}
	if (!response.ok) throw new NyquistRuntimeError(
		`Unable to load Nyquist WASM (${response.status} ${response.statusText}).`,
		{ code: 'NYQUIST_WASM_UNAVAILABLE' },
	);
	try {
		return await WebAssembly.compile(await response.arrayBuffer());
	} catch (error) {
		throw new NyquistRuntimeError('Unable to compile Nyquist WebAssembly.', {
			code: 'NYQUIST_WASM_UNAVAILABLE',
			cause: error,
		});
	}
}

function createImports(module, state) {
	const implementations = createImportImplementations(state);
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		if (descriptor.kind !== 'function') {
			throw new NyquistRuntimeError(
				`Nyquist WASM has forbidden ${descriptor.kind} import ${descriptor.module}.${descriptor.name}.`,
				{ code: 'NYQUIST_FORBIDDEN_IMPORT' },
			);
		}
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = implementations[key];
		if (!implementation) {
			throw new NyquistRuntimeError(`Nyquist WASM has unexpected import ${key}.`, {
				code: 'NYQUIST_FORBIDDEN_IMPORT',
			});
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = implementation;
	}
	return imports;
}

function createImportImplementations(state) {
	const noSystemCall = () => WASI_NOSYS;
	return {
		'env.abort': () => { throw new NyquistRuntimeError('Nyquist WebAssembly aborted.', { code: 'NYQUIST_WASM_ABORT' }); },
		'env._tzset_js': (timezone, daylight, standardName, daylightName) => setUtcTimezone(
			state, timezone, daylight, standardName, daylightName,
		),
		'env.emscripten_notify_memory_growth': () => {},
		'env.emscripten_resize_heap': () => 0,
		'env.emscripten_memcpy_big': (destination, source, length) => {
			const memory = requireImportMemory(state);
			assertMemoryRange(memory, source, length, 'Nyquist memcpy source');
			assertMemoryRange(memory, destination, length, 'Nyquist memcpy destination');
			new Uint8Array(memory.buffer).copyWithin(destination, source, source + length);
			return destination;
		},
		'env.setTempRet0': () => {},
		'wasi_snapshot_preview1.args_get': () => WASI_SUCCESS,
		'wasi_snapshot_preview1.args_sizes_get': (argc, bytes) => writeEmptySizes(state, argc, bytes),
		'wasi_snapshot_preview1.clock_time_get': (clock, precision, result) => writeClock(state, result),
		'wasi_snapshot_preview1.environ_get': () => WASI_SUCCESS,
		'wasi_snapshot_preview1.environ_sizes_get': (count, bytes) => writeEmptySizes(state, count, bytes),
		'wasi_snapshot_preview1.fd_close': () => WASI_BADF,
		'wasi_snapshot_preview1.fd_fdstat_get': () => WASI_BADF,
		'wasi_snapshot_preview1.fd_read': () => WASI_BADF,
		'wasi_snapshot_preview1.fd_seek': () => WASI_BADF,
		'wasi_snapshot_preview1.fd_write': (descriptor, vectors, vectorCount, written) => writeDiscardedOutput(state, descriptor, vectors, vectorCount, written),
		'wasi_snapshot_preview1.poll_oneoff': noSystemCall,
		'wasi_snapshot_preview1.proc_exit': (code) => {
			throw new NyquistRuntimeError(`Nyquist WebAssembly exited with code ${code}.`, { code: 'NYQUIST_WASM_EXIT' });
		},
		'wasi_snapshot_preview1.random_get': (pointer, length) => fillRandom(state, pointer, length),
	};
}

function setUtcTimezone(state, timezone, daylight, standardName, daylightName) {
	const memory = requireImportMemory(state);
	writeUint32(memory, timezone, 0);
	writeUint32(memory, daylight, 0);
	for (const pointer of [standardName, daylightName]) {
		assertMemoryRange(memory, pointer, 17, 'WASI timezone name');
		const target = new Uint8Array(memory.buffer, pointer, 17);
		target.fill(0);
		target.set([0x55, 0x54, 0x43]);
	}
}

function writeEmptySizes(state, first, second) {
	try {
		const memory = requireImportMemory(state);
		writeUint32(memory, first, 0);
		writeUint32(memory, second, 0);
		return WASI_SUCCESS;
	} catch {
		return WASI_FAULT;
	}
}

function writeClock(state, pointer) {
	try {
		const memory = requireImportMemory(state);
		assertMemoryRange(memory, pointer, 8, 'WASI clock result');
		new DataView(memory.buffer).setBigUint64(pointer, BigInt(Date.now()) * 1_000_000n, true);
		return WASI_SUCCESS;
	} catch {
		return WASI_FAULT;
	}
}

function writeDiscardedOutput(state, descriptor, vectors, vectorCount, written) {
	if (descriptor !== 1 && descriptor !== 2) return WASI_BADF;
	try {
		const memory = requireImportMemory(state);
		const view = new DataView(memory.buffer);
		assertMemoryRange(memory, vectors, vectorCount * 8, 'WASI output vectors');
		let byteLength = 0;
		for (let index = 0; index < vectorCount; index += 1) byteLength += view.getUint32(vectors + index * 8 + 4, true);
		writeUint32(memory, written, byteLength);
		return WASI_SUCCESS;
	} catch {
		return WASI_FAULT;
	}
}

function fillRandom(state, pointer, length) {
	try {
		const memory = requireImportMemory(state);
		assertMemoryRange(memory, pointer, length, 'WASI random buffer');
		const target = new Uint8Array(memory.buffer, pointer, length);
		if (globalThis.crypto?.getRandomValues) {
			for (let offset = 0; offset < target.length; offset += 65_536) {
				globalThis.crypto.getRandomValues(target.subarray(offset, Math.min(target.length, offset + 65_536)));
			}
		} else {
			for (let index = 0; index < target.length; index += 1) target[index] = (index * 29 + 17) & 0xff;
		}
		return WASI_SUCCESS;
	} catch {
		return WASI_FAULT;
	}
}

function requireImportMemory(state) {
	if (!(state.memory instanceof WebAssembly.Memory)) throw new Error('Nyquist WASM memory is unavailable.');
	return state.memory;
}

function writeUint32(memory, pointer, value) {
	assertMemoryRange(memory, pointer, 4, 'WASI integer result');
	new DataView(memory.buffer).setUint32(pointer, value, true);
}

function normalizeExports(exports) {
	const normalized = { memory: exports.memory };
	for (const name of NYQUIST_REQUIRED_EXPORTS.slice(1)) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') {
			throw new NyquistRuntimeError(`Nyquist WASM is missing export ${name}.`, {
				code: 'NYQUIST_MISSING_EXPORT',
			});
		}
		normalized[name] = value;
	}
	if (!(normalized.memory instanceof WebAssembly.Memory)) {
		throw new NyquistRuntimeError('Nyquist WASM is missing its exported memory.', {
			code: 'NYQUIST_MISSING_EXPORT',
		});
	}
	return normalized;
}

function writeBytes(memory, pointer, bytes, label) {
	assertMemoryRange(memory, pointer, bytes.byteLength + 1, label);
	new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
}

function readCString(memory, pointer, label, allowNull, maximumBytes = NYQUIST_MAX_TEXT_BYTES) {
	if (!pointer && allowNull) return '';
	if (!pointer) throw new NyquistRuntimeError(`${label} pointer is null.`, { code: 'NYQUIST_INVALID_POINTER' });
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > NYQUIST_MAX_TEXT_BYTES) {
		throw new NyquistRuntimeError(`${label} has an invalid size limit.`, { code: 'NYQUIST_OUTPUT_LIMIT' });
	}
	assertMemoryRange(memory, pointer, 1, label);
	const maximum = Math.min(maximumBytes + 1, memory.buffer.byteLength - pointer);
	const bytes = new Uint8Array(memory.buffer, pointer, maximum);
	const end = bytes.indexOf(0);
	if (end < 0) throw new NyquistRuntimeError(`${label} is not terminated within its size limit.`, { code: 'NYQUIST_OUTPUT_LIMIT' });
	return decoder.decode(bytes.subarray(0, end));
}

function assertMemoryRange(memory, pointer, byteLength, label) {
	if (!Number.isSafeInteger(pointer) || pointer < 0 || !Number.isSafeInteger(byteLength) || byteLength < 0
		|| pointer + byteLength > memory.buffer.byteLength) {
		throw new NyquistRuntimeError(`${label} points outside Nyquist WASM memory.`, {
			code: 'NYQUIST_INVALID_POINTER',
		});
	}
}

function assertMemorySize(memory) {
	if (!(memory instanceof WebAssembly.Memory) || memory.buffer.byteLength > MAX_WASM_MEMORY_BYTES) {
		throw new NyquistRuntimeError('Nyquist WASM exceeded its memory limit.', { code: 'NYQUIST_MEMORY_LIMIT' });
	}
}

function throwIfCancelled(isCancelled) {
	if (!isCancelled()) return;
	const error = new Error('Nyquist evaluation was cancelled.');
	error.name = 'AbortError';
	throw error;
}
