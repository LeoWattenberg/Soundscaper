import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from './pcm-chunks.js';

export const AUDIO_EDITOR_STORAGE_CHUNK_FRAMES = AUDIO_EDITOR_PCM_CHUNK_FRAMES;
export const AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES = 1_024;
export const AUDIO_EDITOR_STREAM_HIGH_WATER_PACKETS = 8;
export const AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS = 12;
export const AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION = 1;
export const AUDIO_EDITOR_CHUNK_STREAM_WORKLET_NAME = 'kw-audio-chunk-stream';

/**
 * A bounded FIFO for planar PCM packets received through postMessage().
 * Packets deliberately require ordinary ArrayBuffers: SharedArrayBuffer is
 * neither needed nor accepted by the browser editor's GitHub Pages build.
 */
export class TransferableAudioChunkQueue {
	constructor(options = {}) {
		this.channelCount = positiveInteger(options.channelCount, 'channelCount');
		this.packetFrames = positiveInteger(
			options.packetFrames ?? AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
			'packetFrames',
		);
		this.capacity = positiveInteger(
			options.capacity ?? AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
			'capacity',
		);
		this.expectedEnqueueFrame = options.startFrame == null
			? null
			: nonNegativeInteger(options.startFrame, 'startFrame');
		this.packets = [];
		this.queuedFrames = 0;
	}

	get length() {
		return this.packets.length;
	}

	get full() {
		return this.length >= this.capacity;
	}

	enqueue(value) {
		if (this.full) throw streamError('QUEUE_FULL', `The transferable audio queue is limited to ${this.capacity} packets.`);
		const packet = normalizeTransferableAudioPacket(value, {
			channelCount: this.channelCount,
			packetFrames: this.packetFrames,
		});
		if (this.expectedEnqueueFrame != null && packet.frameStart !== this.expectedEnqueueFrame) {
			throw streamError(
				'NON_CONTIGUOUS_PACKET',
				`Expected audio frame ${this.expectedEnqueueFrame}, received ${packet.frameStart}.`,
			);
		}
		this.expectedEnqueueFrame = packet.frameStart + packet.frames;
		this.packets.push(packet);
		this.queuedFrames += packet.frames;
		return packet;
	}

	peek() {
		return this.packets[0] || null;
	}

	dequeue() {
		const packet = this.packets.shift() || null;
		if (packet) this.queuedFrames -= packet.frames;
		return packet;
	}

	clear(callback) {
		const packets = this.packets.splice(0);
		this.queuedFrames = 0;
		if (typeof callback === 'function') {
			for (const packet of packets) callback(packet);
		}
		return packets;
	}
}

export function normalizeTransferableAudioPacket(value, options = {}) {
	const channelCount = positiveInteger(options.channelCount, 'channelCount');
	const packetFrames = positiveInteger(
		options.packetFrames ?? AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		'packetFrames',
	);
	const packetId = normalizePacketId(value?.packetId);
	const frameStart = nonNegativeInteger(value?.frameStart, 'packet.frameStart');
	if (!Array.isArray(value?.channels) || value.channels.length !== channelCount) {
		throw streamError('INVALID_CHANNELS', `A packet must contain exactly ${channelCount} planar channels.`);
	}
	let frames = null;
	const channels = value.channels.map((channel, index) => {
		if (!(channel instanceof Float32Array)) {
			throw streamError('INVALID_CHANNELS', `packet.channels[${index}] must be a Float32Array.`);
		}
		assertOrdinaryArrayBuffer(channel.buffer, `packet.channels[${index}]`);
		if (frames == null) frames = channel.length;
		else if (channel.length !== frames) {
			throw streamError('INVALID_CHANNELS', 'All packet channels must have the same frame count.');
		}
		return channel;
	});
	if (!frames || frames > packetFrames) {
		throw streamError('INVALID_PACKET_SIZE', `Packets must contain between 1 and ${packetFrames} frames.`);
	}
	return Object.freeze({
		packetId,
		frameStart,
		frames,
		channels: Object.freeze(channels),
	});
}

export function transferListForAudioChannels(channels) {
	if (!Array.isArray(channels) || !channels.length) throw new TypeError('Planar audio channels are required.');
	const buffers = [];
	const seen = new Set();
	for (const [index, channel] of channels.entries()) {
		if (!(channel instanceof Float32Array)) throw new TypeError(`channels[${index}] must be a Float32Array.`);
		assertOrdinaryArrayBuffer(channel.buffer, `channels[${index}]`);
		if (!seen.has(channel.buffer)) {
			seen.add(channel.buffer);
			buffers.push(channel.buffer);
		}
	}
	return buffers;
}

export function createChunkStreamError(code, message) {
	return streamError(String(code || 'STREAM_ERROR'), String(message || 'Audio streaming failed.'));
}

export function serializeChunkStreamError(error) {
	return {
		name: typeof error?.name === 'string' ? error.name : 'Error',
		code: typeof error?.code === 'string' ? error.code : 'STREAM_ERROR',
		message: typeof error?.message === 'string' ? error.message : String(error),
		stack: typeof error?.stack === 'string' ? error.stack : '',
	};
}

export function deserializeChunkStreamError(value) {
	const error = streamError(
		typeof value?.code === 'string' ? value.code : 'STREAM_ERROR',
		typeof value?.message === 'string' ? value.message : 'Audio streaming failed.',
	);
	error.name = typeof value?.name === 'string' ? value.name : 'Error';
	if (typeof value?.stack === 'string' && value.stack) error.stack = value.stack;
	return error;
}

export function createChunkStreamAbortError(message = 'Audio streaming was cancelled.') {
	const error = streamError('ABORTED', message);
	error.name = 'AbortError';
	return error;
}

function assertOrdinaryArrayBuffer(buffer, name) {
	if (!(buffer instanceof ArrayBuffer)) {
		if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
			throw streamError('SHARED_MEMORY_FORBIDDEN', `${name} must not use SharedArrayBuffer.`);
		}
		throw streamError('INVALID_BUFFER', `${name} must be backed by an ArrayBuffer.`);
	}
}

function normalizePacketId(value) {
	if (typeof value === 'string' && value) return value;
	if (Number.isSafeInteger(value) && value >= 0) return value;
	throw streamError('INVALID_PACKET_ID', 'packet.packetId must be a non-empty string or non-negative safe integer.');
}

function streamError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}
