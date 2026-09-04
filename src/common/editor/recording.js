import { soundscaperNativeAudioCaptureSource, subscribeSoundscaperNativeAudioCaptureLoss } from './soundscaper-native-audio-capture.ts';
import {
	RECORDING_INPUT_GAIN_DEFAULT,
	normalizeRecordingChannelCount,
	normalizeRecordingInputGain,
} from './recording-inputs.js';

export { createRecordingCapturePool } from './recording-capture-pool.js';
export {
	RECORDING_CHANNEL_COUNT_MAXIMUM,
	RECORDING_INPUT_GAIN_DEFAULT,
	RECORDING_INPUT_GAIN_MAXIMUM,
	RECORDING_INPUT_GAIN_MINIMUM,
	normalizeRecordingChannelCount,
	normalizeRecordingInputGain,
	requestDisplayInput,
	requestHardwareInput,
	requestMicrophone,
} from './recording-inputs.js';

const DEFAULT_PROCESSOR_NAME = 'kw-audio-recorder';
const recordingWorkletLoads = new WeakMap();

/** Set up a bounded, serialized microphone -> AudioWorklet recording pipeline. */
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
	stopTimeoutMs = 2_000,
	setTimeout: setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
	clearTimeout: clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
} = {}) {
	if (!stream) throw new Error('An audio MediaStream is required.');
	const nativeSource = soundscaperNativeAudioCaptureSource(stream, context);
	if (!context?.audioWorklet?.addModule || (!nativeSource && !context?.createMediaStreamSource)) {
		throw new Error('AudioWorklet recording is not supported by this AudioContext.');
	}
	const normalizedChannelCount = normalizeRecordingChannelCount(channelCount);
	let currentInputGain = normalizeRecordingInputGain(inputGain);
	const normalizedStopTimeoutMs = normalizeRecordingStopTimeout(stopTimeoutMs);
	await loadRecordingWorklet(context, workletUrl);

	const createNode = nodeFactory || ((audioContext, name, options) => {
		if (typeof globalThis.AudioWorkletNode !== 'function') {
			throw new Error('AudioWorkletNode is not supported in this browser.');
		}
		return new globalThis.AudioWorkletNode(audioContext, name, options);
	});
	const source = nativeSource || context.createMediaStreamSource(stream);
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
	let disposing = false;
	let acceptingChunks = true;
	let pendingChunks = 0;
	let writeQueue = Promise.resolve();
	let writeError = null;
	let stopRequest = null;
	let disposePromise = null;
	node.port.onmessage = (event) => handleMessage(event.data || {});
	node.port.onmessageerror = (event) => failRecording(
		event?.error || new Error('The recording worklet sent an unreadable message.'),
	);
	node.onprocessorerror = (event) => failRecording(
		event?.error || new Error('The recording worklet stopped unexpectedly.'),
	);
	node.port.start?.();
	const unsubscribeNativeLoss = nativeSource
		? subscribeSoundscaperNativeAudioCaptureLoss(stream, () => {
			if (state === 'recording' || state === 'paused') void beginStop().catch(() => undefined);
		})
		: () => undefined;

	const controller = {
		get state() { return state; },
		get pendingChunks() { return pendingChunks; },
		start,
		pause,
		resume,
		stop,
		setMonitoring(enabled) {
			assertMutable();
			node.port.postMessage({ type: 'monitor', enabled: Boolean(enabled) });
		},
		get inputGain() { return currentInputGain; },
		setInputGain(value) {
			assertMutable();
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

	function dispose({ stopTracks = true } = {}) {
		if (disposePromise) return disposePromise;
		const shouldStop = state === 'recording' || state === 'paused' || state === 'stopping';
		const completion = shouldStop
			? beginStop()
			: state === 'failed' && writeError
				? Promise.reject(writeError)
				: writeQueue;
		disposing = true;
		state = 'disposing';
		notifyState();
		disposePromise = (async () => {
			let failure = null;
			try {
				await completion;
			} catch (error) {
				failure = error;
			} finally {
				disposed = true;
				acceptingChunks = false;
				if (stopRequest?.timer != null && typeof clearTimeoutFn === 'function') {
					clearTimeoutFn(stopRequest.timer);
					stopRequest.timer = null;
				}
				node.port.onmessage = null;
				node.port.onmessageerror = null;
				node.onprocessorerror = null;
				unsubscribeNativeLoss();
				try { nativeSource ? source.disconnect(node) : source.disconnect(); } catch { /* Already disconnected. */ }
				try { node.disconnect(); } catch { /* Already disconnected. */ }
				if (stopTracks) {
					for (const track of stream.getTracks?.() || []) {
						try { track.stop(); } catch { /* A track may already have ended. */ }
					}
				}
				state = 'disposed';
				notifyState();
			}
			if (failure) throw failure;
		})();
		return disposePromise;
	}

	function start({ startFrame, stopFrame } = {}) {
		assertMutable();
		if (state === 'recording' || state === 'stopping') throw new Error('Recording is already active.');
		acceptingChunks = true;
		writeError = null;
		stopRequest = null;
		state = 'recording';
		try {
			node.port.postMessage({ type: 'start', startFrame, stopFrame });
		} catch (error) {
			failRecording(error);
			throw error;
		}
		notifyState();
	}

	function pause() {
		assertMutable();
		if (state !== 'recording') return false;
		try {
			node.port.postMessage({ type: 'pause' });
		} catch (error) {
			failRecording(error);
			throw error;
		}
		state = 'paused';
		notifyState();
		return true;
	}

	function resume() {
		assertMutable();
		if (state !== 'paused') return false;
		try {
			node.port.postMessage({ type: 'resume' });
		} catch (error) {
			failRecording(error);
			throw error;
		}
		state = 'recording';
		notifyState();
		return true;
	}

	function stop() {
		if (disposed || state === 'ready' || state === 'stopped') {
			return writeError ? Promise.reject(writeError) : writeQueue;
		}
		if (disposing) return stopRequest?.promise || Promise.reject(writeError || new Error('The recording controller is being disposed.'));
		if (state === 'failed') return Promise.reject(writeError || new Error('The recording worklet failed.'));
		return beginStop();
	}

	function beginStop() {
		if (stopRequest) return stopRequest.promise;
		let resolve;
		let reject;
		const promise = new Promise((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		stopRequest = { promise, resolve, reject, settled: false, timer: null };
		state = 'stopping';
		notifyState();
		if (typeof setTimeoutFn === 'function') {
			stopRequest.timer = setTimeoutFn(() => {
				const error = new Error(`The recording worklet did not stop within ${normalizedStopTimeoutMs} milliseconds.`);
				error.name = 'TimeoutError';
				error.code = 'RECORDING_STOP_TIMEOUT';
				failRecording(error);
			}, normalizedStopTimeoutMs);
		}
		try {
			node.port.postMessage({ type: 'stop' });
		} catch (error) {
			failRecording(error);
		}
		return promise;
	}

	function handleMessage(message) {
		if (disposed) return;
		if (message.type === 'audio-chunk') {
			if (!acceptingChunks) return;
			pendingChunks += 1;
			if (pendingChunks > maxPendingChunks) {
				pendingChunks -= 1;
				const error = new Error('Recording storage could not keep up with the audio input.');
				acceptingChunks = false;
				writeError = error;
				try { onError?.(error); } catch { /* Error observers cannot block cleanup. */ }
				try { node.port.postMessage({ type: 'stop' }); } catch { /* Failure is already recorded. */ }
				return;
			}
			const chunk = {
				frameStart: message.frameStart,
				frames: message.frames,
				channels: (message.channels || []).map((channel) => channel instanceof Float32Array ? channel : new Float32Array(channel)),
			};
			writeQueue = writeQueue.then(() => onChunk?.(chunk)).catch((error) => {
				failRecording(error);
				try { node.port.postMessage({ type: 'stop' }); } catch { /* Failure is already recorded. */ }
			}).finally(() => { pendingChunks -= 1; });
		} else if (message.type === 'stopped') {
			acceptingChunks = false;
			if (stopRequest?.timer != null && typeof clearTimeoutFn === 'function') clearTimeoutFn(stopRequest.timer);
			if (stopRequest) stopRequest.timer = null;
			writeQueue.then(() => {
				if (!disposing) { state = 'stopped'; notifyState(); }
				if (writeError) settleStop(writeError);
				else settleStop(null, { frame: message.frame });
			});
		} else if (message.type === 'paused' && !disposing) {
			state = 'paused';
			notifyState();
		} else if (message.type === 'resumed' && !disposing) {
			state = 'recording';
			notifyState();
		}
	}

	function failRecording(error) {
		if (disposed) return;
		const failure = error instanceof Error ? error : new Error(String(error));
		const firstFailure = writeError == null;
		if (firstFailure) writeError = failure;
		acceptingChunks = false;
		if (!disposing) {
			state = 'failed';
			notifyState();
		}
		if (firstFailure) {
			try { onError?.(writeError); } catch { /* Error observers cannot block cleanup. */ }
		}
		settleStop(writeError);
	}

	function settleStop(error, result) {
		if (!stopRequest || stopRequest.settled) return;
		stopRequest.settled = true;
		if (stopRequest.timer != null && typeof clearTimeoutFn === 'function') clearTimeoutFn(stopRequest.timer);
		stopRequest.timer = null;
		if (error) stopRequest.reject(error);
		else stopRequest.resolve(result);
	}

	function assertMutable() {
		if (disposed || disposing) throw new Error('The recording controller has been disposed.');
		if (state === 'failed') throw writeError || new Error('The recording worklet failed.');
	}

	function notifyState() {
		try {
			onState?.(state);
		} catch (error) {
			try { onError?.(error); } catch { /* State observers cannot block cleanup. */ }
		}
	}
}

function normalizeRecordingStopTimeout(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > 60_000) {
		throw new RangeError('Recording stopTimeoutMs must be between 1 and 60000 milliseconds.');
	}
	return number;
}

async function loadRecordingWorklet(context, workletUrl) {
	const url = String(workletUrl);
	let contextLoads = recordingWorkletLoads.get(context);
	if (!contextLoads) {
		contextLoads = new Map();
		recordingWorkletLoads.set(context, contextLoads);
	}
	let load = contextLoads.get(url);
	if (!load) {
		load = Promise.resolve().then(() => context.audioWorklet.addModule(url));
		contextLoads.set(url, load);
	}
	try {
		await load;
	} catch (error) {
		if (contextLoads.get(url) === load) contextLoads.delete(url);
		if (!contextLoads.size) recordingWorkletLoads.delete(context);
		throw error;
	}
}
