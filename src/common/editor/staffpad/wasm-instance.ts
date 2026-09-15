/* SPDX-License-Identifier: AGPL-3.0-only */

import { STAFFPAD_WASM_ABI_VERSION, STAFFPAD_MAXIMUM_BLOCK_FRAMES } from './parameters.js';

interface StaffPadExports {
	readonly memory: WebAssembly.Memory;
	_initialize(): void;
	sp_abi_version(): number;
	sp_maximum_block_size(): number;
	sp_create(rate: number, channels: number, preserve: number): number;
	sp_destroy(handle: number): void;
	sp_reset(handle: number): number;
	sp_fft_size(handle: number): number;
	sp_set_parameters(handle: number, time: number, pitch: number): number;
	sp_required_input(handle: number): number;
	sp_available_output(handle: number): number;
	sp_latency(handle: number, stretch: number): number;
	sp_input_pointer(handle: number, channel: number): number;
	sp_output_pointer(handle: number, channel: number): number;
	sp_feed(handle: number, frames: number): number;
	sp_read(handle: number, frames: number): number;
}

export const STAFFPAD_REQUIRED_EXPORTS = Object.freeze([
	'memory',
	'_initialize',
	'sp_abi_version',
	'sp_maximum_block_size',
	'sp_create',
	'sp_destroy',
	'sp_reset',
	'sp_fft_size',
	'sp_set_parameters',
	'sp_required_input',
	'sp_available_output',
	'sp_latency',
	'sp_input_pointer',
	'sp_output_pointer',
	'sp_feed',
	'sp_read',
]);

const ALLOWED_FUNCTION_IMPORTS: Readonly<Record<string, (...args: number[]) => number | void>> = Object.freeze({
	'env.emscripten_notify_memory_growth': () => {},
	'env.abort': () => { throw new Error('StaffPad WebAssembly aborted.'); },
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.proc_exit': (code: number) => { throw new Error(`StaffPad WebAssembly exited with code ${code}.`); },
});

export class StaffPadWasmRuntime {
	readonly instance: WebAssembly.Instance;
	readonly exports: StaffPadExports;
	readonly memory: WebAssembly.Memory;
	readonly maximumBlockSize: number;
	constructor(instance: WebAssembly.Instance) {
		if (!(instance instanceof WebAssembly.Instance)) throw new TypeError('A WebAssembly.Instance is required.');
		this.instance = instance;
		this.exports = normalizeExports(instance.exports);
		this.memory = this.exports.memory;
		this.exports._initialize();
		const abiVersion = this.exports.sp_abi_version();
		if (abiVersion !== STAFFPAD_WASM_ABI_VERSION) {
			throw new Error(`Unsupported StaffPad WASM ABI ${abiVersion}; expected ${STAFFPAD_WASM_ABI_VERSION}.`);
		}
		this.maximumBlockSize = this.exports.sp_maximum_block_size();
		if (!Number.isInteger(this.maximumBlockSize) || this.maximumBlockSize < 1 || this.maximumBlockSize > STAFFPAD_MAXIMUM_BLOCK_FRAMES) {
			throw new Error('StaffPad WASM reported an invalid maximum block size.');
		}
	}

	createSession(sampleRate: number, channelCount: number, preserveFormants: boolean) {
		const handle = this.exports.sp_create(sampleRate, channelCount, preserveFormants ? 1 : 0);
		if (!handle) throw new Error('StaffPad could not allocate a processing session.');
		try {
			return new StaffPadWasmSession(this, handle, channelCount);
		} catch (error) {
			this.exports.sp_destroy(handle);
			throw error;
		}
	}
}

class StaffPadWasmSession {
	readonly runtime: StaffPadWasmRuntime;
	handle: number;
	readonly channelCount: number;
	readonly inputPointers: number[];
	readonly outputPointers: number[];
	constructor(runtime: StaffPadWasmRuntime, handle: number, channelCount: number) {
		this.runtime = runtime;
		this.handle = handle;
		this.channelCount = channelCount;
		this.inputPointers = Array.from({ length: channelCount }, (_, channel) => {
			const pointer = runtime.exports.sp_input_pointer(handle, channel);
			if (!pointer) throw new Error(`StaffPad returned a null input pointer for channel ${channel}.`);
			return pointer;
		});
		this.outputPointers = Array.from({ length: channelCount }, (_, channel) => {
			const pointer = runtime.exports.sp_output_pointer(handle, channel);
			if (!pointer) throw new Error(`StaffPad returned a null output pointer for channel ${channel}.`);
			return pointer;
		});
	}

	setParameters(timeRatio: number, pitchRatio: number) {
		if (this.runtime.exports.sp_set_parameters(this.handle, timeRatio, pitchRatio) !== 0) {
			throw new RangeError('StaffPad rejected the time or pitch ratio.');
		}
	}

	latency(combinedStretchRatio: number) {
		const frames = this.runtime.exports.sp_latency(this.handle, combinedStretchRatio);
		if (frames < 0) throw new RangeError('StaffPad rejected the latency stretch ratio.');
		return frames;
	}

	requiredInput() {
		return this.runtime.exports.sp_required_input(this.handle);
	}

	availableOutput() {
		return this.runtime.exports.sp_available_output(this.handle);
	}

	feed(channels: readonly Float32Array[], sourceOffset: number, frames: number) {
		for (let channel = 0; channel < this.channelCount; channel += 1) {
			const target = new Float32Array(
				this.runtime.memory.buffer,
				this.inputPointers[channel],
				this.runtime.maximumBlockSize,
			);
			target.fill(0, 0, frames);
			const available = Math.max(0, Math.min(frames, channels[channel].length - sourceOffset));
			if (available > 0) target.set(channels[channel].subarray(sourceOffset, sourceOffset + available), 0);
		}
		if (this.runtime.exports.sp_feed(this.handle, frames) !== frames) {
			throw new Error('StaffPad rejected an input block.');
		}
	}

	read(frames: number) {
		if (this.runtime.exports.sp_read(this.handle, frames) !== frames) {
			throw new Error('StaffPad rejected an output block.');
		}
		return this.outputPointers.map((pointer) => new Float32Array(
			new Float32Array(this.runtime.memory.buffer, pointer, frames),
		));
	}

	destroy() {
		if (!this.handle) return;
		this.runtime.exports.sp_destroy(this.handle);
		this.handle = 0;
	}
}

/** A compiled module can be cloned into an AudioWorklet without fetching there. */
/** @param {WebAssembly.Module} module */
export function instantiateStaffPadWasm(module: WebAssembly.Module) {
	return new StaffPadWasmRuntime(new WebAssembly.Instance(module, createImports(module)));
}

function createImports(module: WebAssembly.Module) {
	const imports: Record<string, Record<string, (...args: number[]) => number | void>> = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		if (descriptor.kind !== 'function') {
			throw new Error(`StaffPad WASM has forbidden ${descriptor.kind} import ${descriptor.module}.${descriptor.name}.`);
		}
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_FUNCTION_IMPORTS[key];
		if (!implementation) throw new Error(`StaffPad WASM has unexpected import ${key}.`);
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = implementation;
	}
	return imports;
}

function normalizeExports(exports: WebAssembly.Exports): StaffPadExports {
	if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error('StaffPad WASM must export memory.');
	const normalized: Record<string, WebAssembly.ExportValue> = { memory: exports.memory };
	for (const name of STAFFPAD_REQUIRED_EXPORTS.slice(1)) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') throw new Error(`StaffPad WASM is missing export ${name}.`);
		normalized[name] = value;
	}
	if (!(normalized.memory instanceof WebAssembly.Memory)) throw new Error('StaffPad WASM is missing its exported memory.');
	return normalized as unknown as StaffPadExports;
}
