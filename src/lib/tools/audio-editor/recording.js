const DEFAULT_PROCESSOR_NAME = 'kw-audio-recorder';
export const RECORDING_INPUT_GAIN_MINIMUM = 0;
export const RECORDING_INPUT_GAIN_MAXIMUM = 2;
export const RECORDING_INPUT_GAIN_DEFAULT = 1;

export async function requestMicrophone(constraints = { audio: true }) {
	const mediaDevices = globalThis.navigator?.mediaDevices;
	if (!mediaDevices?.getUserMedia) {
		throw new Error('Microphone recording is not supported in this browser.');
	}
	return mediaDevices.getUserMedia(constraints);
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
	nodeFactory,
} = {}) {
	if (!context?.audioWorklet?.addModule || !context?.createMediaStreamSource) {
		throw new Error('AudioWorklet recording is not supported by this AudioContext.');
	}
	if (!stream) throw new Error('A microphone MediaStream is required.');
	let currentInputGain = normalizeRecordingInputGain(inputGain);
	await context.audioWorklet.addModule(String(workletUrl));

	const createNode = nodeFactory || ((audioContext, name, options) => {
		if (typeof globalThis.AudioWorkletNode !== 'function') {
			throw new Error('AudioWorkletNode is not supported in this browser.');
		}
		return new globalThis.AudioWorkletNode(audioContext, name, options);
	});
	const source = context.createMediaStreamSource(stream);
	const node = createNode(context, processorName, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [Math.max(1, Math.min(2, channelCount))],
		processorOptions: { channelCount, chunkFrames, monitor, inputGain: currentInputGain },
	});
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

	return {
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
		async dispose({ stopTracks = true } = {}) {
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
		},
	};

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
