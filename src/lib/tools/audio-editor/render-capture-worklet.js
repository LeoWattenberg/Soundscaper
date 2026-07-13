const WorkletProcessor = globalThis.AudioWorkletProcessor || class {
	constructor() { this.port = { postMessage() {}, onmessage: null }; }
};

class RenderCaptureProcessor extends WorkletProcessor {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		this.startFrame = Math.max(0, Math.floor(settings.startFrame || 0));
		this.totalFrames = Math.max(1, Math.floor(settings.totalFrames || 1));
		this.chunkFrames = Math.max(128, Math.min(16_384, Math.floor(settings.chunkFrames || 4096)));
		this.capturedFrames = 0;
		this.writeOffset = 0;
		this.finished = false;
		this.buffers = [new Float32Array(this.chunkFrames), new Float32Array(this.chunkFrames)];
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		for (const channel of outputs[0] || []) channel.fill(0);
		if (this.finished) return false;
		const blockFrames = input[0]?.length || outputs[0]?.[0]?.length || 128;
		const blockStart = Number.isFinite(globalThis.currentFrame) ? globalThis.currentFrame : 0;
		if (blockStart + blockFrames <= this.startFrame) return true;
		const first = Math.max(0, this.startFrame - blockStart);
		const remaining = this.totalFrames - this.capturedFrames;
		const last = Math.min(blockFrames, first + remaining);
		for (let frame = first; frame < last && this.capturedFrames < this.totalFrames; frame += 1) {
			for (let channel = 0; channel < 2; channel += 1) {
				const source = input[Math.min(channel, Math.max(0, input.length - 1))];
				this.buffers[channel][this.writeOffset] = source?.[frame] || 0;
			}
			this.writeOffset += 1;
			this.capturedFrames += 1;
			if (this.writeOffset === this.chunkFrames) this.#flush();
		}
		if (this.capturedFrames >= this.totalFrames) return this.#finish();
		return true;
	}

	#flush() {
		if (!this.writeOffset) return;
		const channels = this.buffers.map((buffer) => buffer.slice(0, this.writeOffset));
		const frames = this.writeOffset;
		const frameOffset = this.capturedFrames - frames;
		this.buffers = [new Float32Array(this.chunkFrames), new Float32Array(this.chunkFrames)];
		this.writeOffset = 0;
		this.port.postMessage({ type: 'audio-chunk', channels, frames, frameOffset }, channels.map((channel) => channel.buffer));
	}

	#finish() {
		if (this.finished) return false;
		this.finished = true;
		this.#flush();
		this.port.postMessage({ type: 'done', frames: this.capturedFrames });
		return false;
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor('kw-audio-render-capture', RenderCaptureProcessor);
}

export { RenderCaptureProcessor };
