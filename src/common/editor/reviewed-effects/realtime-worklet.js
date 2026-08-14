/* SPDX-License-Identifier: AGPL-3.0-only */

const PROCESSOR_NAME = 'soundscaper-reviewed-effect-v1';
const ABI_VERSION = 1;
const MEMORY_PAGE_BYTES = 65_536;
const APPROVED_PACKAGES = Object.freeze({
	'org.soundscaper.utility-gain@1.0.0': Object.freeze({
		maximumChannels: 2,
		maximumBlockFrames: 2_048,
		maximumMemoryPages: 1,
		parameters: Object.freeze([
			Object.freeze({ minimum: 0, maximum: 4, defaultValue: 1 }),
		]),
	}),
});

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() {
		this.port = { postMessage() {}, onmessage: null, start() {} };
	}
};

export class ReviewedEffectWorkletProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		const policy = Object.hasOwn(APPROVED_PACKAGES, settings.packageKey)
			? APPROVED_PACKAGES[settings.packageKey]
			: null;
		if (!policy || settings.abiVersion !== ABI_VERSION) {
			throw new Error('The reviewed effect package is not realtime-approved by this release.');
		}
		if (!(settings.wasmModule instanceof WebAssembly.Module)) {
			throw new TypeError('The reviewed effect worklet requires a precompiled WebAssembly.Module.');
		}
		validateModule(settings.wasmModule);
		this.channelCount = boundedInteger(settings.channelCount, 1, policy.maximumChannels, 'channel count');
		this.policy = policy;
		this.parameterValues = normalizeParameters(settings.parameterValues, policy.parameters);
		this.instance = new WebAssembly.Instance(settings.wasmModule, {});
		this.memory = this.instance.exports.memory;
		this.processEffect = this.instance.exports.soundscaper_effect_process;
		if (!(this.memory instanceof WebAssembly.Memory)
			|| !(this.instance.exports.soundscaper_effect_abi_version instanceof WebAssembly.Global)
			|| this.instance.exports.soundscaper_effect_abi_version.value !== ABI_VERSION
			|| !(this.instance.exports.soundscaper_effect_latency_frames instanceof WebAssembly.Global)
			|| this.instance.exports.soundscaper_effect_latency_frames.value !== 0
			|| !(this.instance.exports.soundscaper_effect_tail_frames instanceof WebAssembly.Global)
			|| this.instance.exports.soundscaper_effect_tail_frames.value !== 0
			|| typeof this.processEffect !== 'function'
			|| this.processEffect.length !== 7
			|| this.memory.buffer.byteLength > policy.maximumMemoryPages * MEMORY_PAGE_BYTES) {
			throw new Error('The reviewed effect worklet module does not implement ABI v1.');
		}
		this.lastError = null;
		this.port.onmessage = (event) => this.#handleMessage(event.data);
		this.port.start?.();
		this.port.postMessage({ type: 'status', status: 'ready' });
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		if (output.length === 0) return true;
		try {
			this.#processBlock(input, output);
			this.lastError = null;
		} catch (error) {
			for (const channel of output) channel.fill(0);
			const message = error instanceof Error ? error.message : String(error);
			if (message !== this.lastError) {
				this.lastError = message;
				this.port.postMessage({ type: 'error', message });
			}
		}
		return true;
	}

	#processBlock(input, output) {
		if (output.length !== this.channelCount || input.length > this.channelCount) {
			throw new RangeError('Reviewed effect worklet channel shape is invalid.');
		}
		const frameCount = output[0]?.length || 0;
		if (frameCount < 1 || frameCount > this.policy.maximumBlockFrames
			|| output.some((channel) => channel.length !== frameCount)
			|| input.some((channel) => channel.length !== frameCount)) {
			throw new RangeError('Reviewed effect worklet block shape exceeds its package limit.');
		}
		const sampleCount = frameCount * this.channelCount;
		const inputBytes = sampleCount * Float32Array.BYTES_PER_ELEMENT;
		const outputPointer = inputBytes;
		const parameterPointer = outputPointer + inputBytes;
		const requiredBytes = parameterPointer + this.parameterValues.length * Float32Array.BYTES_PER_ELEMENT;
		if (requiredBytes > this.memory.buffer.byteLength
			|| this.memory.buffer.byteLength > this.policy.maximumMemoryPages * MEMORY_PAGE_BYTES) {
			throw new RangeError('Reviewed effect worklet memory exceeds its approved envelope.');
		}
		const wasmInput = new Float32Array(this.memory.buffer, 0, sampleCount);
		for (let channel = 0; channel < this.channelCount; channel += 1) {
			const offset = channel * frameCount;
			const source = input[channel];
			if (source) wasmInput.set(source, offset);
			else wasmInput.fill(0, offset, offset + frameCount);
		}
		new Float32Array(this.memory.buffer, parameterPointer, this.parameterValues.length)
			.set(this.parameterValues);
		const status = this.processEffect(
			0,
			outputPointer,
			frameCount,
			this.channelCount,
			Number(globalThis.sampleRate || 48_000),
			parameterPointer,
			this.parameterValues.length,
		);
		if (status !== 0) throw new Error(`Reviewed effect worklet returned status ${String(status)}.`);
		const wasmOutput = new Float32Array(this.memory.buffer, outputPointer, sampleCount);
		for (let channel = 0; channel < this.channelCount; channel += 1) {
			const rendered = wasmOutput.subarray(channel * frameCount, (channel + 1) * frameCount);
			if (rendered.some((sample) => !Number.isFinite(sample))) {
				throw new RangeError('Reviewed effect worklet returned non-finite audio.');
			}
			output[channel].set(rendered);
		}
	}

	#handleMessage(value) {
		try {
			if (!isClosedParameterMessage(value)) {
				throw new TypeError('Reviewed effect worklet received an invalid message.');
			}
			this.parameterValues = normalizeParameters(value.values, this.policy.parameters);
			this.port.postMessage({ type: 'status', status: 'configured' });
		} catch (error) {
			this.port.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function validateModule(module) {
	if (WebAssembly.Module.imports(module).length !== 0) {
		throw new Error('Reviewed effect worklet WASM imports are forbidden.');
	}
	const expected = new Map([
		['memory', 'memory'],
		['soundscaper_effect_abi_version', 'global'],
		['soundscaper_effect_latency_frames', 'global'],
		['soundscaper_effect_tail_frames', 'global'],
		['soundscaper_effect_process', 'function'],
	]);
	const exports = WebAssembly.Module.exports(module);
	if (exports.length !== expected.size
		|| exports.some(({ name, kind }) => expected.get(name) !== kind)) {
		throw new Error('Reviewed effect worklet WASM exports do not match the closed ABI.');
	}
}

function normalizeParameters(value, declarations) {
	if (!Array.isArray(value) || value.length !== declarations.length) {
		throw new RangeError('Reviewed effect worklet parameter count is invalid.');
	}
	return Float32Array.from(value.map((candidate, index) => {
		const declaration = declarations[index];
		const number = candidate === undefined ? declaration.defaultValue : candidate;
		if (typeof number !== 'number' || !Number.isFinite(number)
			|| number < declaration.minimum || number > declaration.maximum) {
			throw new RangeError('Reviewed effect worklet parameter is outside its approved range.');
		}
		return number;
	}));
}

function isClosedParameterMessage(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) return false;
	const keys = Reflect.ownKeys(value);
	return keys.length === 2 && keys.includes('type') && keys.includes('values')
		&& keys.every((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return typeof key === 'string' && descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
		}) && value.type === 'parameters';
}

function boundedInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`Reviewed effect worklet ${name} is invalid.`);
	}
	return number;
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(PROCESSOR_NAME, ReviewedEffectWorkletProcessor);
}
