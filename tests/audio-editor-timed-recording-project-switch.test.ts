/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type {
	RecordingCaptureChunk,
	RecordingControllerFactoryOptions,
} from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

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
const { createRecordingCapturePool } = await import('../src/common/editor/recording.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

interface MockTrack {
	readonly kind: string;
	readyState: string;
	stopCount: number;
	getSettings(): Readonly<{ readonly channelCount: number }>;
	addEventListener(type: 'ended', listener: () => void, options?: AddEventListenerOptions): void;
	removeEventListener(type: 'ended', listener: () => void): void;
	stop(): void;
}

interface MockStream {
	getTracks(): readonly MockTrack[];
	getAudioTracks(): readonly MockTrack[];
	getVideoTracks(): readonly MockTrack[];
}

interface CreatedRecorder extends Pick<RecordingControllerFactoryOptions, 'onChunk'> {
	startCalls: number;
	stopCalls: number;
	startOptions: Readonly<{ readonly startFrame?: number; readonly stopFrame?: number }> | null;
}

test('switching project cancels a prepared timer without leaking capture into either project', async () => {
	const store = createProjectStore({ databaseName: 'recording-timer-project-switch' });
	const clock = { now: Date.UTC(2030, 0, 2, 3, 4, 5) };
	const timers = new ControlledTimers();
	const openedTracks: MockTrack[] = [];
	const pool = createRecordingCapturePool({
		requestHardwareInput: () => {
			const track = createMockTrack();
			openedTracks.push(track);
			return Promise.resolve(createMockStream(track));
		},
	});
	const recorders: CreatedRecorder[] = [];
	const controller = createAudioEditorController(null, {
		store,
		engine: createRecordingEngine(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(recorders),
		now: () => clock.now,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		const firstProjectId = requiredProject(controller).id;
		const firstTrackId = requiredFirstTrackId(controller);
		const firstStartMs = clock.now + 10_000;
		await controller.actions.recording.schedule(firstStartMs, { trackId: firstTrackId });
		const staleTimer = timers.latest();

		assert.equal(staleTimer.delay, 10_000);
		assert.equal(recorders.length, 1);
		assert.equal(recorders[0]!.startCalls, 1, 'the first take is prepared before its deadline');
		assert.equal(openedTracks[0]!.stopCount, 0);
		assert.equal(controller.getSnapshot().recording, false);

		await controller.actions.project.create({ title: 'Timer destination guard' });
		const secondProjectId = requiredProject(controller).id;
		assert.notEqual(secondProjectId, firstProjectId);
		assert.equal(staleTimer.cleared, true);
		assert.equal(openedTracks[0]!.stopCount, 1, 'switching releases the prepared input');
		assert.equal(recorders[0]!.stopCalls, 1, 'switching joins the prepared recorder stop');
		assert.equal(pool.size, 0);

		clock.now = firstStartMs;
		await timers.invokeEvenIfCleared(staleTimer.id);
		assert.equal(recorders.length, 1, 'a stale deadline cannot create another recorder');
		assert.equal(recorders[0]!.startCalls, 1, 'a stale deadline cannot restart the prepared recorder');
		assert.equal(controller.getSnapshot().recording, false);
		assert.equal(requiredProject(controller).clips.length, 0);
		assert.equal(clipCount(await store.loadProject(firstProjectId)), 0);
		assert.equal((await store.listSources()).length, 0);

		const secondTrackId = requiredFirstTrackId(controller);
		const secondStartMs = clock.now + 5_000;
		await controller.actions.recording.schedule(secondStartMs, { trackId: secondTrackId });
		const liveTimer = timers.latest();
		assert.equal(liveTimer.delay, 5_000);
		assert.equal(openedTracks.length, 2, 'a later timer opens a fresh input');
		assert.equal(openedTracks[1]!.stopCount, 0);

		clock.now = secondStartMs;
		await timers.invoke(liveTimer.id);
		assert.equal(controller.getSnapshot().recording, true);
		const activeRecorder = recorders[1]!;
		assert.ok(activeRecorder.startOptions);
		await activeRecorder.onChunk(captureChunk(activeRecorder.startOptions.startFrame ?? 0));
		await controller.actions.recording.stop();

		assert.equal(requiredProject(controller).id, secondProjectId);
		assert.equal(requiredProject(controller).clips.length, 1, 'the later schedule remains usable');
		assert.equal(clipCount(await store.loadProject(firstProjectId)), 0);
	} finally {
		await controller.dispose();
	}
});

class ControlledTimers {
	readonly #entries: ScheduledTimer[] = [];
	#nextId = 1;

	readonly setTimeout = (callback: () => void, delay: number): number => {
		const entry: ScheduledTimer = {
			id: this.#nextId,
			callback,
			delay,
			cleared: false,
		};
		this.#nextId += 1;
		this.#entries.push(entry);
		return entry.id;
	};

	readonly clearTimeout = (id: number): void => {
		const entry = this.#entries.find((candidate) => candidate.id === id);
		if (entry) entry.cleared = true;
	};

	latest(): ScheduledTimer {
		const entry = this.#entries.at(-1);
		assert.ok(entry);
		return entry;
	}

	async invoke(id: number): Promise<void> {
		const entry = this.#required(id);
		assert.equal(entry.cleared, false);
		await invokeTimer(entry.callback);
	}

	async invokeEvenIfCleared(id: number): Promise<void> {
		await invokeTimer(this.#required(id).callback);
	}

	#required(id: number): ScheduledTimer {
		const entry = this.#entries.find((candidate) => candidate.id === id);
		assert.ok(entry);
		return entry;
	}
}

interface ScheduledTimer {
	readonly id: number;
	readonly callback: () => void;
	readonly delay: number;
	cleared: boolean;
}

async function invokeTimer(callback: () => void): Promise<void> {
	const result: unknown = callback();
	if (isPromiseLike(result)) await result;
	await Promise.resolve();
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return value !== null && (typeof value === 'object' || typeof value === 'function')
		&& 'then' in value && typeof value.then === 'function';
}

function createRecordingControllerFactory(created: CreatedRecorder[]) {
	return async (options: RecordingControllerFactoryOptions) => {
		const value: CreatedRecorder = {
			onChunk: options.onChunk,
			startCalls: 0,
			stopCalls: 0,
			startOptions: null,
		};
		created.push(value);
		let state = 'ready';
		return {
			get state() { return state; },
			start(startOptions: Readonly<{ readonly startFrame?: number; readonly stopFrame?: number }> = {}) {
				value.startCalls += 1;
				value.startOptions = Object.freeze({ ...startOptions });
				state = 'recording';
				options.onState(state);
			},
			pause() { if (state !== 'recording') return false; state = 'paused'; return true; },
			resume() { if (state !== 'paused') return false; state = 'recording'; return true; },
			async stop() {
				if (state === 'stopped' || state === 'disposed') return;
				value.stopCalls += 1;
				state = 'stopped';
				options.onState(state);
			},
			setMonitoring() {},
			setInputGain() {},
			async dispose() { state = 'disposed'; options.onState(state); },
		};
	};
}

function createRecordingEngine() {
	const context = Object.assign(new MockAudioContext({ sampleRate: 48_000 }), {
		currentTime: 4,
		baseLatency: 0,
		outputLatency: 0,
		addEventListener() {},
		removeEventListener() {},
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; },
		createChannelSplitter() { return { connect() {}, disconnect() {} }; },
	});
	return createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
		offlineAudioContextFactory: null,
	});
}

function createMockTrack(): MockTrack {
	const listeners = new Set<() => void>();
	return {
		kind: 'audio',
		readyState: 'live',
		stopCount: 0,
		getSettings: () => ({ channelCount: 1 }),
		addEventListener(_type, listener) { listeners.add(listener); },
		removeEventListener(_type, listener) { listeners.delete(listener); },
		stop() {
			if (this.readyState === 'ended') return;
			this.readyState = 'ended';
			this.stopCount += 1;
			for (const listener of listeners) listener();
		},
	};
}

function createMockStream(track: MockTrack): MockStream {
	return {
		getTracks: () => [track],
		getAudioTracks: () => [track],
		getVideoTracks: () => [],
	};
}

function captureChunk(frameStart: number): RecordingCaptureChunk {
	return {
		frameStart,
		frames: 4,
		channels: [Float32Array.of(0.25, -0.25, 0.5, -0.5)],
	};
}

function requiredProject(controller: ReturnType<typeof createAudioEditorController>) {
	const project = controller.getSnapshot().project;
	assert.ok(project);
	return project;
}

function requiredFirstTrackId(controller: ReturnType<typeof createAudioEditorController>): string {
	const tracks = requiredProject(controller).tracks;
	assert.ok(Array.isArray(tracks));
	const track: unknown = tracks[0];
	assert.ok(track && typeof track === 'object' && 'id' in track && typeof track.id === 'string');
	return track.id;
}

function clipCount(value: unknown): number {
	assert.ok(value && typeof value === 'object' && 'clips' in value);
	assert.ok(Array.isArray(value.clips));
	return value.clips.length;
}
