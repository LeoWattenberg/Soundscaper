const PROCESSOR_NAME = 'kw-audio-dynamics';

export class DynamicsProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		this.type = settings.type === 'limiter' ? 'limiter' : 'gate';
		this.params = settings.params || {};
		this.envelope = this.type === 'gate' ? dbToGain(this.params.rangeDb ?? -80) : 1;
		this.holdFrames = 0;
		this.lookaheadFrames = Math.max(0, Math.round((this.params.lookahead || 0) * globalThis.sampleRate));
		this.rings = [];
		this.writeIndex = 0;
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		if (this.type === 'limiter') this.processLimiter(input, output);
		else this.processGate(input, output);
		return true;
	}

	processGate(input, output) {
		const frames = output[0]?.length || 0;
		const threshold = dbToGain(this.params.threshold ?? -50);
		const closedGain = dbToGain(this.params.rangeDb ?? -80);
		const attack = coefficient(this.params.attack ?? 0.005);
		const release = coefficient(this.params.release ?? 0.1);
		const hold = Math.max(0, Math.round((this.params.hold || 0) * globalThis.sampleRate));
		for (let frame = 0; frame < frames; frame += 1) {
			let detector = 0;
			for (const channel of input) detector = Math.max(detector, Math.abs(channel[frame] || 0));
			if (detector >= threshold) this.holdFrames = hold;
			else if (this.holdFrames > 0) this.holdFrames -= 1;
			const target = detector >= threshold || this.holdFrames > 0 ? 1 : closedGain;
			const smoothing = target > this.envelope ? attack : release;
			this.envelope = target + smoothing * (this.envelope - target);
			for (let channel = 0; channel < output.length; channel += 1) output[channel][frame] = (input[channel]?.[frame] || 0) * this.envelope;
		}
	}

	processLimiter(input, output) {
		const frames = output[0]?.length || 0;
		const ceiling = dbToGain(this.params.ceiling ?? -1);
		const release = coefficient(this.params.release ?? 0.1);
		const ringLength = Math.max(1, this.lookaheadFrames + 1);
		while (this.rings.length < output.length) this.rings.push(new Float32Array(ringLength));
		for (let frame = 0; frame < frames; frame += 1) {
			let peak = 0;
			for (let channel = 0; channel < output.length; channel += 1) {
				const sample = input[channel]?.[frame] || 0;
				this.rings[channel][this.writeIndex] = sample;
				peak = Math.max(peak, Math.abs(sample));
			}
			const target = peak > ceiling && peak > 0 ? ceiling / peak : 1;
			this.envelope = target < this.envelope ? target : 1 + release * (this.envelope - 1);
			const readIndex = (this.writeIndex + 1) % ringLength;
			for (let channel = 0; channel < output.length; channel += 1) {
				output[channel][frame] = clamp(this.rings[channel][readIndex] * this.envelope, -ceiling, ceiling);
			}
			this.writeIndex = readIndex;
		}
	}
}

function coefficient(seconds) {
	return seconds > 0 ? Math.exp(-1 / (seconds * globalThis.sampleRate)) : 0;
}
function dbToGain(value) { return 10 ** (Number(value) / 20); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor(PROCESSOR_NAME, DynamicsProcessor);
