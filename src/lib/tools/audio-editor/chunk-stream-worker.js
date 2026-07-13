import {
	AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION,
	AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
	AUDIO_EDITOR_STREAM_HIGH_WATER_PACKETS,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
	createChunkStreamError,
	serializeChunkStreamError,
	transferListForAudioChannels,
} from './chunk-stream.js';
import { createStreamingWindowedSincResampler } from './resample.js';

const RESAMPLE_INPUT_FEED_FRAMES = 4_096;

/**
 * Installs the storage-chunk to playback-packet worker protocol on a
 * DedicatedWorkerGlobalScope-compatible object. Only one 65,536-frame source
 * chunk is retained per stream while bounded 1,024-frame packets are in
 * flight. Sample-rate conversion uses a 4,096-frame input feed and the shared
 * windowed-sinc implementation, so long sources never become AudioBuffers.
 */
export function installChunkStreamWorker(scope = globalThis) {
	if (!scope || typeof scope.addEventListener !== 'function' || typeof scope.postMessage !== 'function') {
		throw new TypeError('A WorkerGlobalScope-compatible object is required.');
	}
	const streams = new Map();
	let nextStorageRequest = 1;

	const post = (message, transfer = []) => scope.postMessage(message, transfer);

	const fail = (stream, error) => {
		if (!stream || !streams.has(stream.id)) return;
		streams.delete(stream.id);
		stream.cancelled = true;
		stream.storageChannels = null;
		stream.pendingOutputChannels = null;
		stream.inFlight.clear();
		post({ type: 'stream-error', streamId: stream.id, error: serializeChunkStreamError(error) });
	};

	const completeIfDrained = (stream) => {
		if (!stream.productionEnded || stream.inFlight.size || stream.cancelled) return;
		streams.delete(stream.id);
		stream.storageChannels = null;
		post({ type: 'stream-complete', streamId: stream.id, frames: stream.endFrame - stream.startFrame });
	};

	const finishProduction = (stream) => {
		if (stream.productionEnded || stream.cancelled) return;
		stream.productionEnded = true;
		stream.storageChannels = null;
		stream.pendingOutputChannels = null;
		stream.storageChunkIndex = null;
		post({
			type: 'source-ended',
			streamId: stream.id,
			endFrame: stream.endFrame,
		});
		completeIfDrained(stream);
	};

	const emitPacket = (stream, channels) => {
		const frames = channels[0]?.length || 0;
		if (!frames) return;
		const packetId = `${stream.id}:packet:${stream.nextPacket++}`;
		const frameStart = stream.nextFrame;
		stream.inFlight.add(packetId);
		stream.nextFrame += frames;
		post({
			type: 'audio-packet',
			streamId: stream.id,
			packetId,
			frameStart,
			frames,
			channels,
		}, transferListForAudioChannels(channels));
		post({
			type: 'stream-progress',
			streamId: stream.id,
			frames: stream.nextFrame - stream.startFrame,
			totalFrames: stream.endFrame - stream.startFrame,
			progress: (stream.nextFrame - stream.startFrame) / (stream.endFrame - stream.startFrame),
		});
	};

	const requestStorageChunk = (stream, chunkIndex) => {
		if (stream.storageRequest) return;
		const frameStart = chunkIndex * AUDIO_EDITOR_STORAGE_CHUNK_FRAMES;
		const frames = Math.min(AUDIO_EDITOR_STORAGE_CHUNK_FRAMES, stream.frameCount - frameStart);
		const requestId = `${stream.id}:storage:${nextStorageRequest++}`;
		stream.storageRequest = { requestId, chunkIndex, frames };
		post({
			type: 'need-storage-chunk',
			streamId: stream.id,
			requestId,
			chunkIndex,
			frameStart,
			frames,
		});
	};

	const pump = (stream) => {
		if (!stream.started || stream.cancelled || stream.productionEnded) return;
		try {
			if (stream.resampler) {
				pumpResampled(stream);
				return;
			}
			while (stream.inFlight.size < stream.highWaterMark && stream.nextFrame < stream.endFrame) {
				const chunkIndex = Math.floor(stream.nextFrame / AUDIO_EDITOR_STORAGE_CHUNK_FRAMES);
				if (stream.storageChunkIndex !== chunkIndex || !stream.storageChannels) {
					stream.storageChannels = null;
					stream.storageChunkIndex = null;
					requestStorageChunk(stream, chunkIndex);
					return;
				}
				const chunkOffset = stream.nextFrame % AUDIO_EDITOR_STORAGE_CHUNK_FRAMES;
				const available = stream.storageChannels[0].length - chunkOffset;
				const frames = Math.min(
					AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
					stream.endFrame - stream.nextFrame,
					available,
				);
				if (frames <= 0) throw createChunkStreamError('INVALID_STORAGE_CHUNK', 'A storage chunk did not cover the requested source frame.');
				const channels = stream.storageChannels.map((channel) => channel.slice(chunkOffset, chunkOffset + frames));
				emitPacket(stream, channels);
				if (Math.floor(stream.nextFrame / AUDIO_EDITOR_STORAGE_CHUNK_FRAMES) !== chunkIndex) {
					stream.storageChannels = null;
					stream.storageChunkIndex = null;
				}
			}
			if (stream.nextFrame >= stream.endFrame) finishProduction(stream);
		} catch (error) {
			fail(stream, error);
		}
	};

	const pumpResampled = (stream) => {
		while (stream.inFlight.size < stream.highWaterMark && stream.nextFrame < stream.endFrame) {
			if (stream.pendingOutputChannels?.[0]?.length > stream.pendingOutputOffset) {
				const available = stream.pendingOutputChannels[0].length - stream.pendingOutputOffset;
				const frames = Math.min(
					AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
					stream.endFrame - stream.nextFrame,
					available,
				);
				const channels = stream.pendingOutputChannels.map((channel) => (
					channel.slice(stream.pendingOutputOffset, stream.pendingOutputOffset + frames)
				));
				stream.pendingOutputOffset += frames;
				if (stream.pendingOutputOffset >= stream.pendingOutputChannels[0].length) {
					stream.pendingOutputChannels = null;
					stream.pendingOutputOffset = 0;
				}
				emitPacket(stream, channels);
				continue;
			}
			if (stream.inputNextFrame < stream.sourceEndFrame) {
				const chunkIndex = Math.floor(stream.inputNextFrame / AUDIO_EDITOR_STORAGE_CHUNK_FRAMES);
				if (stream.storageChunkIndex !== chunkIndex || !stream.storageChannels) {
					stream.storageChannels = null;
					stream.storageChunkIndex = null;
					requestStorageChunk(stream, chunkIndex);
					return;
				}
				const chunkOffset = stream.inputNextFrame % AUDIO_EDITOR_STORAGE_CHUNK_FRAMES;
				const available = stream.storageChannels[0].length - chunkOffset;
				const frames = Math.min(
					RESAMPLE_INPUT_FEED_FRAMES,
					stream.sourceEndFrame - stream.inputNextFrame,
					available,
				);
				if (frames <= 0) throw createChunkStreamError('INVALID_STORAGE_CHUNK', 'A storage chunk did not cover the requested resampler input.');
				const input = stream.storageChannels.map((channel) => channel.slice(chunkOffset, chunkOffset + frames));
				stream.inputNextFrame += frames;
				stream.pendingOutputChannels = stream.resampler.push(input);
				stream.pendingOutputOffset = 0;
				if (Math.floor(stream.inputNextFrame / AUDIO_EDITOR_STORAGE_CHUNK_FRAMES) !== chunkIndex) {
					stream.storageChannels = null;
					stream.storageChunkIndex = null;
				}
				continue;
			}
			if (!stream.resamplerFinished) {
				stream.resamplerFinished = true;
				stream.pendingOutputChannels = stream.resampler.finish(stream.endFrame - stream.startFrame);
				stream.pendingOutputOffset = 0;
				continue;
			}
			break;
		}
		if (stream.nextFrame >= stream.endFrame) finishProduction(stream);
	};

	const open = (message) => {
		const id = normalizeStreamId(message.streamId);
		if (message.protocolVersion != null && Number(message.protocolVersion) !== AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION) {
			throw createChunkStreamError('UNSUPPORTED_PROTOCOL', `Unsupported chunk-stream protocol version ${message.protocolVersion}.`);
		}
		if (streams.has(id)) throw createChunkStreamError('DUPLICATE_STREAM', `Stream ${id} is already open.`);
		const descriptor = normalizeDescriptor(message.source);
		const startFrame = nonNegativeInteger(message.startFrame ?? 0, 'startFrame');
		const endFrame = nonNegativeInteger(message.endFrame ?? descriptor.frameCount, 'endFrame');
		const sourceStartFrame = nonNegativeInteger(message.sourceStartFrame ?? startFrame, 'sourceStartFrame');
		const sourceEndFrame = nonNegativeInteger(message.sourceEndFrame ?? endFrame, 'sourceEndFrame');
		if (startFrame >= endFrame || sourceStartFrame >= sourceEndFrame || sourceEndFrame > descriptor.frameCount) {
			throw createChunkStreamError('INVALID_RANGE', 'The input and output stream ranges must be positive and within the source.');
		}
		const resample = Boolean(message.resample);
		if (!resample && (startFrame !== sourceStartFrame || endFrame !== sourceEndFrame)) {
			throw createChunkStreamError('INVALID_RANGE', 'Distinct input and output ranges require resampling.');
		}
		const resampleInputFrames = resample
			? positiveFinite(message.resampleInputFrames ?? (sourceEndFrame - sourceStartFrame), 'resampleInputFrames')
			: null;
		const resampleInputOffset = resample
			? nonNegativeFinite(message.resampleInputOffset ?? 0, 'resampleInputOffset')
			: null;
		if (resampleInputOffset != null && resampleInputOffset >= sourceEndFrame - sourceStartFrame) {
			throw createChunkStreamError('INVALID_RANGE', 'resampleInputOffset must fall within the physical source range.');
		}
		if (message.packetFrames != null && Number(message.packetFrames) !== AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES) {
			throw createChunkStreamError('INVALID_PACKET_SIZE', `Playback packets must contain ${AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES} frames.`);
		}
		const highWaterMark = boundedInteger(
			message.highWaterMark ?? AUDIO_EDITOR_STREAM_HIGH_WATER_PACKETS,
			1,
			64,
			'highWaterMark',
		);
		const stream = {
			id,
			...descriptor,
			startFrame,
			endFrame,
			sourceStartFrame,
			sourceEndFrame,
			nextFrame: startFrame,
			inputNextFrame: sourceStartFrame,
			nextPacket: 1,
			highWaterMark,
			inFlight: new Set(),
			storageRequest: null,
			storageChunkIndex: null,
			storageChannels: null,
			resampler: resample
				? createStreamingWindowedSincResampler(
					resampleInputFrames,
					endFrame - startFrame,
					descriptor.channelCount,
					{ initialInputPosition: resampleInputOffset },
				)
				: null,
			resamplerFinished: false,
			pendingOutputChannels: null,
			pendingOutputOffset: 0,
			started: false,
			productionEnded: false,
			cancelled: false,
		};
		streams.set(id, stream);
		post({
			type: 'stream-ready',
			protocolVersion: AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION,
			streamId: id,
			channelCount: descriptor.channelCount,
			startFrame,
			endFrame,
			packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
			highWaterMark,
		});
	};

	const acceptStorageChunk = (stream, message) => {
		const request = stream.storageRequest;
		if (!request || message.requestId !== request.requestId || Number(message.chunkIndex) !== request.chunkIndex) {
			throw createChunkStreamError('STALE_STORAGE_CHUNK', 'The worker received an unexpected storage chunk.');
		}
		if (!Array.isArray(message.channels) || message.channels.length !== stream.channelCount) {
			throw createChunkStreamError('INVALID_STORAGE_CHUNK', `Storage chunks must contain ${stream.channelCount} channels.`);
		}
		const channels = message.channels.map((channel, index) => {
			if (!(channel instanceof Float32Array) || channel.length !== request.frames) {
				throw createChunkStreamError(
					'INVALID_STORAGE_CHUNK',
					`Storage channel ${index} must contain ${request.frames} Float32 frames.`,
				);
			}
			transferListForAudioChannels([channel]);
			return channel;
		});
		stream.storageRequest = null;
		stream.storageChunkIndex = request.chunkIndex;
		stream.storageChannels = channels;
		pump(stream);
	};

	const cancel = (stream, reason = 'cancelled') => {
		if (!stream || !streams.has(stream.id)) return;
		streams.delete(stream.id);
		stream.cancelled = true;
		stream.storageChannels = null;
		stream.pendingOutputChannels = null;
		stream.inFlight.clear();
		post({ type: 'stream-cancelled', streamId: stream.id, reason: String(reason || 'cancelled') });
	};

	const onMessage = (event) => {
		const message = event?.data;
		if (!message || typeof message !== 'object') return;
		let stream = null;
		try {
			if (message.type === 'open-stream') {
				open(message);
				return;
			}
			const id = normalizeStreamId(message.streamId);
			stream = streams.get(id);
			if (!stream) return;
			if (message.type === 'start-stream') {
				if (message.highWaterMark != null) {
					stream.highWaterMark = boundedInteger(message.highWaterMark, 1, 64, 'highWaterMark');
				}
				stream.started = true;
				pump(stream);
			} else if (message.type === 'storage-chunk') {
				acceptStorageChunk(stream, message);
			} else if (message.type === 'storage-error') {
				throw createChunkStreamError('STORAGE_READ_FAILED', message.message || 'The source storage chunk could not be read.');
			} else if (message.type === 'packet-consumed') {
				if (!stream.inFlight.delete(message.packetId)) return;
				completeIfDrained(stream);
				pump(stream);
			} else if (message.type === 'cancel-stream' || message.type === 'close-stream') {
				cancel(stream, message.reason);
			}
		} catch (error) {
			if (stream) fail(stream, error);
			else {
				post({
					type: 'stream-error',
					streamId: typeof message.streamId === 'string' ? message.streamId : null,
					error: serializeChunkStreamError(error),
				});
			}
		}
	};

	scope.addEventListener('message', onMessage);
	return Object.freeze({
		get size() {
			return streams.size;
		},
		cancel(streamId, reason) {
			cancel(streams.get(streamId), reason);
		},
		dispose() {
			scope.removeEventListener?.('message', onMessage);
			for (const stream of [...streams.values()]) cancel(stream, 'worker-disposed');
		},
	});
}

function normalizeDescriptor(value) {
	const channelCount = boundedInteger(value?.channelCount, 1, 64, 'source.channelCount');
	const frameCount = positiveInteger(value?.frameCount, 'source.frameCount');
	const chunkFrames = positiveInteger(value?.chunkFrames, 'source.chunkFrames');
	if (chunkFrames !== AUDIO_EDITOR_STORAGE_CHUNK_FRAMES) {
		throw createChunkStreamError(
			'INVALID_STORAGE_CHUNK_SIZE',
			`Long-source storage chunks must contain ${AUDIO_EDITOR_STORAGE_CHUNK_FRAMES} frames.`,
		);
	}
	return { channelCount, frameCount, chunkFrames };
}

function normalizeStreamId(value) {
	if (typeof value !== 'string' || !value) throw createChunkStreamError('INVALID_STREAM_ID', 'streamId must be a non-empty string.');
	return value;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw createChunkStreamError('INVALID_NUMBER', `${name} must be a positive safe integer.`);
	return number;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw createChunkStreamError('INVALID_NUMBER', `${name} must be a non-negative safe integer.`);
	return number;
}

function positiveFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw createChunkStreamError('INVALID_NUMBER', `${name} must be finite and positive.`);
	return number;
}

function nonNegativeFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw createChunkStreamError('INVALID_NUMBER', `${name} must be finite and non-negative.`);
	return number;
}

function boundedInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw createChunkStreamError('INVALID_NUMBER', `${name} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

const isDedicatedWorker = typeof globalThis.DedicatedWorkerGlobalScope === 'function'
	&& globalThis instanceof globalThis.DedicatedWorkerGlobalScope;

if (isDedicatedWorker) installChunkStreamWorker(globalThis);
