export const DELAY_PROCESSOR_NAME = 'kw-audio-delay';

const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_MAXIMUM_SECONDS = 5;

/**
 * A sample-accurate feedback delay.
 *
 * DelayNode feedback cycles are processed one render quantum at a time. That
 * adds 128 frames to every repeat in Chromium. Keeping the feedback path
 * inside one processor makes each repeat land at the requested frame instead.
 */
export class DelayProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		this.sampleRate = positiveNumber(settings.sampleRate, positiveNumber(globalThis.sampleRate, DEFAULT_SAMPLE_RATE));
		this.maximumSeconds = clamp(
			positiveNumber(settings.maximumSeconds, DEFAULT_MAXIMUM_SECONDS),
			1 / this.sampleRate,
			DEFAULT_MAXIMUM_SECONDS,
		);
		this.maximumDelayFrames = Math.max(1, Math.ceil(this.maximumSeconds * this.sampleRate));
		this.ringLength = this.maximumDelayFrames + 1;
		this.rings = [];
		this.writeIndex = 0;
		this.configure(settings.params);
		if (this.port) {
			this.port.onmessage = ({ data } = {}) => {
				if (data?.type === 'configure') this.configure(data.params);
				else if (data?.type === 'reset') this.reset();
			};
		}
	}

	configure(params = {}) {
		const next = params && typeof params === 'object' ? params : {};
		this.params = { ...(this.params || {}), ...next };
		const delaySeconds = clamp(
			finite(this.params.time ?? this.params.delayTime, 0.25),
			1 / this.sampleRate,
			this.maximumSeconds,
		);
		this.delayFrames = clamp(
			Math.round(delaySeconds * this.sampleRate),
			1,
			this.maximumDelayFrames,
		);
		this.feedback = clamp(finite(this.params.feedback, 0.25), 0, 0.95);
		this.mix = clamp(finite(this.params.mix, 0.25), 0, 1);
	}

	reset() {
		for (const ring of this.rings) ring.fill(0);
		this.writeIndex = 0;
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		const frames = output[0]?.length || 0;
		while (this.rings.length < output.length) this.rings.push(new Float32Array(this.ringLength));
		for (let frame = 0; frame < frames; frame += 1) {
			const readIndex = (this.writeIndex - this.delayFrames + this.ringLength) % this.ringLength;
			for (let channel = 0; channel < output.length; channel += 1) {
				const source = input[channel] || input[0];
				const dry = source?.[frame] || 0;
				const delayed = this.rings[channel][readIndex];
				this.rings[channel][this.writeIndex] = dry + delayed * this.feedback;
				output[channel][frame] = dry * (1 - this.mix) + delayed * this.mix;
			}
			this.writeIndex = (this.writeIndex + 1) % this.ringLength;
		}
		return true;
	}
}

function positiveNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finite(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(DELAY_PROCESSOR_NAME, DelayProcessor);
}
