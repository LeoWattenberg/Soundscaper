/* SPDX-License-Identifier: AGPL-3.0-only */

// The recording controller fixtures the recording suites share: the mock media
// devices and streams a take is opened against, and the controller each test
// drives them through. Split out of audio-editor-recording-controller.test.js so
// its suites can sit in separate files.

import { register } from 'node:module';

export const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}

`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

export const { createAudioEditorController } = await import('../../src/common/editor/app.js');

export const { createRecordingCapturePool } = await import('../../src/common/editor/recording.js');

export const { createProjectStore } = await import('../../src/common/editor/storage.js');

export function createCapturePool({ hardware = {}, display = null, hardwareFailures = new Set() } = {}) {
	const hardwareEntries = new Map();
	let displayEntry = null;
	let disposed = false;
	const pool = {
		hardwareRequests: [],
		displayRequests: 0,
		async acquireHardware(deviceId, options = {}) {
			if (disposed) throw new Error('Capture pool is disposed.');
			pool.hardwareRequests.push({ deviceId, channelCount: options.channelCount });
			if (hardwareFailures.has(deviceId)) throw new Error(`Input ${deviceId} is unavailable.`);
			const configuredStream = hardware[deviceId];
			const stream = typeof configuredStream === 'function'
				? configuredStream(options, hardwareEntries.get(deviceId) || null)
				: hardwareEntries.get(deviceId) || configuredStream;
			if (!stream) throw new Error(`Input ${deviceId} is unavailable.`);
			hardwareEntries.set(deviceId, stream);
			return stream;
		},
		async acquireDisplay() {
			if (disposed) throw new Error('Capture pool is disposed.');
			if (!display) throw new Error('Display audio is unavailable.');
			if (!displayEntry) {
				pool.displayRequests += 1;
				displayEntry = display;
			}
			return displayEntry;
		},
		getHardware(deviceId) {
			return hardwareEntries.get(deviceId) || null;
		},
		getDisplay() {
			return displayEntry;
		},
		getSnapshot() {
			return [
				...[...hardwareEntries].map(([deviceId, stream]) => ({
					key: `device:${deviceId}`,
					kind: 'device',
					deviceId,
					channelCount: stream.getAudioTracks()[0]?.getSettings().channelCount || 1,
					state: 'open',
				})),
				...(displayEntry ? [{
					key: 'display',
					kind: 'display',
					channelCount: displayEntry.getAudioTracks()[0]?.getSettings().channelCount || 1,
					state: 'open',
				}] : []),
			];
		},
		releaseHardware(deviceId) {
			const stream = hardwareEntries.get(deviceId);
			if (!stream) return false;
			stopStream(stream);
			hardwareEntries.delete(deviceId);
			return true;
		},
		releaseDisplay() {
			if (!displayEntry) return false;
			stopStream(displayEntry);
			displayEntry = null;
			return true;
		},
		releaseAll() {
			const count = hardwareEntries.size + (displayEntry ? 1 : 0);
			for (const stream of hardwareEntries.values()) stopStream(stream);
			hardwareEntries.clear();
			if (displayEntry) stopStream(displayEntry);
			displayEntry = null;
			return count;
		},
		dispose() {
			disposed = true;
			return pool.releaseAll();
		},
	};
	return pool;
}

export function createRecordingControllerFactory(created) {
	return async (options) => {
		created.push(options);
		let state = 'ready';
		return {
			get state() { return state; },
			start(startOptions = {}) {
				options.startOptions = { ...startOptions };
				state = 'recording';
				options.onState?.(state);
			},
			pause() {
				if (state !== 'recording') return false;
				state = 'paused';
				options.onState?.(state);
				return true;
			},
			resume() {
				if (state !== 'paused') return false;
				state = 'recording';
				options.onState?.(state);
				return true;
			},
			async stop() {
				if (state === 'stopped' || state === 'disposed') return;
				state = 'stopped';
				options.onState?.(state);
			},
			setMonitoring() {},
			setInputGain() {},
			async dispose() {
				if (state === 'recording' || state === 'paused') await this.stop();
				state = 'disposed';
				options.onState?.(state);
			},
		};
	};
}

export function createRecordingEngine(options = {}) {
	const listeners = new Map();
	const context = {
		sampleRate: options.sampleRate || 48_000,
		currentTime: 0,
		baseLatency: options.baseLatency || 0,
		outputLatency: options.outputLatency || 0,
		state: 'running',
		async resume() { this.state = 'running'; },
		addEventListener(type, listener) { listeners.set(type, listener); },
		removeEventListener(type, listener) {
			if (listeners.get(type) === listener) listeners.delete(type);
		},
		createBuffer(channelCount, frameCount, sampleRate) {
			const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
			return {
				numberOfChannels: channelCount,
				length: frameCount,
				sampleRate,
				getChannelData: (channel) => channels[channel],
				copyToChannel: (values, channel, offset = 0) => channels[channel].set(values, offset),
			};
		},
		createMediaStreamSource(stream) {
			options.onMediaStreamSource?.(stream);
			return {
				connect() {},
				disconnect() {},
			};
		},
		createChannelSplitter(channelCount) {
			options.onChannelSplitter?.(channelCount);
			return {
				connect(_target, output) {
					options.onChannelSplitConnect?.(output);
				},
				disconnect() {},
			};
		},
		createAnalyser() {
			return {
				fftSize: 256,
				smoothingTimeConstant: 0,
				connect() {},
				disconnect() {},
				getFloatTimeDomainData(target) {
					target.set(options.meterSamples || new Float32Array(target.length));
				},
			};
		},
	};
	return {
		state: 'stopped',
		positionFrame: 0,
		playCalls: 0,
		playAtCalls: [],
		setSourceResolver() {},
		loadProject() {},
		async applyProject() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		async getAudioContext() {
			return typeof options.getAudioContext === 'function'
				? options.getAudioContext(context)
				: context;
		},
		setLoop() {},
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); },
		async playAt(contextTime, fromFrame) {
			this.playAtCalls.push({ contextTime, fromFrame });
			this.state = 'playing';
		},
		play() {
			this.playCalls += 1;
			this.state = 'playing';
		},
		pause() { this.state = 'paused'; },
		stop() { this.state = 'stopped'; },
		async dispose() {},
	};
}

export function createMockTrack(kind, settings = {}, options = {}) {
	const listeners = new Map();
	return {
		kind,
		readyState: 'live',
		stopCount: 0,
		getSettings: () => ({ ...settings }),
		addEventListener(type, listener) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(listener);
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
		stop() {
			if (this.readyState === 'ended') return;
			this.readyState = 'ended';
			this.stopCount += 1;
			if (options.emitEndedOnStop !== false) {
				for (const listener of [...(listeners.get('ended') || [])]) listener({ type: 'ended', target: this });
			}
		},
	};
}

export function createMockStream(tracks) {
	return {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
		getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
	};
}

export function stopStream(stream) {
	for (const track of stream.getTracks()) track.stop();
}

export function createFfmpegStub() {
	return { dispose() {} };
}
