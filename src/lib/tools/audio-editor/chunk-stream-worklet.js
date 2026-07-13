import {
	AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION,
	AUDIO_EDITOR_CHUNK_STREAM_WORKLET_NAME,
	AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
	TransferableAudioChunkQueue,
	serializeChunkStreamError,
} from './chunk-stream.js';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() {
		this.port = { postMessage() {}, onmessage: null, start() {} };
	}
};

/**
 * Pulls bounded transferable packets into the render quantum. It never blocks
 * and never allocates sample buffers in process(). If delivery is late, the
 * source playhead advances through silence so the project timeline remains in
 * sync; late packets are acknowledged as dropped instead of time-shifting the
 * rest of the project.
 */
export class ChunkStreamPlaybackProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		this.messagePort = settings.messagePort || this.port;
		this.defaultChannelCount = boundedInteger(settings.channelCount ?? 2, 1, 64, 2);
		this.capacity = boundedInteger(
			settings.maxQueuePackets ?? AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
			2,
			64,
			AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
		);
		this.prebufferPackets = boundedInteger(settings.prebufferPackets ?? 4, 1, this.capacity, 4);
		this.prebufferTarget = this.prebufferPackets;
		this.streamId = null;
		this.channelCount = this.defaultChannelCount;
		this.startFrame = 0;
		this.endFrame = 0;
		this.positionFrame = 0;
		this.queue = null;
		this.currentPacket = null;
		this.currentOffset = 0;
		this.playing = false;
		this.contextStartFrame = null;
		this.sourceEnded = false;
		this.primed = false;
		this.ended = false;
		this.lastPlayheadReport = 0;
		this.lastUnderrunReport = -Infinity;
		this.messagePort.onmessage = (event) => this.#handleMessage(event.data || {});
		this.messagePort.start?.();
		this.#post({ type: 'processor-ready' });
	}

	process(_inputs, outputs) {
		const output = outputs[0] || [];
		const blockFrames = output[0]?.length || 0;
		for (const channel of output) channel.fill(0);
		if (!blockFrames || !this.streamId || !this.playing || this.ended) return true;

		let outputOffset = 0;
		if (this.contextStartFrame != null) {
			const blockStart = Number.isFinite(globalThis.currentFrame) ? globalThis.currentFrame : null;
			if (blockStart != null) {
				outputOffset = Math.max(0, Math.min(blockFrames, this.contextStartFrame - blockStart));
				if (outputOffset >= blockFrames) return true;
			}
			this.contextStartFrame = null;
		}
		while (outputOffset < blockFrames && this.positionFrame < this.endFrame) {
			if (!this.currentPacket) this.currentPacket = this.queue.dequeue();
			if (!this.currentPacket) {
				const frames = Math.min(blockFrames - outputOffset, this.endFrame - this.positionFrame);
				this.#reportUnderrun(frames);
				this.positionFrame += frames;
				outputOffset += frames;
				continue;
			}

			const packetEnd = this.currentPacket.frameStart + this.currentPacket.frames;
			if (packetEnd <= this.positionFrame) {
				this.#acknowledgeCurrent('dropped-late');
				continue;
			}
			if (this.currentPacket.frameStart > this.positionFrame) {
				const frames = Math.min(
					blockFrames - outputOffset,
					this.currentPacket.frameStart - this.positionFrame,
					this.endFrame - this.positionFrame,
				);
				this.#reportUnderrun(frames);
				this.positionFrame += frames;
				outputOffset += frames;
				continue;
			}

			this.currentOffset = Math.max(this.currentOffset, this.positionFrame - this.currentPacket.frameStart);
			const frames = Math.min(
				blockFrames - outputOffset,
				this.currentPacket.frames - this.currentOffset,
				this.endFrame - this.positionFrame,
			);
			for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
				const source = this.currentPacket.channels[Math.min(channelIndex, this.channelCount - 1)];
				output[channelIndex].set(
					source.subarray(this.currentOffset, this.currentOffset + frames),
					outputOffset,
				);
			}
			this.currentOffset += frames;
			this.positionFrame += frames;
			outputOffset += frames;
			if (this.currentOffset >= this.currentPacket.frames) this.#acknowledgeCurrent('consumed');
		}

		if (this.positionFrame >= this.endFrame) this.#finish();
		else if (this.positionFrame - this.lastPlayheadReport >= AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES) {
			this.lastPlayheadReport = this.positionFrame;
			this.#post({ type: 'stream-playhead', streamId: this.streamId, frame: this.positionFrame });
		}
		return true;
	}

	#handleMessage(message) {
		try {
			if (message.type === 'configure-stream') this.#configure(message);
			else if (!this.streamId || message.streamId !== this.streamId) return;
			else if (message.type === 'audio-packet') this.#enqueue(message);
			else if (message.type === 'source-ended') this.#markSourceEnded(message);
			else if (message.type === 'play-stream') {
				this.contextStartFrame = optionalStartFrame(message.contextStartFrame);
				this.playing = true;
			}
			else if (message.type === 'pause-stream') this.playing = false;
			else if (message.type === 'cancel-stream') this.#cancel(message.reason);
		} catch (error) {
			this.#fail(error, message?.packetId);
		}
	}

	#configure(message) {
		const streamId = normalizeStreamId(message.streamId);
		if (message.protocolVersion != null && Number(message.protocolVersion) !== AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION) {
			throw new RangeError(`Unsupported chunk-stream protocol version ${message.protocolVersion}.`);
		}
		const channelCount = boundedInteger(message.channelCount, 1, 64, this.defaultChannelCount);
		const highWaterMark = boundedInteger(message.highWaterMark, 1, this.capacity, this.capacity);
		const startFrame = nonNegativeInteger(message.startFrame, 'startFrame');
		const endFrame = nonNegativeInteger(message.endFrame, 'endFrame');
		if (startFrame >= endFrame) throw new RangeError('The worklet stream range must be positive.');
		if (message.packetFrames != null && Number(message.packetFrames) !== AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES) {
			throw new RangeError(`Playback packets must contain ${AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES} frames.`);
		}
		this.#clear('reconfigured');
		this.streamId = streamId;
		this.channelCount = channelCount;
		this.startFrame = startFrame;
		this.endFrame = endFrame;
		this.positionFrame = startFrame;
		this.prebufferTarget = Math.min(this.prebufferPackets, highWaterMark);
		this.queue = new TransferableAudioChunkQueue({
			channelCount,
			packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
			capacity: this.capacity,
			startFrame,
		});
		this.currentPacket = null;
		this.currentOffset = 0;
		this.playing = false;
		this.contextStartFrame = null;
		this.sourceEnded = false;
		this.primed = false;
		this.ended = false;
		this.lastPlayheadReport = startFrame;
		this.lastUnderrunReport = -Infinity;
		this.#post({
			type: 'worklet-ready',
			protocolVersion: AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION,
			streamId,
			startFrame,
			endFrame,
			capacity: this.capacity,
		});
	}

	#enqueue(message) {
		this.queue.enqueue(message);
		this.#maybePrime();
	}

	#markSourceEnded(message) {
		const endFrame = nonNegativeInteger(message.endFrame, 'endFrame');
		if (endFrame !== this.endFrame) throw new RangeError('The worker and worklet stream ranges do not match.');
		this.sourceEnded = true;
		this.#maybePrime();
		if (this.playing && this.positionFrame >= this.endFrame) this.#finish();
	}

	#maybePrime() {
		if (this.primed) return;
		if (this.queue.length < this.prebufferTarget && !this.sourceEnded) return;
		this.primed = true;
		this.#post({
			type: 'stream-primed',
			streamId: this.streamId,
			packets: this.queue.length,
			frames: this.queue.queuedFrames,
		});
	}

	#acknowledgeCurrent(status) {
		if (!this.currentPacket) return;
		this.#post({
			type: 'packet-consumed',
			streamId: this.streamId,
			packetId: this.currentPacket.packetId,
			status,
		});
		this.currentPacket = null;
		this.currentOffset = 0;
	}

	#reportUnderrun(frames) {
		if (this.positionFrame - this.lastUnderrunReport < AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES) return;
		this.lastUnderrunReport = this.positionFrame;
		this.#post({
			type: 'stream-underrun',
			streamId: this.streamId,
			frame: this.positionFrame,
			frames,
			sourceEnded: this.sourceEnded,
		});
	}

	#finish() {
		if (this.ended) return;
		this.ended = true;
		this.playing = false;
		if (this.currentPacket) this.#acknowledgeCurrent('trimmed-at-end');
		this.queue?.clear((packet) => this.#post({
			type: 'packet-consumed',
			streamId: this.streamId,
			packetId: packet.packetId,
			status: 'trimmed-at-end',
		}));
		this.#post({ type: 'stream-ended', streamId: this.streamId, frame: this.endFrame });
	}

	#cancel(reason = 'cancelled') {
		const streamId = this.streamId;
		this.#clear('cancelled');
		this.playing = false;
		this.ended = true;
		this.#post({ type: 'worklet-cancelled', streamId, reason: String(reason || 'cancelled') });
	}

	#fail(error, packetId) {
		if (packetId != null && this.streamId) {
			this.#post({ type: 'packet-consumed', streamId: this.streamId, packetId, status: 'rejected' });
		}
		const streamId = this.streamId;
		this.#clear('error');
		this.playing = false;
		this.ended = true;
		this.#post({ type: 'stream-error', streamId, error: serializeChunkStreamError(error) });
	}

	#clear(status) {
		if (this.currentPacket && this.streamId) this.#acknowledgeCurrent(status);
		this.queue?.clear((packet) => {
			if (!this.streamId) return;
			this.#post({
				type: 'packet-consumed',
				streamId: this.streamId,
				packetId: packet.packetId,
				status,
			});
		});
		this.queue = null;
	}

	#post(message) {
		this.messagePort.postMessage(message);
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(AUDIO_EDITOR_CHUNK_STREAM_WORKLET_NAME, ChunkStreamPlaybackProcessor);
}

function normalizeStreamId(value) {
	if (typeof value !== 'string' || !value) throw new TypeError('streamId must be a non-empty string.');
	return value;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function optionalStartFrame(value) {
	return value == null ? null : nonNegativeInteger(value, 'contextStartFrame');
}

function boundedInteger(value, minimum, maximum, fallback) {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) return fallback;
	return Math.max(minimum, Math.min(maximum, number));
}
