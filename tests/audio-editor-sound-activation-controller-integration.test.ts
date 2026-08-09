/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import type {
	EditorRecordingActions,
	EditorRecordingInputSnapshot,
} from '../src/common/editor/types.ts';

const assetLoader = `
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

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

interface MockTrack {
	readonly kind: string;
	readyState: string;
	stopCount: number;
	getSettings(): Readonly<Record<string, unknown>>;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
	stop(): void;
}

interface MockStream {
	getTracks(): MockTrack[];
	getAudioTracks(): MockTrack[];
	getVideoTracks(): MockTrack[];
}

interface CreatedRecorder {
	readonly stream: MockStream;
	readonly channelCount: number;
	readonly onChunk: (chunk: Readonly<{
		readonly frameStart: number;
		readonly frames: number;
		readonly channels: readonly Float32Array[];
	}>) => Promise<void>;
	startOptions?: Readonly<{ readonly startFrame?: number; readonly stopFrame?: number }>;
}

test('controller exposes disabled canonical policy and rolls back rejected durable preference updates', async () => {
	const store = createProjectStore({ databaseName: 'sound-activation-controller-preferences' });
	const controller = createAudioEditorController(null, {
		store,
		engine: createRecordingEngine(),
		ffmpeg: { dispose() {} },
	});

	try {
		await controller.ready;
		const recordingInputs: EditorRecordingInputSnapshot = controller.getSnapshot().recordingInputs;
		const publicRecordingActions: EditorRecordingActions = controller.actions.recording;
		assert.strictEqual(publicRecordingActions.soundActivation, controller.actions.recording.soundActivation);
		const initial = recordingInputs.soundActivation;
		assert.deepEqual(initial, {
			preferences: { enabled: false, thresholdDb: -40, hysteresisDb: 6, holdMilliseconds: 250 },
			preferenceMutationBlocked: false,
			preferenceMutationBlockReason: null,
			sources: [],
		});
		assert.equal(Object.isFrozen(initial), true);
		assert.equal(Object.isFrozen(initial.preferences), true);
		assert.equal(Object.isFrozen(initial.sources), true);

		const actions = soundActivationActions(controller);
		assert.equal(await actions.setEnabled(true), true);
		assert.equal(controller.getSnapshot().recordingInputs.soundActivation.preferences.enabled, true);

		const saveSetting = store.saveSetting.bind(store);
		store.saveSetting = async (key: string, value: unknown) => {
			if (key === 'soundscaper:audio-editor-preferences-v1') {
				throw new Error('authoritative settings unavailable');
			}
			return saveSetting(key, value);
		};
		await assert.rejects(actions.setThresholdDb(-24), /authoritative settings unavailable/u);
		const rolledBack = controller.getSnapshot().recordingInputs.soundActivation;
		assert.equal(rolledBack.preferences.thresholdDb, -40);
		assert.equal(rolledBack.preferenceMutationBlocked, false);
		const mirrored = await store.loadSetting('audio-editor-preferences-v1', null) as Readonly<{
			readonly recording: Readonly<{
				readonly soundActivation: Readonly<{ readonly thresholdDb: number }>;
			}>;
		}> | null;
		assert.equal(mirrored?.recording.soundActivation.thresholdDb, -40);
	} finally {
		await controller.dispose();
	}
});

test('legacy capture freezes policy settings and blocks mutation through active and finishing states', async () => {
	const store = createProjectStore({ databaseName: 'sound-activation-controller-legacy' });
	const input = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({ hardware: { default: input } });
	const created: CreatedRecorder[] = [];
	const abortStarted = deferred<void>();
	const finishGate = deferred<void>();
	const beginSourceWrite = store.beginSourceWrite.bind(store);
	store.beginSourceWrite = async (...args: Parameters<typeof beginSourceWrite>) => {
		const writer = await beginSourceWrite(...args);
		return new Proxy(writer, {
			get(target, name, receiver) {
				if (name === 'abort') return async () => {
					abortStarted.resolve();
					await finishGate.promise;
					return target.abort();
				};
				return Reflect.get(target, name, receiver);
			},
		});
	};
	const controller = createAudioEditorController(null, {
		store,
		engine: createRecordingEngine(),
		ffmpeg: { dispose() {} },
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(created),
	});

	try {
		await controller.ready;
		const actions = soundActivationActions(controller);
		await actions.setEnabled(true);
		await actions.setThresholdDb(-32);
		await actions.setHoldMilliseconds(125);
		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.start({ trackId });

		const active = controller.getSnapshot().recordingInputs.soundActivation;
		assert.equal(active.preferenceMutationBlockReason, 'recording-active');
		assert.deepEqual(active.sources.map(({ sourceKey, state, settings }: Readonly<{
			sourceKey: string;
			state: string;
			settings: unknown;
		}>) => ({ sourceKey, state, settings })), [{
			sourceKey: 'device:default',
			state: 'armed',
			settings: { thresholdDb: -32, hysteresisDb: 6, holdFrames: 6_000 },
		}]);
		const frozenSettings = active.sources[0].settings;
		assert.equal(Object.isFrozen(frozenSettings), true);
		assert.equal(await actions.setThresholdDb(-18), false);
		assert.strictEqual(
			controller.getSnapshot().recordingInputs.soundActivation.sources[0].settings,
			frozenSettings,
		);

		const stopping = controller.actions.recording.stop();
		await abortStarted.promise;
		const finishing = controller.getSnapshot().recordingInputs.soundActivation;
		assert.equal(finishing.preferenceMutationBlockReason, 'recording-finishing');
		assert.equal(await actions.setEnabled(false), false);
		finishGate.resolve();
		await stopping;
		assert.deepEqual(controller.getSnapshot().recordingInputs.soundActivation.sources, []);

		assert.equal(await actions.setThresholdDb(-18), true);
		await controller.actions.recording.start({ trackId });
		const nextSettings = controller.getSnapshot().recordingInputs.soundActivation.sources[0].settings;
		assert.notStrictEqual(nextSettings, frozenSettings);
		assert.equal(nextSettings.thresholdDb, -18);
		await controller.actions.project.create({ title: 'Replacement project' });
		assert.deepEqual(controller.getSnapshot().recordingInputs.soundActivation.sources, []);

		const replacementTrackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.start({ trackId: replacementTrackId });
		assert.equal(controller.getSnapshot().recordingInputs.soundActivation.sources.length, 1);
		await controller.dispose();
		assert.deepEqual(controller.getSnapshot().recordingInputs.soundActivation.sources, []);
	} finally {
		finishGate.resolve();
		await controller.dispose();
	}
});

test('scheduled and routed capture report guarded, isolated source state through the public snapshot', async () => {
	const store = createProjectStore({ databaseName: 'sound-activation-controller-routed' });
	const display = createMockStream([
		createMockTrack('audio', { channelCount: 1 }),
		createMockTrack('video'),
	]);
	const schedulingInput = deferred<MockStream>();
	let hardwareRequests = 0;
	const pool = createCapturePool({
		hardware: { 'mic-2': () => {
			hardwareRequests += 1;
			return hardwareRequests === 2
				? schedulingInput.promise
				: createMockStream([createMockTrack('audio', { channelCount: 1 })]);
		} },
		display,
	});
	const created: CreatedRecorder[] = [];
	const now = Date.UTC(2030, 0, 2, 3, 4, 5);
	const controller = createAudioEditorController(null, {
		store,
		engine: createRecordingEngine(),
		ffmpeg: { dispose() {} },
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(created),
		now: () => now,
		setTimeout: () => 73,
		clearTimeout() {},
	});

	try {
		await controller.ready;
		const actions = soundActivationActions(controller);
		await actions.setEnabled(true);
		const firstTrackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.setTrackInput(firstTrackId, {
			kind: 'device', deviceId: 'mic-2', channelStart: 0, channelCount: 1,
		});
		await controller.actions.recording.setRetainInputs(false);
		const scheduling = controller.actions.recording.schedule(now + 60_000, { trackId: firstTrackId });
		await Promise.resolve();
		assert.equal(
			controller.getSnapshot().recordingInputs.soundActivation.preferenceMutationBlockReason,
			'recording-scheduling',
		);
		assert.equal(await actions.setHoldMilliseconds(500), false);
		schedulingInput.resolve(createMockStream([createMockTrack('audio', { channelCount: 1 })]));
		await scheduling;
		assert.equal(
			controller.getSnapshot().recordingInputs.soundActivation.preferenceMutationBlockReason,
			'recording-prepared',
		);
		assert.equal(await actions.setHoldMilliseconds(500), false);
		assert.equal(controller.actions.recording.cancelScheduled(), true);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(controller.getSnapshot().recordingInputs.soundActivation.sources, []);
		await controller.actions.recording.setRetainInputs(true);

		const secondTrackId = controller.actions.track.add({ armed: true });
		await controller.actions.recording.setTrackInput(firstTrackId, {
			kind: 'display', deviceId: '', channelStart: 0, channelCount: 1,
		});
		await controller.actions.recording.setTrackInput(secondTrackId, {
			kind: 'device', deviceId: 'mic-2', channelStart: 0, channelCount: 1,
		});
		created.splice(0);
		await controller.actions.recording.start();
		assert.deepEqual(
			controller.getSnapshot().recordingInputs.soundActivation.sources.map(
				({ sourceKey, state }: Readonly<{ sourceKey: string; state: string }>) => [sourceKey, state],
			),
			[['device:mic-2', 'armed'], ['display', 'armed']],
		);

		const displayRecorder = created.find(({ stream }) => stream === display);
		assert.ok(displayRecorder?.startOptions?.startFrame != null);
		await displayRecorder.onChunk({
			frameStart: displayRecorder.startOptions.startFrame,
			frames: 2,
			channels: [Float32Array.of(0, 0.5)],
		});
		assert.deepEqual(
			controller.getSnapshot().recordingInputs.soundActivation.sources.map(
				({ sourceKey, state }: Readonly<{ sourceKey: string; state: string }>) => [sourceKey, state],
			),
			[['device:mic-2', 'armed'], ['display', 'capturing']],
		);
		await controller.actions.recording.stop();
		assert.deepEqual(controller.getSnapshot().recordingInputs.soundActivation.sources, []);
	} finally {
		schedulingInput.resolve(createMockStream([createMockTrack('audio', { channelCount: 1 })]));
		await controller.dispose();
	}
});

function soundActivationActions(controller: ReturnType<typeof createAudioEditorController>) {
	const group = controller.actions.recording.soundActivation;
	if (!group || typeof group !== 'object') throw new TypeError('Sound activation actions are unavailable.');
	for (const name of ['setEnabled', 'setThresholdDb', 'setHysteresisDb', 'setHoldMilliseconds']) {
		if (typeof group[name] !== 'function') throw new TypeError(`Missing sound activation action ${name}.`);
	}
	return group;
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function createRecordingControllerFactory(created: CreatedRecorder[]) {
	return async (value: CreatedRecorder) => {
		created.push(value);
		let state = 'ready';
		return {
			get state() { return state; },
			start(options: Readonly<{ readonly startFrame?: number; readonly stopFrame?: number }> = {}) {
				value.startOptions = Object.freeze({ ...options });
				state = 'recording';
			},
			pause() { if (state !== 'recording') return false; state = 'paused'; return true; },
			resume() { if (state !== 'paused') return false; state = 'recording'; return true; },
			async stop() { state = 'stopped'; },
			setMonitoring() {},
			setInputGain() {},
			async dispose() { state = 'disposed'; },
		};
	};
}

function createCapturePool({
	hardware,
	display = null,
}: {
	readonly hardware: Readonly<Record<string, MockStream | (() => MockStream | Promise<MockStream>)>>;
	readonly display?: MockStream | null;
}) {
	const open = new Map<string, MockStream>();
	let openDisplay: MockStream | null = null;
	return {
		async acquireHardware(deviceId: string) {
			const configured = hardware[deviceId];
			const stream = await (open.get(deviceId) ?? (
				typeof configured === 'function' ? configured() : configured
			));
			if (!stream) throw new Error(`Input ${deviceId} is unavailable.`);
			open.set(deviceId, stream);
			return stream;
		},
		async acquireDisplay() {
			if (!display) throw new Error('Display audio is unavailable.');
			openDisplay ??= display;
			return openDisplay;
		},
		getHardware: (deviceId: string) => open.get(deviceId) ?? null,
		getDisplay: () => openDisplay,
		getSnapshot: () => [
			...[...open].map(([deviceId, stream]) => ({
				key: `device:${deviceId}`, kind: 'device', deviceId,
				channelCount: stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1,
				state: 'open',
			})),
			...(openDisplay ? [{ key: 'display', kind: 'display', channelCount: 1, state: 'open' }] : []),
		],
		releaseHardware(deviceId: string) {
			const stream = open.get(deviceId);
			if (!stream) return false;
			stopStream(stream);
			open.delete(deviceId);
			return true;
		},
		releaseDisplay() {
			if (!openDisplay) return false;
			stopStream(openDisplay);
			openDisplay = null;
			return true;
		},
		releaseAll() {
			for (const stream of open.values()) stopStream(stream);
			open.clear();
			if (openDisplay) stopStream(openDisplay);
			openDisplay = null;
		},
		dispose() { this.releaseAll(); },
	};
}

function createRecordingEngine() {
	const listeners = new Map<string, () => void>();
	const context = {
		sampleRate: 48_000, currentTime: 4, baseLatency: 0, outputLatency: 0, state: 'running',
		async resume() { this.state = 'running'; },
		addEventListener(type: string, listener: () => void) { listeners.set(type, listener); },
		removeEventListener(type: string, listener: () => void) {
			if (listeners.get(type) === listener) listeners.delete(type);
		},
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; },
		createChannelSplitter() { return { connect() {}, disconnect() {} }; },
		createAnalyser() {
			return {
				fftSize: 256, smoothingTimeConstant: 0, connect() {}, disconnect() {},
				getFloatTimeDomainData(target: Float32Array) { target.fill(0); },
			};
		},
		createBuffer(channelCount: number, frameCount: number, sampleRate: number) {
			const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
			return {
				numberOfChannels: channelCount, length: frameCount, sampleRate,
				getChannelData: (channel: number) => channels[channel],
				copyToChannel: (values: Float32Array, channel: number, offset = 0) => channels[channel]?.set(values, offset),
			};
		},
	};
	let state = 'stopped';
	let positionFrame = 0;
	return {
		setSourceResolver() {}, loadProject() {}, async applyProject() {},
		getPositionFrames: () => positionFrame,
		getState: () => ({ state, loop: { enabled: false } }),
		getAudioContext: async () => context,
		setLoop() {}, seek(frame: number) { positionFrame = Math.max(0, Math.round(frame)); },
		async playAt() { state = 'playing'; }, play() { state = 'playing'; },
		pause() { state = 'paused'; }, stop() { state = 'stopped'; }, async dispose() {},
	};
}

function createMockTrack(kind: string, settings: Readonly<Record<string, unknown>> = {}): MockTrack {
	const listeners = new Map<string, Set<() => void>>();
	return {
		kind, readyState: 'live', stopCount: 0,
		getSettings: () => ({ ...settings }),
		addEventListener(type, listener) {
			const current = listeners.get(type) ?? new Set();
			current.add(listener);
			listeners.set(type, current);
		},
		removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
		stop() {
			if (this.readyState === 'ended') return;
			this.readyState = 'ended';
			this.stopCount += 1;
			for (const listener of listeners.get('ended') ?? []) listener();
		},
	};
}

function createMockStream(tracks: MockTrack[]): MockStream {
	return {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter(({ kind }) => kind === 'audio'),
		getVideoTracks: () => tracks.filter(({ kind }) => kind === 'video'),
	};
}

function stopStream(stream: MockStream): void {
	for (const track of stream.getTracks()) track.stop();
}
