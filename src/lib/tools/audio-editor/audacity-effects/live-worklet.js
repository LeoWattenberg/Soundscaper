/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Stateful AudioWorklet wrapper for the Audacity 3.7.7 live effect subset.
 */

import { createAudacityLiveProcessor } from './live.js';
import { initializePffft } from '../pffft.js';

export const AUDACITY_LIVE_WORKLET_NAME = 'kw-audacity-live-effect';

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
		this.processor = null;
		this.pendingMessages = [];
		this.lastError = null;
		this.port.onmessage = (event) => this.#handleMessage(event.data || {});
		this.port.start?.();
		initializePffft().then(() => {
			this.processor = createAudacityLiveProcessor(
				this.effectType,
				sampleRate,
				settings.params || {},
				{ noiseProfile: settings.noiseProfile },
			);
			for (const message of this.pendingMessages.splice(0)) this.#handleMessage(message);
			this.#postStatus('ready');
		}).catch((error) => {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.port.postMessage({ type: 'error', effectType: this.effectType, message: this.lastError });
		});
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
			else if (message.type === 'reset') this.processor.reset();
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
