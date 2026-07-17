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
		const frames = input[0]?.length || output[0]?.length || 128;
		const channels = Array.from({ length: this.channelCount }, (_, channelIndex) => {
			const source = input[Math.min(channelIndex, Math.max(0, input.length - 1))];
			const values = new Float32Array(frames);
			if (source) {
				for (let frame = 0; frame < frames; frame += 1) {
					values[frame] = (source[frame] || 0) * this.inputGain;
				}
			}
			return values;
		});
		for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
			const target = output[channelIndex];
			if (!this.passthrough) {
				target.fill(0);
				continue;
			}
			const source = channels[Math.min(channelIndex, channels.length - 1)];
			target.set(source.subarray(0, target.length));
		}
		this.meter.push(channels, (meter) => this.port.postMessage({ type: 'meter', meter }));
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
