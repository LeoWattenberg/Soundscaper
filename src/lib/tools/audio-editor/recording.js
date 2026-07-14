const DEFAULT_PROCESSOR_NAME = 'kw-audio-recorder';
const DISPLAY_INPUT_KEY = 'display';
const HARDWARE_INPUT_KEY_PREFIX = 'device:';
export const RECORDING_INPUT_GAIN_MINIMUM = 0;
export const RECORDING_INPUT_GAIN_MAXIMUM = 2;
export const RECORDING_INPUT_GAIN_DEFAULT = 1;
// Chromium rejects AudioWorkletNode output channel counts above 32.
export const RECORDING_CHANNEL_COUNT_MAXIMUM = 32;

export async function requestMicrophone(constraints = { audio: true }) {
	const mediaDevices = getMediaDevices();
	if (!mediaDevices?.getUserMedia) {
		throw new Error('Microphone recording is not supported in this browser.');
	}
	return mediaDevices.getUserMedia.call(mediaDevices, constraints);
}

/**
 * Request one exact hardware input without browser speech processing. The
 * requested channel count is an ideal/maximum hint; callers must inspect the
 * returned audio track because browsers may expose fewer device channels.
 */
export async function requestHardwareInput({
	deviceId,
	channelCount = 2,
	sampleRate,
	audioConstraints = {},
	mediaDevices = getMediaDevices(),
} = {}) {
	if (!mediaDevices?.getUserMedia) {
		throw new Error('Hardware audio recording is not supported in this browser.');
	}
	const normalizedChannelCount = normalizeRecordingChannelCount(channelCount);
	const audio = {
		...audioConstraints,
		channelCount: { ideal: normalizedChannelCount, max: normalizedChannelCount },
		echoCancellation: false,
		noiseSuppression: false,
		autoGainControl: false,
	};
	if (deviceId !== undefined && deviceId !== null && String(deviceId)) {
		audio.deviceId = { exact: String(deviceId) };
	}
	if (Number.isFinite(sampleRate) && sampleRate > 0) {
		audio.sampleRate = { ideal: Math.floor(sampleRate) };
	}
	return mediaDevices.getUserMedia.call(mediaDevices, { audio });
}

/**
 * Request tab/window/system audio. Display capture always includes video at
 * the API boundary; consumers may leave that track disconnected while keeping
 * it alive for the lifetime of the capture permission.
 */
export async function requestDisplayInput({
	audioConstraints = true,
	videoConstraints = true,
	displayConstraints = {},
	mediaDevices = getMediaDevices(),
} = {}) {
	if (!mediaDevices?.getDisplayMedia) {
		throw new Error('Desktop audio recording is not supported in this browser.');
	}
	return mediaDevices.getDisplayMedia.call(mediaDevices, {
		...displayConstraints,
		video: videoConstraints || true,
		audio: audioConstraints || true,
		selfBrowserSurface: 'exclude',
		systemAudio: 'include',
		windowAudio: 'system',
	});
}

/**
 * Set up a microphone -> AudioWorklet recording pipeline. `onChunk` may return
 * a promise (for example an IndexedDB write); calls are serialized and an
 * overrun stops capture rather than retaining an unbounded queue in memory.
 */
export async function createRecordingController({
	context,
	stream,
	workletUrl = new URL('./recording-worklet.js', import.meta.url),
	processorName = DEFAULT_PROCESSOR_NAME,
	channelCount = 1,
	chunkFrames = 4096,
	monitor = false,
	inputGain = RECORDING_INPUT_GAIN_DEFAULT,
	onChunk,
	onState,
	onError,
	maxPendingChunks = 32,
	discreteChannels = true,
	nodeFactory,
} = {}) {
	if (!context?.audioWorklet?.addModule || !context?.createMediaStreamSource) {
		throw new Error('AudioWorklet recording is not supported by this AudioContext.');
	}
	if (!stream) throw new Error('An audio MediaStream is required.');
	const normalizedChannelCount = normalizeRecordingChannelCount(channelCount);
	let currentInputGain = normalizeRecordingInputGain(inputGain);
	await context.audioWorklet.addModule(String(workletUrl));

	const createNode = nodeFactory || ((audioContext, name, options) => {
		if (typeof globalThis.AudioWorkletNode !== 'function') {
			throw new Error('AudioWorkletNode is not supported in this browser.');
		}
		return new globalThis.AudioWorkletNode(audioContext, name, options);
	});
	const source = context.createMediaStreamSource(stream);
	const nodeOptions = {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [normalizedChannelCount],
		processorOptions: { channelCount: normalizedChannelCount, chunkFrames, monitor, inputGain: currentInputGain },
	};
	if (discreteChannels) Object.assign(nodeOptions, {
		channelCount: normalizedChannelCount,
		channelCountMode: 'explicit',
		channelInterpretation: 'discrete',
	});
	const node = createNode(context, processorName, nodeOptions);
	source.connect(node);
	node.connect(context.destination);

	let state = 'ready';
	let disposed = false;
	let acceptingChunks = true;
	let pendingChunks = 0;
	let writeQueue = Promise.resolve();
	let writeError = null;
	let stopResolver = null;
	let stopRejecter = null;
	node.port.onmessage = (event) => handleMessage(event.data || {});
	node.port.start?.();

	const controller = {
		get state() { return state; },
		get pendingChunks() { return pendingChunks; },
		start,
		pause,
		resume,
		stop,
		setMonitoring(enabled) {
			node.port.postMessage({ type: 'monitor', enabled: Boolean(enabled) });
		},
		get inputGain() { return currentInputGain; },
		setInputGain(value) {
			if (disposed) throw new Error('The recording controller has been disposed.');
			currentInputGain = normalizeRecordingInputGain(value);
			node.port.postMessage({ type: 'input-gain', value: currentInputGain });
			return currentInputGain;
		},
		detach() {
			return dispose({ stopTracks: false });
		},
		dispose,
	};
	return controller;

	async function dispose({ stopTracks = true } = {}) {
		if (disposed) return;
		if (state === 'recording' || state === 'paused' || state === 'stopping') await stop().catch(() => {});
		disposed = true;
		state = 'disposed';
		node.port.onmessage = null;
		try { source.disconnect(); } catch { /* Already disconnected. */ }
		try { node.disconnect(); } catch { /* Already disconnected. */ }
		if (stopTracks) {
			for (const track of stream.getTracks?.() || []) track.stop();
		}
		onState?.(state);
	}

	function start({ startFrame, stopFrame } = {}) {
		if (disposed) throw new Error('The recording controller has been disposed.');
		if (state === 'recording' || state === 'stopping') throw new Error('Recording is already active.');
		acceptingChunks = true;
		writeError = null;
		state = 'recording';
		node.port.postMessage({ type: 'start', startFrame, stopFrame });
		onState?.(state);
	}

	function pause() {
		if (disposed) throw new Error('The recording controller has been disposed.');
		if (state !== 'recording') return false;
		state = 'paused';
		node.port.postMessage({ type: 'pause' });
		onState?.(state);
		return true;
	}

	function resume() {
		if (disposed) throw new Error('The recording controller has been disposed.');
		if (state !== 'paused') return false;
		state = 'recording';
		node.port.postMessage({ type: 'resume' });
		onState?.(state);
		return true;
	}

	function stop() {
		if (disposed || state === 'ready' || state === 'stopped') {
			return writeError ? Promise.reject(writeError) : writeQueue;
		}
		if (state === 'stopping') return new Promise((resolve, reject) => chainStopWaiter(resolve, reject));
		state = 'stopping';
		node.port.postMessage({ type: 'stop' });
		onState?.(state);
		return new Promise((resolve, reject) => {
			stopResolver = resolve;
			stopRejecter = reject;
		});
	}

	function chainStopWaiter(resolve, reject) {
		const previousResolve = stopResolver;
		const previousReject = stopRejecter;
		stopResolver = (value) => { previousResolve?.(value); resolve(value); };
		stopRejecter = (error) => { previousReject?.(error); reject(error); };
	}

	function handleMessage(message) {
		if (disposed) return;
		if (message.type === 'audio-chunk') {
			if (!acceptingChunks) return;
			pendingChunks += 1;
			if (pendingChunks > maxPendingChunks) {
				pendingChunks -= 1;
				acceptingChunks = false;
				const error = new Error('Recording storage could not keep up with the audio input.');
				writeError = error;
				onError?.(error);
				node.port.postMessage({ type: 'stop' });
				return;
			}
			const chunk = {
				frameStart: message.frameStart,
				frames: message.frames,
				channels: (message.channels || []).map((channel) => channel instanceof Float32Array ? channel : new Float32Array(channel)),
			};
			writeQueue = writeQueue.then(() => onChunk?.(chunk)).catch((error) => {
				acceptingChunks = false;
				writeError = error;
				onError?.(error);
				node.port.postMessage({ type: 'stop' });
			}).finally(() => { pendingChunks -= 1; });
		} else if (message.type === 'stopped') {
			writeQueue.then(() => {
				state = 'stopped';
				onState?.(state);
				if (writeError) stopRejecter?.(writeError);
				else stopResolver?.({ frame: message.frame });
				stopResolver = null;
				stopRejecter = null;
			});
		} else if (message.type === 'paused') {
			state = 'paused';
			onState?.(state);
		} else if (message.type === 'resumed') {
			state = 'recording';
			onState?.(state);
		}
	}
}

/**
 * Normalize the browser's software recording gain. Values are linear: 1 is
 * unity, 0 is silence, and 2 is approximately +6 dB. Keeping the range small
 * limits accidental monitor blasts while still allowing a modest boost.
 */
export function normalizeRecordingInputGain(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError('Recording input gain must be a finite number.');
	}
	return Math.max(RECORDING_INPUT_GAIN_MINIMUM, Math.min(RECORDING_INPUT_GAIN_MAXIMUM, value));
}

/** Normalize capture channels to Soundscaper's planar PCM limit. */
export function normalizeRecordingChannelCount(value) {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(RECORDING_CHANNEL_COUNT_MAXIMUM, Math.floor(value)));
}

/**
 * Keep hardware/display streams alive across controller lifetimes. The pool
 * owns every stream returned by its acquire methods and stops those tracks only
 * when a source is replaced, released, or the pool is disposed.
 */
export function createRecordingCapturePool(options = {}) {
	const requestHardware = options.requestHardwareInput || requestHardwareInput;
	const requestDisplay = options.requestDisplayInput || requestDisplayInput;
	const onChange = typeof options.onChange === 'function' ? options.onChange : null;
	const entries = new Map();
	const pending = new Map();
	const generations = new Map();
	let disposed = false;

	return {
		get size() { return entries.size; },
		get hasInputs() { return entries.size > 0; },
		acquireHardware,
		acquireDisplay,
		getHardware(deviceId) {
			return getLiveEntry(hardwareInputKey(deviceId), 'device')?.stream || null;
		},
		getDisplay() {
			return getLiveEntry(DISPLAY_INPUT_KEY, 'display')?.stream || null;
		},
		getSnapshot() {
			pruneEndedEntries();
			return [...entries.values()].map(snapshotEntry);
		},
		releaseHardware(deviceId) {
			return releaseEntry(hardwareInputKey(deviceId));
		},
		releaseDisplay() {
			return releaseEntry(DISPLAY_INPUT_KEY);
		},
		releaseAll,
		dispose() {
			disposed = true;
			return releaseAll();
		},
	};

	async function acquireHardware(deviceId, acquireOptions = {}) {
		if (disposed) throw new Error('The recording capture pool has been disposed.');
		const normalizedDeviceId = normalizeDeviceId(deviceId);
		const key = hardwareInputKey(normalizedDeviceId);
		const requestedChannels = normalizeRecordingChannelCount(acquireOptions.channelCount ?? 2);
		if (pending.has(key)) {
			await pending.get(key);
			return acquireHardware(normalizedDeviceId, acquireOptions);
		}
		const current = getLiveEntry(key, 'device');
		if (current && current.channelCount >= requestedChannels) return current.stream;
		const generation = generationFor(key);

		const acquisition = Promise.resolve().then(async () => {
			const stream = await requestHardware({ ...acquireOptions, deviceId: normalizedDeviceId, channelCount: requestedChannels });
			if (disposed || generation !== generationFor(key)) {
				stopStream(stream);
				throw new Error('The recording input was released while it was opening.');
			}
			if (!hasLiveTrack(stream, 'audio')) {
				stopStream(stream);
				throw new Error('The selected hardware input did not provide a live audio track.');
			}
			const channelCount = exposedAudioChannelCount(stream);
			const retained = getLiveEntry(key, 'device');
			if (retained && channelCount <= retained.channelCount && channelCount < requestedChannels) {
				stopStream(stream);
				return retained.stream;
			}
			setEntry(key, {
				key,
				kind: 'device',
				deviceId: normalizedDeviceId,
				stream,
				channelCount,
			});
			return stream;
		}).finally(() => pending.delete(key));
		pending.set(key, acquisition);
		return acquisition;
	}

	async function acquireDisplay(acquireOptions = {}) {
		if (disposed) throw new Error('The recording capture pool has been disposed.');
		if (pending.has(DISPLAY_INPUT_KEY)) return pending.get(DISPLAY_INPUT_KEY);
		const current = getLiveEntry(DISPLAY_INPUT_KEY, 'display');
		if (current) return current.stream;
		const generation = generationFor(DISPLAY_INPUT_KEY);

		const acquisition = Promise.resolve().then(async () => {
			const stream = await requestDisplay(acquireOptions);
			if (disposed || generation !== generationFor(DISPLAY_INPUT_KEY)) {
				stopStream(stream);
				throw new Error('The display input was released while it was opening.');
			}
			if (!hasLiveTrack(stream, 'audio')) {
				stopStream(stream);
				throw new Error('Display capture did not include a live audio track.');
			}
			if (!hasLiveTrack(stream, 'video')) {
				stopStream(stream);
				throw new Error('Display capture did not include its required live video track.');
			}
			setEntry(DISPLAY_INPUT_KEY, {
				key: DISPLAY_INPUT_KEY,
				kind: 'display',
				stream,
				channelCount: exposedAudioChannelCount(stream),
			});
			return stream;
		}).finally(() => pending.delete(DISPLAY_INPUT_KEY));
		pending.set(DISPLAY_INPUT_KEY, acquisition);
		return acquisition;
	}

	function getLiveEntry(key, kind) {
		const entry = entries.get(key);
		if (!entry) return null;
		const live = hasLiveTrack(entry.stream, 'audio') && (kind !== 'display' || hasLiveTrack(entry.stream, 'video'));
		if (live) return entry;
		removeEntry(key, entry, true);
		return null;
	}

	function setEntry(key, entry) {
		const previous = entries.get(key);
		entries.set(key, entry);
		for (const track of entry.stream.getTracks?.() || []) {
			track.addEventListener?.('ended', () => removeEntry(key, entry, true), { once: true });
		}
		if (previous && previous !== entry) stopStream(previous.stream);
		emitChange();
	}

	function releaseEntry(key) {
		const wasPending = pending.has(key);
		invalidate(key);
		const entry = entries.get(key);
		if (!entry) return wasPending;
		removeEntry(key, entry, true);
		return true;
	}

	function removeEntry(key, expected, stopTracks) {
		if (entries.get(key) !== expected) return false;
		entries.delete(key);
		if (stopTracks) stopStream(expected.stream);
		emitChange();
		return true;
	}

	function releaseAll() {
		const keys = new Set([...entries.keys(), ...pending.keys()]);
		const released = keys.size;
		for (const key of keys) invalidate(key);
		for (const entry of entries.values()) stopStream(entry.stream);
		entries.clear();
		if (released) emitChange();
		return released;
	}

	function pruneEndedEntries() {
		for (const [key, entry] of entries) {
			getLiveEntry(key, entry.kind);
		}
	}

	function emitChange() {
		onChange?.([...entries.values()].map(snapshotEntry));
	}

	function generationFor(key) {
		return generations.get(key) || 0;
	}

	function invalidate(key) {
		generations.set(key, generationFor(key) + 1);
	}
}

function snapshotEntry(entry) {
	return Object.freeze({
		key: entry.key,
		kind: entry.kind,
		...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
		channelCount: entry.channelCount,
		state: 'open',
	});
}

function exposedAudioChannelCount(stream) {
	let channelCount = 1;
	for (const track of stream?.getAudioTracks?.() || []) {
		channelCount = Math.max(channelCount, normalizeRecordingChannelCount(track.getSettings?.().channelCount));
	}
	return channelCount;
}

function hasLiveTrack(stream, kind) {
	const tracks = kind === 'audio' ? stream?.getAudioTracks?.() : stream?.getVideoTracks?.();
	return Boolean(tracks?.some((track) => track?.readyState !== 'ended'));
}

function stopStream(stream) {
	for (const track of stream?.getTracks?.() || []) track.stop?.();
}

function normalizeDeviceId(deviceId) {
	if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('A hardware device ID is required.');
	return deviceId;
}

function hardwareInputKey(deviceId) {
	return `${HARDWARE_INPUT_KEY_PREFIX}${normalizeDeviceId(deviceId)}`;
}

function getMediaDevices() {
	return globalThis.navigator?.mediaDevices;
}
