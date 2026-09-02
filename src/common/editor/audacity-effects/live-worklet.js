/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Stateful AudioWorklet wrapper for the Audacity 3.7.7 live effect subset.
 */

import { createAudacityLiveProcessor } from './live.js';
import { initializePffft, isPffftReady } from '../pffft.js';

export const AUDACITY_LIVE_WORKLET_NAME = 'kw-audacity-live-effect';

/**
 * How often a self-describing effect reports what it is doing.
 *
 * The display refreshes on animation frames, so anything faster is discarded
 * before it is drawn while still costing a structured-clone per render quantum.
 */
export const AUDACITY_LIVE_ANALYSIS_INTERVAL_SECONDS = 1 / 60;

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() {
		this.port = { postMessage() {}, onmessage: null, start() {} };
	}
};

export class AudacityLiveEffectProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		const sampleRate = Number(settings.sampleRate ?? globalThis.sampleRate ?? 48_000);
		this.effectType = settings.effectType;
		this.sampleRate = sampleRate;
		this.processor = null;
		this.analysisWindow = null;
		this.analysisSequence = 0;
		this.analysisFramesPerReport = Math.max(1, Math.round(
			sampleRate * AUDACITY_LIVE_ANALYSIS_INTERVAL_SECONDS,
		));
		this.pendingMessages = [];
		this.lastError = null;
		this.port.onmessage = (event) => this.#handleMessage(event.data || {});
		this.port.start?.();
		const initialize = () => {
			this.processor = createAudacityLiveProcessor(
				this.effectType,
				sampleRate,
				settings.params || {},
				{ noiseProfile: settings.noiseProfile },
			);
			for (const message of this.pendingMessages.splice(0)) this.#handleMessage(message);
			this.#postStatus('ready');
		};
		const fail = (error) => {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.port.postMessage({ type: 'error', effectType: this.effectType, message: this.lastError });
		};
		if (isPffftReady()) {
			try { initialize(); } catch (error) { fail(error); }
		} else {
			if (!(settings.pffftWasmModule instanceof WebAssembly.Module)) {
				fail(new TypeError('The Audacity worklet requires a precompiled PFFFT WebAssembly.Module.'));
				return;
			}
			initializePffft({ wasmModule: settings.pffftWasmModule }).then(initialize).catch(fail);
		}
	}

	process(inputs, outputs) {
		const output = outputs[0] || [];
		if (!this.processor) {
			for (const channel of output) channel.fill(0);
			return true;
		}
		try {
			this.processor.process(inputs[0] || [], output, inputs[1] || []);
			this.lastError = null;
			this.#reportAnalysis();
			return true;
		} catch (error) {
			for (const channel of output) channel.fill(0);
			const message = error instanceof Error ? error.message : String(error);
			if (message !== this.lastError) {
				this.lastError = message;
				this.port.postMessage({ type: 'error', effectType: this.effectType, message });
			}
			return true;
		}
	}

	#handleMessage(message) {
		if (!this.processor) {
			this.pendingMessages.push(message);
			return;
		}
		try {
			if (message.type === 'params') this.processor.updateParams(message.params || {});
			else if (message.type === 'noise-profile') this.processor.setNoiseProfile(message.profile);
			else if (message.type === 'reset') { this.processor.reset(); this.analysisWindow = null; }
			else return;
			this.lastError = null;
			this.#postStatus(message.type === 'reset' ? 'reset' : 'updated');
		} catch (error) {
			this.port.postMessage({
				type: 'error',
				effectType: this.effectType,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	#reportAnalysis() {
		const analysis = this.processor.readAnalysis?.();
		if (!analysis) return;
		const window = this.analysisWindow ?? {
			frames: 0, inputPeak: 0, outputPeak: 0, reductionDb: 0,
		};
		window.frames += analysis.frames;
		if (analysis.inputPeak > window.inputPeak) window.inputPeak = analysis.inputPeak;
		if (analysis.outputPeak > window.outputPeak) window.outputPeak = analysis.outputPeak;
		if (analysis.reductionDb < window.reductionDb) window.reductionDb = analysis.reductionDb;
		if (window.frames < this.analysisFramesPerReport) {
			this.analysisWindow = window;
			return;
		}
		this.analysisWindow = null;
		this.analysisSequence += 1;
		this.port.postMessage({
			type: 'analysis',
			sequence: this.analysisSequence,
			effectType: this.effectType,
			frames: window.frames,
			seconds: window.frames / this.sampleRate,
			inputPeak: window.inputPeak,
			outputPeak: window.outputPeak,
			reductionDb: window.reductionDb,
		});
	}

	#postStatus(status) {
		this.port.postMessage({
			type: 'status',
			status,
			effectType: this.effectType,
			latencyFrames: this.processor.latencyFrames,
			tailFrames: this.processor.tailFrames,
		});
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(AUDACITY_LIVE_WORKLET_NAME, AudacityLiveEffectProcessor);
}
