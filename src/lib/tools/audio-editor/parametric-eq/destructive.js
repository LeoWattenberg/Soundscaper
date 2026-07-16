import {
	PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE,
	ParametricEqWasmRuntime,
} from './wasm-runtime.js';

/** Render planar PCM through the same fixed-memory f64 core used by AudioWorklet. */
export async function processParametricEqChannelsWasm(channels, sampleRate, params, options = {}) {
	if (!Array.isArray(channels) || !channels.length || channels.length > 32) {
		throw new RangeError('Parametric EQ destructive processing requires between one and 32 channels.');
	}
	const frames = channels[0]?.length;
	if (!Number.isSafeInteger(frames) || frames < 0
		|| channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
		throw new RangeError('Parametric EQ destructive channels must be equal-length Float32Array values.');
	}
	if (!(options.wasmModule instanceof WebAssembly.Module)) {
		throw new TypeError('Parametric EQ destructive processing requires a precompiled WebAssembly.Module.');
	}
	const module = options.wasmModule;
	const runtime = new ParametricEqWasmRuntime(module, {
		sampleRate,
		channelCount: channels.length,
	});
	runtime.configure(params, { mode: 'immediate', effectId: options.effectId });
	const output = channels.map(() => new Float32Array(frames));
	for (let offset = 0; offset < frames; offset += PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE) {
		const length = Math.min(PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE, frames - offset);
		runtime.process(
			channels.map((channel) => channel.subarray(offset, offset + length)),
			output.map((channel) => channel.subarray(offset, offset + length)),
			length,
		);
	}
	return output;
}
