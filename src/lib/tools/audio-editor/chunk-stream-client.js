import {
	AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION,
	AUDIO_EDITOR_CHUNK_STREAM_WORKLET_NAME,
	AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
	AUDIO_EDITOR_STREAM_HIGH_WATER_PACKETS,
	AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
	createChunkStreamAbortError,
	deserializeChunkStreamError,
	serializeChunkStreamError,
	transferListForAudioChannels,
} from './chunk-stream.js';

const loadedWorkletContexts = new WeakSet();
let nextStreamId = 1;

export class ChunkStreamClient {
	constructor(options = {}) {
		this.workerFactory = options.workerFactory || defaultWorkerFactory;
		this.worker = null;
		this.streams = new Map();
		this.disposed = false;
	}

	/**
	 * Open a demand-loaded source stream. `source` may be an immutable PCM
	 * chunk set or a descriptor with an async `readStorageChunk(index, ctx)`.
	 * The returned handle exposes separate ready, primed, and done promises.
	 */
	open(options = {}) {
		if (this.disposed) throw new Error('ChunkStreamClient is disposed.');
		if (options.signal?.aborted) throw createChunkStreamAbortError();
		const streamId = normalizeStreamId(options.streamId ?? `audio-stream-${nextStreamId++}`);
		if (this.streams.has(streamId)) throw new Error(`Stream ${streamId} is already open.`);
		const source = normalizeSourceProvider(options.source);
		const sourceStartFrame = nonNegativeInteger(options.sourceStartFrame ?? options.startFrame ?? 0, 'sourceStartFrame');
		const sourceEndFrame = nonNegativeInteger(options.sourceEndFrame ?? options.endFrame ?? source.frameCount, 'sourceEndFrame');
		if (sourceStartFrame >= sourceEndFrame || sourceEndFrame > source.frameCount) throw new RangeError('The stream range must be positive and within the source.');
		const outputFrameCount = options.outputFrameCount == null
			? null
			: positiveInteger(options.outputFrameCount, 'outputFrameCount');
		const resampleInputFrames = outputFrameCount == null
			? null
			: positiveFinite(options.resampleInputFrames ?? (sourceEndFrame - sourceStartFrame), 'resampleInputFrames');
		const resampleInputOffset = outputFrameCount == null
			? null
			: nonNegativeFinite(options.resampleInputOffset ?? 0, 'resampleInputOffset');
		if (resampleInputOffset != null && resampleInputOffset >= sourceEndFrame - sourceStartFrame) {
			throw new RangeError('resampleInputOffset must fall within the physical source range.');
		}
		const startFrame = outputFrameCount == null
			? sourceStartFrame
			: nonNegativeInteger(options.outputStartFrame ?? 0, 'outputStartFrame');
		const endFrame = outputFrameCount == null ? sourceEndFrame : startFrame + outputFrameCount;
		if (!Number.isSafeInteger(endFrame)) throw new RangeError('The output stream range is too large.');
		const highWaterMark = boundedInteger(
			options.highWaterMark ?? AUDIO_EDITOR_STREAM_HIGH_WATER_PACKETS,
			1,
			AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
			'highWaterMark',
		);
		const outputPort = normalizeMessagePort(options.outputPort);
		const worker = this.#getWorker();
		const ready = createDeferred();
		const primed = createDeferred();
		const done = createDeferred();
		const abortController = new AbortController();
		const stream = {
			id: streamId,
			source,
			startFrame,
			endFrame,
			sourceStartFrame,
			sourceEndFrame,
			resampleInputFrames,
			resampleInputOffset,
			resample: outputFrameCount != null,
			highWaterMark,
			outputPort,
			ready,
			primed,
			done,
			abortController,
			externalSignal: options.signal || null,
			externalAbort: null,
			removePortListener: null,
			workerReady: false,
			workletReady: false,
			workletCapacity: highWaterMark,
			workerStarted: false,
			workerComplete: false,
			workletEnded: false,
			playRequested: Boolean(options.autoplay),
			playContextStartFrame: null,
			playing: false,
			settled: false,
			onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
			onUnderrun: typeof options.onUnderrun === 'function' ? options.onUnderrun : null,
			onPlayhead: typeof options.onPlayhead === 'function' ? options.onPlayhead : null,
		};
		stream.removePortListener = addMessageListener(outputPort, (message) => this.#handleWorkletMessage(stream, message));
		if (stream.externalSignal) {
			stream.externalAbort = () => this.#cancelStream(stream, createChunkStreamAbortError());
			stream.externalSignal.addEventListener('abort', stream.externalAbort, { once: true });
		}
		this.streams.set(streamId, stream);

		outputPort.postMessage({
			type: 'configure-stream',
			protocolVersion: AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION,
			streamId,
			channelCount: source.channelCount,
			startFrame,
			endFrame,
			sourceStartFrame,
			sourceEndFrame,
			resample: outputFrameCount != null,
			packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
			highWaterMark,
		});
		worker.postMessage({
			type: 'open-stream',
			protocolVersion: AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION,
			streamId,
			source: {
				channelCount: source.channelCount,
				frameCount: source.frameCount,
				chunkFrames: source.chunkFrames,
			},
			startFrame,
			endFrame,
			sourceStartFrame,
			sourceEndFrame,
			resampleInputFrames,
			resampleInputOffset,
			resample: outputFrameCount != null,
			packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
			highWaterMark,
		});

		const handle = {
			streamId,
			ready: ready.promise,
			primed: primed.promise,
			done: done.promise,
			play: async (options = {}) => {
				stream.playRequested = true;
				stream.playContextStartFrame = normalizeOptionalStartFrame(options?.contextStartFrame);
				await primed.promise;
				if (!stream.settled && !stream.playing) {
					stream.playing = true;
					outputPort.postMessage({
						type: 'play-stream',
						streamId,
						contextStartFrame: stream.playContextStartFrame,
					});
				}
			},
			pause: () => {
				stream.playRequested = false;
				stream.playing = false;
				if (!stream.settled) outputPort.postMessage({ type: 'pause-stream', streamId });
			},
			cancel: (reason) => this.#cancelStream(
				stream,
				createChunkStreamAbortError(typeof reason === 'string' && reason ? reason : undefined),
			),
			get state() {
				if (stream.settled) return 'closed';
				if (stream.playing) return 'playing';
				if (stream.primed.settled) return 'primed';
				if (stream.ready.settled) return 'buffering';
				return 'opening';
			},
		};
		return Object.freeze(handle);
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const stream of [...this.streams.values()]) {
			this.#cancelStream(stream, createChunkStreamAbortError('Audio streaming client was disposed.'));
		}
		this.worker?.terminate?.();
		this.worker = null;
	}

	#getWorker() {
		if (this.worker) return this.worker;
		const worker = this.workerFactory();
		if (!worker || typeof worker.postMessage !== 'function' || typeof worker.addEventListener !== 'function') {
			throw new TypeError('workerFactory must return a Worker-like object.');
		}
		worker.addEventListener('message', (event) => this.#handleWorkerMessage(event.data));
		worker.addEventListener('error', (event) => {
			this.#handleWorkerFailure(event.error || new Error(event.message || 'Audio streaming worker failed.'));
		});
		worker.addEventListener('messageerror', () => this.#handleWorkerFailure(new Error('Audio streaming worker sent an unreadable message.')));
		this.worker = worker;
		return worker;
	}

	#handleWorkerMessage(message) {
		if (!message || typeof message !== 'object') return;
		const stream = this.streams.get(message.streamId);
		if (!stream) return;
		if (message.type === 'stream-ready') {
			if (Number(message.protocolVersion) !== AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION) {
				this.#failStream(stream, new Error(`Unsupported worker protocol version ${message.protocolVersion}.`));
				return;
			}
			stream.workerReady = true;
			this.#startIfReady(stream);
		} else if (message.type === 'need-storage-chunk') {
			this.#provideStorageChunk(stream, message);
		} else if (message.type === 'audio-packet') {
			try {
				const transfer = transferListForAudioChannels(message.channels);
				stream.outputPort.postMessage(message, transfer);
			} catch (error) {
				this.#failStream(stream, error);
			}
		} else if (message.type === 'source-ended') {
			stream.outputPort.postMessage(message);
		} else if (message.type === 'stream-progress') {
			stream.onProgress?.({
				frames: Number(message.frames) || 0,
				totalFrames: Number(message.totalFrames) || 0,
				progress: clamp(Number(message.progress) || 0, 0, 1),
			});
		} else if (message.type === 'stream-complete') {
			stream.workerComplete = true;
			this.#completeIfFinished(stream);
		} else if (message.type === 'stream-error') {
			this.#failStream(stream, deserializeChunkStreamError(message.error));
		} else if (message.type === 'stream-cancelled') {
			this.#failStream(stream, createChunkStreamAbortError());
		}
	}

	#handleWorkletMessage(stream, message) {
		if (!message || typeof message !== 'object') return;
		if (message.streamId && message.streamId !== stream.id) return;
		if (message.type === 'worklet-ready') {
			if (Number(message.protocolVersion) !== AUDIO_EDITOR_CHUNK_STREAM_PROTOCOL_VERSION) {
				this.#failStream(stream, new Error(`Unsupported worklet protocol version ${message.protocolVersion}.`));
				return;
			}
			stream.workletReady = true;
			stream.workletCapacity = boundedInteger(
				message.capacity ?? stream.highWaterMark,
				1,
				64,
				'worklet.capacity',
			);
			this.#startIfReady(stream);
		} else if (message.type === 'stream-primed') {
			stream.primed.resolve({ packets: message.packets, frames: message.frames });
			if (stream.playRequested && !stream.playing) {
				stream.playing = true;
				stream.outputPort.postMessage({
					type: 'play-stream',
					streamId: stream.id,
					contextStartFrame: stream.playContextStartFrame,
				});
			}
		} else if (message.type === 'packet-consumed') {
			this.worker?.postMessage({
				type: 'packet-consumed',
				streamId: stream.id,
				packetId: message.packetId,
				status: message.status,
			});
		} else if (message.type === 'stream-ended') {
			stream.workletEnded = true;
			stream.playing = false;
			this.#completeIfFinished(stream);
		} else if (message.type === 'stream-underrun') {
			stream.onUnderrun?.({
				frame: Number(message.frame) || 0,
				frames: Number(message.frames) || 0,
				sourceEnded: Boolean(message.sourceEnded),
			});
		} else if (message.type === 'stream-playhead') {
			stream.onPlayhead?.(Number(message.frame) || 0);
		} else if (message.type === 'stream-error') {
			this.#failStream(stream, deserializeChunkStreamError(message.error));
		} else if (message.type === 'worklet-cancelled') {
			this.#failStream(stream, createChunkStreamAbortError());
		}
	}

	#startIfReady(stream) {
		if (stream.settled || stream.workerStarted || !stream.workerReady || !stream.workletReady) return;
		stream.workerStarted = true;
		stream.ready.resolve({
			streamId: stream.id,
			startFrame: stream.startFrame,
			endFrame: stream.endFrame,
			channelCount: stream.source.channelCount,
		});
		this.worker.postMessage({
			type: 'start-stream',
			streamId: stream.id,
			highWaterMark: Math.min(stream.highWaterMark, stream.workletCapacity),
		});
	}

	async #provideStorageChunk(stream, message) {
		if (stream.settled || stream.abortController.signal.aborted) return;
		try {
			const result = await stream.source.readStorageChunk(message.chunkIndex, {
				signal: stream.abortController.signal,
				streamId: stream.id,
				frameStart: message.frameStart,
				frames: message.frames,
			});
			if (stream.settled || stream.abortController.signal.aborted) return;
			const channels = normalizeStorageChannels(
				result?.channels || result,
				stream.source.channelCount,
				message.frames,
			);
			this.worker.postMessage({
				type: 'storage-chunk',
				streamId: stream.id,
				requestId: message.requestId,
				chunkIndex: message.chunkIndex,
				channels,
			}, transferListForAudioChannels(channels));
		} catch (error) {
			if (stream.settled || stream.abortController.signal.aborted) return;
			this.worker.postMessage({
				type: 'storage-error',
				streamId: stream.id,
				requestId: message.requestId,
				chunkIndex: message.chunkIndex,
				message: error instanceof Error ? error.message : String(error),
				error: serializeChunkStreamError(error),
			});
		}
	}

	#completeIfFinished(stream) {
		if (!stream.workerComplete || !stream.workletEnded || stream.settled) return;
		this.#detachStream(stream);
		stream.done.resolve({
			streamId: stream.id,
			startFrame: stream.startFrame,
			endFrame: stream.endFrame,
			frames: stream.endFrame - stream.startFrame,
		});
	}

	#cancelStream(stream, error) {
		if (!stream || stream.settled) return;
		const worker = this.worker;
		const outputPort = stream.outputPort;
		this.#rejectAndDetach(stream, error);
		worker?.postMessage({ type: 'cancel-stream', streamId: stream.id, reason: error.message });
		outputPort.postMessage({ type: 'cancel-stream', streamId: stream.id, reason: error.message });
	}

	#failStream(stream, error) {
		if (!stream || stream.settled) return;
		const worker = this.worker;
		const outputPort = stream.outputPort;
		this.#rejectAndDetach(stream, error);
		worker?.postMessage({ type: 'cancel-stream', streamId: stream.id, reason: error.message });
		outputPort.postMessage({ type: 'cancel-stream', streamId: stream.id, reason: error.message });
	}

	#rejectAndDetach(stream, error) {
		stream.ready.reject(error);
		stream.primed.reject(error);
		stream.done.reject(error);
		this.#detachStream(stream);
	}

	#detachStream(stream) {
		if (stream.settled) return;
		stream.settled = true;
		stream.playing = false;
		stream.abortController.abort();
		stream.removePortListener?.();
		if (stream.externalSignal && stream.externalAbort) {
			stream.externalSignal.removeEventListener('abort', stream.externalAbort);
		}
		this.streams.delete(stream.id);
	}

	#handleWorkerFailure(error) {
		for (const stream of [...this.streams.values()]) this.#failStream(stream, error);
		this.worker?.terminate?.();
		this.worker = null;
	}
}

export async function ensureChunkStreamWorklet(audioContext) {
	if (!audioContext?.audioWorklet?.addModule) throw new TypeError('An AudioContext with audioWorklet support is required.');
	if (loadedWorkletContexts.has(audioContext)) return;
	await audioContext.audioWorklet.addModule(new URL('./chunk-stream-worklet.js', import.meta.url));
	loadedWorkletContexts.add(audioContext);
}

export async function createChunkStreamAudioNode(audioContext, options = {}) {
	await ensureChunkStreamWorklet(audioContext);
	const NodeConstructor = options.AudioWorkletNode || globalThis.AudioWorkletNode;
	if (typeof NodeConstructor !== 'function') throw new Error('AudioWorkletNode is not available in this browser.');
	const channelCount = boundedInteger(options.channelCount ?? 2, 1, 64, 'channelCount');
	return new NodeConstructor(audioContext, AUDIO_EDITOR_CHUNK_STREAM_WORKLET_NAME, {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [channelCount],
		processorOptions: {
			channelCount,
			maxQueuePackets: options.maxQueuePackets ?? AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
			prebufferPackets: options.prebufferPackets ?? 4,
		},
	});
}

export function createImmutablePcmStreamSource(pcm) {
	return normalizeSourceProvider(pcm);
}

function normalizeSourceProvider(source) {
	if (!source || typeof source !== 'object') throw new TypeError('A long-source chunk provider is required.');
	const descriptor = source.descriptor && typeof source.descriptor === 'object' ? source.descriptor : source;
	const channelCount = boundedInteger(descriptor.channelCount, 1, 64, 'source.channelCount');
	const frameCount = positiveInteger(descriptor.frameCount, 'source.frameCount');
	const chunkFrames = boundedInteger(
		descriptor.chunkFrames,
		1,
		AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
		'source.chunkFrames',
	);
	let readStorageChunk;
	if (Array.isArray(source.chunks)) {
		readStorageChunk = async (chunkIndex) => {
			const channels = source.chunks[chunkIndex];
			if (!channels) throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
			return channels;
		};
	} else {
		readStorageChunk = source.readStorageChunk || source.readChunk;
		if (typeof readStorageChunk !== 'function') throw new TypeError('source.readStorageChunk must be a function.');
		readStorageChunk = readStorageChunk.bind(source);
	}
	return Object.freeze({ channelCount, frameCount, chunkFrames, readStorageChunk });
}

function normalizeStorageChannels(value, channelCount, frames) {
	if (!Array.isArray(value) || value.length !== channelCount) {
		throw new TypeError(`A storage chunk must contain ${channelCount} planar channels.`);
	}
	return value.map((channel, index) => {
		if (!(channel instanceof Float32Array) || channel.length !== frames) {
			throw new RangeError(`Storage channel ${index} must contain ${frames} Float32 frames.`);
		}
		transferListForAudioChannels([channel]);
		return channel.slice();
	});
}

function normalizeMessagePort(value) {
	if (!value || typeof value.postMessage !== 'function') throw new TypeError('An AudioWorklet MessagePort is required.');
	if (typeof value.addEventListener !== 'function' && !('onmessage' in value)) {
		throw new TypeError('The output port must support message events.');
	}
	return value;
}

function addMessageListener(port, callback) {
	if (typeof port.addEventListener === 'function') {
		const listener = (event) => callback(event.data);
		port.addEventListener('message', listener);
		port.start?.();
		return () => port.removeEventListener?.('message', listener);
	}
	const previous = port.onmessage;
	const listener = (event) => {
		previous?.(event);
		callback(event.data);
	};
	port.onmessage = listener;
	port.start?.();
	return () => {
		if (port.onmessage === listener) port.onmessage = previous || null;
	};
}

function createDeferred() {
	let resolvePromise;
	let rejectPromise;
	const deferred = {
		settled: false,
		promise: new Promise((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		}),
		resolve(value) {
			if (deferred.settled) return;
			deferred.settled = true;
			resolvePromise(value);
		},
		reject(error) {
			if (deferred.settled) return;
			deferred.settled = true;
			rejectPromise(error);
		},
	};
	return deferred;
}

function defaultWorkerFactory() {
	return new Worker(new URL('./chunk-stream-worker.js', import.meta.url), {
		type: 'module',
		name: 'audacity-long-source-stream',
	});
}

function normalizeStreamId(value) {
	if (typeof value !== 'string' || !value) throw new TypeError('streamId must be a non-empty string.');
	return value;
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

function positiveFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be finite and positive.`);
	return number;
}

function nonNegativeFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be finite and non-negative.`);
	return number;
}

function normalizeOptionalStartFrame(value) {
	if (value == null) return null;
	return nonNegativeInteger(value, 'contextStartFrame');
}

function boundedInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
