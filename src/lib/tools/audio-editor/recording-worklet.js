const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() {
		this.port = { postMessage() {}, addEventListener() {}, start() {}, onmessage: null };
	}
};
const MIN_INPUT_GAIN = 0;
const MAX_INPUT_GAIN = 2;
const DEFAULT_INPUT_GAIN = 1;
const MAX_CHANNEL_COUNT = 32;

/**
 * Copies microphone input into bounded transferable chunks. The main thread is
 * responsible for persisting every chunk before the next queued write.
 */
export class StreamingRecorderProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const processorOptions = options.processorOptions || {};
		this.channelCount = clampInteger(processorOptions.channelCount, 1, MAX_CHANNEL_COUNT, 1);
		this.chunkFrames = clampInteger(processorOptions.chunkFrames, 128, 16384, 4096);
		this.monitor = Boolean(processorOptions.monitor);
		this.inputGain = clampInputGain(processorOptions.inputGain, DEFAULT_INPUT_GAIN);
		this.recording = false;
		this.paused = false;
		this.pausedAtFrame = null;
		this.startFrame = 0;
		this.stopFrame = Infinity;
		this.nextFrame = 0;
		this.chunkStartFrame = 0;
		this.writeOffset = 0;
		this.buffers = this.#allocateBuffers();
		this.port.onmessage = (event) => this.#handleMessage(event.data || {});
		this.port.start?.();
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		const blockLength = input[0]?.length || output[0]?.length || 128;
		const globalFrame = Number.isFinite(globalThis.currentFrame) ? globalThis.currentFrame : this.nextFrame;
		this.nextFrame = globalFrame + blockLength;

		for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
			const outputChannel = output[channelIndex];
			const inputChannel = input[Math.min(channelIndex, Math.max(0, input.length - 1))];
			if (this.monitor && inputChannel) {
				for (let frameIndex = 0; frameIndex < outputChannel.length; frameIndex += 1) {
					outputChannel[frameIndex] = (inputChannel[frameIndex] || 0) * this.inputGain;
				}
			} else outputChannel.fill(0);
		}

		if (!this.recording || this.paused) return true;
		if (!input.length) {
			if (globalFrame + blockLength >= this.stopFrame) this.#finish();
			return true;
		}
		const firstIndex = Math.max(0, this.startFrame - globalFrame);
		const lastIndex = Math.min(blockLength, this.stopFrame - globalFrame);
		if (lastIndex <= firstIndex) {
			if (globalFrame >= this.stopFrame) this.#finish();
			return true;
		}

		if (this.writeOffset === 0) this.chunkStartFrame = globalFrame + firstIndex;
		for (let frameIndex = firstIndex; frameIndex < lastIndex; frameIndex += 1) {
			for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
				const source = input[Math.min(channelIndex, input.length - 1)];
				this.buffers[channelIndex][this.writeOffset] = (source?.[frameIndex] || 0) * this.inputGain;
			}
			this.writeOffset += 1;
			if (this.writeOffset === this.chunkFrames) this.#flush();
		}
		if (globalFrame + blockLength >= this.stopFrame) this.#finish();
		return true;
	}

	#handleMessage(message) {
		if (message.type === 'start') {
			this.#flush();
			this.startFrame = Number.isFinite(message.startFrame) ? Math.max(0, Math.floor(message.startFrame)) : this.nextFrame;
			this.stopFrame = Number.isFinite(message.stopFrame) ? Math.max(this.startFrame, Math.floor(message.stopFrame)) : Infinity;
			this.recording = true;
			this.paused = false;
			this.pausedAtFrame = null;
			this.port.postMessage({ type: 'started', startFrame: this.startFrame, stopFrame: this.stopFrame });
		} else if (message.type === 'pause' && this.recording && !this.paused) {
			this.#flush();
			this.paused = true;
			this.pausedAtFrame = this.nextFrame;
			this.port.postMessage({ type: 'paused', frame: this.nextFrame });
		} else if (message.type === 'resume' && this.recording && this.paused) {
			const pauseFrames = Math.max(0, this.nextFrame - (this.pausedAtFrame ?? this.nextFrame));
			if (Number.isFinite(this.stopFrame)) this.stopFrame += pauseFrames;
			this.paused = false;
			this.pausedAtFrame = null;
			this.port.postMessage({ type: 'resumed', frame: this.nextFrame });
		} else if (message.type === 'stop') {
			this.#finish();
		} else if (message.type === 'flush') {
			this.#flush();
		} else if (message.type === 'monitor') {
			this.monitor = Boolean(message.enabled);
		} else if (message.type === 'input-gain') {
			// Treat messages as untrusted even though the main-thread controller
			// validates them. A malformed value must never turn audio into NaNs.
			this.inputGain = clampInputGain(message.value, this.inputGain);
		}
	}

	#finish() {
		if (!this.recording) return;
		this.recording = false;
		this.paused = false;
		this.pausedAtFrame = null;
		this.#flush();
		this.port.postMessage({ type: 'stopped', frame: this.nextFrame });
	}

	#flush() {
		if (!this.writeOffset) return;
		const channels = this.buffers.map((buffer) => buffer.slice(0, this.writeOffset));
		const frames = this.writeOffset;
		this.buffers = this.#allocateBuffers();
		this.writeOffset = 0;
		this.port.postMessage({
			type: 'audio-chunk',
			frameStart: this.chunkStartFrame,
			frames,
			channels,
		}, channels.map((channel) => channel.buffer));
	}

	#allocateBuffers() {
		return Array.from({ length: this.channelCount }, () => new Float32Array(this.chunkFrames));
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor('kw-audio-recorder', StreamingRecorderProcessor);
}

function clampInteger(value, minimum, maximum, fallback) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function clampInputGain(value, fallback) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.max(MIN_INPUT_GAIN, Math.min(MAX_INPUT_GAIN, value));
}
