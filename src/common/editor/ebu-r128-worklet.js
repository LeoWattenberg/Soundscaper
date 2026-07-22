import { createEbuR128Meter } from './ebu-r128.js';

export const EBU_R128_WORKLET_NAME = 'kw-ebu-r128-meter';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() {
		this.port = { postMessage() {}, onmessage: null, start() {} };
	}
};

export class EbuR128MeterProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		this.channelCount = Math.max(1, Math.min(8, Math.floor(settings.channelCount || 2)));
		this.passthrough = settings.passthrough !== false;
		this.inputGain = normalizeGain(settings.inputGain, 1);
		this.channels = Array.from({ length: this.channelCount });
		this.publishMeter = (meter) => this.port.postMessage({ type: 'meter', meter });
		this.meter = createEbuR128Meter({
			sampleRate: Number(settings.sampleRate || globalThis.sampleRate || 48_000),
			channelCount: this.channelCount,
			channelWeights: settings.channelWeights,
			running: settings.running,
		});
		this.port.onmessage = (event) => this.#handleMessage(event.data || {});
		this.port.start?.();
		this.port.postMessage({ type: 'ready', meter: this.meter.snapshot() });
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		if (!input.length || !input[0]?.length) {
			for (const target of output) target.fill(0);
			return true;
		}
		for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
			this.channels[channelIndex] = input[Math.min(channelIndex, input.length - 1)];
		}
		for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
			const target = output[channelIndex];
			if (!this.passthrough) {
				target.fill(0);
				continue;
			}
			const source = this.channels[Math.min(channelIndex, this.channels.length - 1)];
			if (this.inputGain === 1) {
				target.set(source.length === target.length ? source : source.subarray(0, target.length));
			} else {
				for (let frame = 0; frame < target.length; frame += 1) {
					target[frame] = (source[frame] || 0) * this.inputGain;
				}
			}
		}
		this.meter.push(
			this.channels,
			this.publishMeter,
			this.inputGain,
		);
		return true;
	}

	#handleMessage(message) {
		if (message.type === 'running') this.meter.setRunning(message.running);
		else if (message.type === 'reset') this.meter.reset();
		else if (message.type === 'input-gain') this.inputGain = normalizeGain(message.value, this.inputGain);
		else if (message.type !== 'snapshot') return;
		this.port.postMessage({ type: 'meter', meter: this.meter.snapshot() });
	}
}

function normalizeGain(value, fallback) {
	return Number.isFinite(value) ? Math.max(0, Math.min(2, Number(value))) : fallback;
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(EBU_R128_WORKLET_NAME, EbuR128MeterProcessor);
}
