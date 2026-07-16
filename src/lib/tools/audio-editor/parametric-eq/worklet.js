import {
	ParametricEqWasmRuntime,
	designParametricEqWasmConfiguration,
} from './wasm-runtime.js';
import { PARAMETRIC_EQ_WORKLET_NAME } from './protocol.js';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() {
		this.port = { postMessage() {}, onmessage: null, start() {} };
	}
};

export { PARAMETRIC_EQ_WORKLET_NAME };

export class ParametricEqWorkletProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		if (!(settings.wasmModule instanceof WebAssembly.Module)) {
			throw new TypeError('The parametric EQ worklet requires a precompiled WebAssembly.Module.');
		}
		this.wasmModule = settings.wasmModule;
		this.sampleRate = Number(settings.sampleRate ?? globalThis.sampleRate ?? 48_000);
		this.effectId = settings.effectId;
		this.revision = revisionOf(settings.revision, 0);
		this.params = settings.packet ?? settings.params;
		this.auditionBandId = null;
		this.configuration = designParametricEqWasmConfiguration(
			this.params,
			this.sampleRate,
			{ effectId: this.effectId },
		);
		this.channelCount = Number(settings.channelCount);
		this.runtime = new ParametricEqWasmRuntime(this.wasmModule, {
			sampleRate: this.sampleRate,
			channelCount: this.channelCount,
		});
		this.runtime.configureDesigned(this.configuration, {
			mode: 'immediate',
			transitionFrames: 0,
		});
		this.queuedConfiguration = null;
		this.fatalError = null;
		this.lastError = null;
		this.port.onmessage = (event) => this.#handleMessage(event.data || {});
		this.port.start?.();
		this.#postStatus('ready');
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		if (output.length === 0) return true;
		try {
			if (this.fatalError) throw this.fatalError;
			if (input.length > this.channelCount || output.length > this.channelCount) {
				this.fatalError = new RangeError(
					`Parametric EQ channel count exceeds its configured capacity of ${this.channelCount}.`,
				);
				throw this.fatalError;
			}
			this.#drainQueuedConfiguration();
			this.runtime.process(input, output);
			this.lastError = null;
			return true;
		} catch (error) {
			clearOutput(output);
			this.#postProcessingError(error);
			return true;
		}
	}

	#handleMessage(message) {
		const incomingRevision = revisionOf(message.revision ?? message.sequence, this.revision + 1);
		if (incomingRevision <= this.revision) return;
		try {
			if (this.fatalError) throw this.fatalError;
			if (message.type === 'configure' || message.type === 'params') {
				const params = message.packet ?? message.params;
				const auditionBandId = hasBand(params, this.auditionBandId)
					? this.auditionBandId
					: null;
				const configuration = designParametricEqWasmConfiguration(
					params,
					this.sampleRate,
					{ effectId: this.effectId, auditionBandId },
				);
				this.#applyOrQueueConfiguration(configuration, {
					mode: configurationMode(message.mode),
					transitionFrames: message.transitionFrames,
				});
				this.params = params;
				this.auditionBandId = auditionBandId;
				this.revision = incomingRevision;
				this.#postStatus('configured');
			} else if (message.type === 'audition') {
				const auditionBandId = auditionBandIdFromMessage(message, this.params);
				const configuration = designParametricEqWasmConfiguration(
					this.params,
					this.sampleRate,
					{ effectId: this.effectId, auditionBandId },
				);
				this.#applyOrQueueConfiguration(configuration, {
					mode: 'auto',
					transitionFrames: message.transitionFrames,
				});
				this.auditionBandId = auditionBandId;
				this.revision = incomingRevision;
				this.#postStatus('audition');
			} else if (message.type === 'reset') {
				this.queuedConfiguration = null;
				if (this.runtime) {
					this.runtime.reset();
					this.runtime.configureDesigned(this.configuration, {
						mode: 'immediate',
						transitionFrames: 0,
					});
				}
				this.revision = incomingRevision;
				this.#postStatus('reset');
			}
			this.lastError = null;
		} catch (error) {
			this.port.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : String(error),
				revision: incomingRevision,
				sequence: incomingRevision,
			});
		}
	}

	#applyOrQueueConfiguration(configuration, options) {
		const prepared = this.runtime.prepareDesignedConfiguration(configuration, options);
		if (this.runtime.transitioning) {
			this.queuedConfiguration = prepared;
			this.configuration = configuration;
			return;
		}
		this.runtime.commitPreparedConfiguration(prepared);
		this.configuration = configuration;
	}

	#drainQueuedConfiguration() {
		if (!this.queuedConfiguration || this.runtime.transitioning) return;
		const pending = this.queuedConfiguration;
		this.queuedConfiguration = null;
		this.runtime.commitPreparedConfiguration(pending);
	}

	#postProcessingError(error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === this.lastError) return;
		this.lastError = message;
		this.port.postMessage({
			type: 'error',
			message,
			revision: this.revision,
			sequence: this.revision,
		});
	}

	#postStatus(status) {
		this.port.postMessage({
			type: 'status',
			status,
			revision: this.revision,
			sequence: this.revision,
			latencyFrames: 0,
			tailFrames: 0,
		});
	}
}

function configurationMode(value) {
	if (value == null || value === 'smooth') return 'auto';
	if (value === 'initial') return 'immediate';
	if (value === 'immediate' || value === 'crossfade') return value;
	throw new RangeError('Parametric EQ configure mode must be initial, smooth, immediate, or crossfade.');
}

function hasBand(params, bandId) {
	if (bandId == null || !Array.isArray(params?.bands)) return false;
	return params.bands.some((band) => String(band?.id) === bandId);
}

function auditionBandIdFromMessage(message, params) {
	if (message.bandId != null) return String(message.bandId);
	if (message.bandIndex == null) return null;
	const index = Number(message.bandIndex);
	if (!Number.isSafeInteger(index) || index < 0 || index >= (params?.bands?.length || 0)) {
		throw new RangeError('Parametric EQ audition bandIndex is outside the configured band list.');
	}
	return String(params.bands[index].id);
}

function clearOutput(output) {
	for (const channel of output) channel.fill(0);
}

function revisionOf(value, fallback) {
	const revision = Number(value);
	return Number.isSafeInteger(revision) && revision >= 0 ? revision : fallback;
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(PARAMETRIC_EQ_WORKLET_NAME, ParametricEqWorkletProcessor);
}
