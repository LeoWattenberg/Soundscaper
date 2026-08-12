/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTakeCycleRoutedCaptureService,
	type TakeCycleRoutedCaptureRuntime,
} from '../src/common/editor/controller/take-cycle-routed-capture-service.ts';
import type { TakeCycleCapturePcmSpan } from '../src/common/editor/controller/take-cycle-capture-spool.ts';
import type {
	TakeCycleLiveCaptureSession,
	TakeCycleLiveLaneCapture,
} from '../src/common/editor/controller/take-cycle-live-capture-session.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording-transaction-types.ts';

test('routed cycle capture pre-registers per-track groups then resamples into exact loop-grid spans', async () => {
	const fixture = captureFixture({ captureSampleRate: 44_100 });
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	const started = await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);

	assert.equal(started.publicationGeneration, 17);
	assert.deepEqual(started.lanes.map(({ trackId, groupId }) => ({ trackId, groupId })), [
		{ trackId: 'track-a', groupId: 'group-track-a' },
		{ trackId: 'track-b', groupId: 'group-track-b' },
	]);
	assert.equal(new Set(started.lanes.map(({ laneId }) => laneId)).size, 2);
	assert.deepEqual(fixture.events.slice(0, 5), [
		'begin-session', 'begin-lane:track-a', 'begin-lane:track-b', 'create-recorder', 'play',
	]);
	assert.ok(fixture.events.indexOf('begin-lane:track-b') < fixture.events.indexOf('create-recorder'));
	assert.deepEqual(fixture.loopCalls, [{ enabled: true, startFrame: 100, endFrame: 500 }]);
	assert.deepEqual(fixture.seekCalls, [100]);
	assert.deepEqual(fixture.startOptions, [{ startFrame: 165_287 }]);
	assert.deepEqual(fixture.storageRequests, [{
		requiredBytes: 48_000 * 2 * Float32Array.BYTES_PER_ELEMENT * 60,
		operation: 'take-cycle-recording',
	}]);

	const recorder = fixture.recorderOptions[0]!;
	await recorder.onChunk(chunk(0, 441, 0.25, -0.5));
	await recorder.onChunk(chunk(441, 441, 0.5, -0.25));
	const result = await service.stop();

	assert.equal(result.publicationGeneration, 17);
	assert.deepEqual(result.lanes.map(({ trackId, status }) => ({ trackId, status })), [
		{ trackId: 'track-a', status: 'committed' },
		{ trackId: 'track-b', status: 'committed' },
	]);
	for (const trackId of ['track-a', 'track-b']) {
		const spans = fixture.lanes.get(trackId)!.spans;
		assert.equal(spans.reduce((total, span) => total + span.channels[0]!.length, 0), 960);
		assert.equal(spans[0]?.startSample, 100);
		assert.equal(spans.at(-1)?.endSample, 1_060);
		assert.deepEqual(gridBoundaries(spans, 100, 400), [500, 900]);
		assert.equal(spans.every((span) => sameLoopCell(span.startSample, span.endSample, 100, 400)), true);
	}
	assert.ok(fixture.events.indexOf('stop-recorder') < fixture.events.indexOf('dispose-recorder'));
	assert.ok(fixture.events.indexOf('dispose-recorder') < fixture.events.indexOf('seal:track-a'));
	assert.ok(fixture.events.indexOf('seal:track-a') < fixture.events.indexOf('finalize'));
	assert.ok(fixture.events.indexOf('seal:track-b') < fixture.events.indexOf('finalize'));
	assert.ok(fixture.events.indexOf('finalize') < fixture.events.indexOf('activate'));
	assert.equal(fixture.pauseCalls(), 1);
	assert.deepEqual(fixture.preflightBytes, [
		48_000 * 2 * Float32Array.BYTES_PER_ELEMENT * 60,
	]);
});

test('project-rate storage refusal happens before durable session or lane registration', async () => {
	const fixture = captureFixture({
		captureSampleRate: 44_100,
		projectSampleRate: 192_000,
		preflightError: new Error('insufficient project-rate storage'),
	});
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	await assert.rejects(
		service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope),
		/insufficient project-rate storage/u,
	);
	assert.deepEqual(fixture.preflightBytes, [
		192_000 * 2 * Float32Array.BYTES_PER_ELEMENT * 60,
	]);
	assert.equal(fixture.events.includes('begin-session'), false);
	assert.equal(fixture.lanes.size, 0);
});

test('durable project-rate storage refusal precedes live registration when capture rate differs', async () => {
	const refusal = new Error('insufficient point-in-time storage');
	const fixture = captureFixture({
		tracks: ['track-a'], captureSampleRate: 44_100, preflightError: refusal,
	});
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);

	await assert.rejects(service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope), refusal);
	assert.deepEqual(fixture.storageRequests, [{
		requiredBytes: 48_000 * Float32Array.BYTES_PER_ELEMENT * 60,
		operation: 'take-cycle-recording',
	}]);
	assert.equal(fixture.events.includes('begin-session'), false);
	assert.equal(fixture.lanes.size, 0);
	assert.equal(fixture.releaseCalls(), 1);
});

test('a second exact-loop recording reuses its existing group before durable capture starts', async () => {
	const fixture = captureFixture({
		tracks: ['track-a'],
		takeGroups: [{
			id: 'existing-cycle', sequenceId: 'main-sequence', trackId: 'track-a',
			startSample: 100, endSample: 500,
		}],
	});
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	const started = await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);

	assert.equal(started.lanes[0]?.groupId, 'existing-cycle');
	assert.equal(fixture.groupIdCalls(), 0);
	await service.stop();
});

test('a nonmatching loop extent cannot overlap an existing take group', async () => {
	const fixture = captureFixture({
		tracks: ['track-a'],
		takeGroups: [{
			id: 'existing-cycle', sequenceId: 'main-sequence', trackId: 'track-a',
			startSample: 50, endSample: 200,
		}],
	});
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);

	await assert.rejects(
		service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope),
		/overlaps take group existing-cycle with a different extent/u,
	);
	assert.equal(fixture.groupIdCalls(), 0);
	assert.equal(fixture.inputRequests(), 0);
});

test('V17 identity admission accepts the exact boundary and refuses one identity beyond it before input I/O', async () => {
	for (const [laneCount, accepted] of [[4_091, true], [4_092, false]] as const) {
		const fixture = captureFixture({
			tracks: ['track-a'],
			takeGroups: [{
				id: 'nonoverlapping', sequenceId: 'main-sequence', trackId: 'track-a',
				startSample: 600, endSample: 700,
				lanes: Array.from({ length: laneCount }, (_, index) => ({ id: `old-lane-${String(index)}` })),
			}],
		});
		const service = createTakeCycleRoutedCaptureService(fixture.runtime);
		if (accepted) {
			await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
			assert.equal(fixture.inputRequests(), 1);
			await service.stop();
		} else {
			await assert.rejects(
				service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope),
				/exceeds the V17 take\/comp identity capacity/u,
			);
			assert.equal(fixture.inputRequests(), 0);
			assert.equal(fixture.events.length, 0);
		}
	}
});

test('capture refuses the first pass beyond its admitted V17 identity capacity', async () => {
	const fixture = captureFixture({
		tracks: ['track-a'],
		takeGroups: [{
			id: 'nonoverlapping', sequenceId: 'main-sequence', trackId: 'track-a',
			startSample: 600, endSample: 700,
			lanes: Array.from({ length: 4_089 }, (_, index) => ({ id: `old-lane-${String(index)}` })),
		}],
	});
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);

	await fixture.recorderOptions[0]!.onChunk(chunk(0, 1_200, 0.25));
	const result = await service.stop();
	assert.equal(result.lanes[0]?.status, 'failed');
	assert.match(String(result.lanes[0]?.error), /exceeds the V17 take\/comp identity capacity/u);
	await waitFor(() => fixture.releaseCalls() === 1);
	assert.equal(fixture.lanes.get('track-a')?.discardCalls, 1);
	assert.equal(fixture.events.includes('finalize'), false);
});

test('callbacks are serialized with backpressure and stop awaits the in-flight append before flush and seal', async () => {
	const firstAppend = deferred<void>();
	const fixture = captureFixture({
		tracks: ['track-a'],
		append: async (_trackId, call) => {
			if (call === 1) await firstAppend.promise;
		},
	});
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
	const recorder = fixture.recorderOptions[0]!;
	const first = recorder.onChunk(chunk(0, 4, 0.25));
	const second = recorder.onChunk(chunk(4, 4, 0.5));
	await Promise.resolve();
	assert.equal(fixture.lanes.get('track-a')?.appendCalls, 1);

	const stopping = service.stop();
	await Promise.resolve();
	assert.equal(fixture.events.includes('seal:track-a'), false);
	firstAppend.resolve();
	await Promise.all([first, second, stopping]);

	assert.equal(fixture.lanes.get('track-a')?.appendCalls, 2);
	assert.ok(fixture.events.indexOf('append:track-a:2') < fixture.events.indexOf('seal:track-a'));
});

test('one routed lane write failure is durably discarded while the other lane continues and commits', async () => {
	const failure = new Error('track-a spool unavailable');
	const fixture = captureFixture({
		append: async (trackId, call) => {
			if (trackId === 'track-a' && call === 1) throw failure;
		},
	});
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
	const recorder = fixture.recorderOptions[0]!;
	await recorder.onChunk(chunk(0, 4, 0.25, -0.25));
	await recorder.onChunk(chunk(4, 4, 0.5, -0.5));
	const result = await service.stop();

	assert.equal(fixture.lanes.get('track-a')?.discardCalls, 1);
	assert.equal(fixture.lanes.get('track-a')?.appendCalls, 1);
	assert.equal(fixture.lanes.get('track-b')?.appendCalls, 2);
	assert.deepEqual(result.lanes.map(({ trackId, status, error }) => ({ trackId, status, error })), [
		{ trackId: 'track-a', status: 'failed', error: failure },
		{ trackId: 'track-b', status: 'committed', error: null },
	]);
	assert.deepEqual(fixture.finalizedTrackIds, ['track-b']);
});

test('startup failure after durable lane registration discards exact ownership and releases inputs', async () => {
	const failure = new Error('transport rejected scheduled cycle playback');
	const fixture = captureFixture({ playError: failure });
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);

	await assert.rejects(service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope), failure);
	assert.equal(service.active, false);
	assert.deepEqual([...fixture.lanes.values()].map(({ discardCalls }) => discardCalls), [1, 1]);
	assert.equal(fixture.events.includes('start-recorder'), false);
	assert.ok(fixture.events.indexOf('stop-recorder') < fixture.events.indexOf('dispose-recorder'));
	assert.ok(fixture.events.indexOf('dispose-recorder') < fixture.events.indexOf('discard:track-a'));
	assert.equal(fixture.releaseCalls(), 1);
});

test('blocked input acquisition refuses project switches and disposal before durable registration', async () => {
	for (const scenario of ['project switch', 'disposal'] as const) {
		const acquired = deferred<void>();
		const fixture = captureFixture({ acquireGate: acquired.promise });
		const service = createTakeCycleRoutedCaptureService(fixture.runtime);
		const starting = service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
		await Promise.resolve();
		assert.equal(fixture.inputRequests(), 1);
		if (scenario === 'project switch') fixture.switchProject('project-next');
		else fixture.dispose();
		acquired.resolve();

		await assert.rejects(starting, { name: 'AbortError' }, scenario);
		assert.equal(fixture.events.includes('begin-session'), false, scenario);
		assert.equal(fixture.lanes.size, 0, scenario);
		assert.equal(fixture.releaseCalls(), 1, scenario);
	}
});

test('a stale chunk callback stops capture and discards exact durable lanes without finalization', async () => {
	const fixture = captureFixture();
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
	fixture.switchProject('project-next');

	await assert.rejects(fixture.recorderOptions[0]!.onChunk(chunk(0, 4, 0.25, -0.25)), { name: 'AbortError' });
	await waitFor(() => fixture.releaseCalls() === 1);

	assert.deepEqual([...fixture.lanes.values()].map(({ discardCalls }) => discardCalls), [1, 1]);
	assert.equal(fixture.events.includes('finalize'), false);
	assert.equal(fixture.events.includes('stop-recorder'), true);
	assert.equal(fixture.events.includes('dispose-recorder'), true);
	assert.equal(fixture.releaseCalls(), 1);
});

test('stop refuses a stale project scope and settles its exact durable lanes', async () => {
	const fixture = captureFixture({ tracks: ['track-a'] });
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
	fixture.dispose();

	await assert.rejects(service.stop(), { name: 'AbortError' });
	assert.equal(fixture.lanes.get('track-a')?.discardCalls, 1);
	assert.equal(fixture.events.includes('finalize'), false);
	assert.equal(fixture.events.includes('stop-recorder'), true);
	assert.equal(fixture.events.includes('dispose-recorder'), true);
	assert.equal(fixture.releaseCalls(), 1);
});

test('locked armed targets refuse cycle capture before permission or durable I/O', async () => {
	const fixture = captureFixture({ tracks: ['track-a'], lockedTracks: ['track-a'] });
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);

	await assert.rejects(
		service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope),
		/Track track-a is locked/u,
	);
	assert.equal(fixture.inputRequests(), 0);
	assert.equal(fixture.lanes.size, 0);
	assert.equal(fixture.events.length, 0);
	assert.equal(fixture.releaseCalls(), 0);
});

test('cycle capture rejects timed, punch, sound-activated, non-loop, and pause ambiguity before input I/O', async () => {
	const cases: Array<Readonly<{
		name: string;
		configure(fixture: ReturnType<typeof captureFixture>): void;
		request?: unknown;
		message: RegExp;
	}>> = [
		{
			name: 'timed', configure() {},
			request: { kind: 'take-cycle-routed-capture', timedStartTimeMs: 1_000 }, message: /closed shape/u,
		},
		{
			name: 'punch', configure(fixture) { fixture.selection.current = { startFrame: 100, endFrame: 200 }; },
			message: /selection|punch/u,
		},
		{
			name: 'sound activation', configure(fixture) { fixture.soundActivation.current = true; },
			message: /sound activation/u,
		},
		{
			name: 'loop', configure(fixture) { fixture.project.loop = { enabled: false, startFrame: 100, endFrame: 500 }; },
			message: /enabled loop/u,
		},
	];
	for (const scenario of cases) {
		const fixture = captureFixture({ tracks: ['track-a'] });
		scenario.configure(fixture);
		const service = createTakeCycleRoutedCaptureService(fixture.runtime);
		await assert.rejects(
			service.start((scenario.request ?? { kind: 'take-cycle-routed-capture' }) as never, fixture.scope),
			scenario.message,
			scenario.name,
		);
		assert.equal(fixture.inputRequests(), 0, scenario.name);
		assert.equal(fixture.releaseCalls(), 0, scenario.name);
		assert.equal(fixture.events.length, 0, scenario.name);
	}

	const active = captureFixture({ tracks: ['track-a'] });
	const service = createTakeCycleRoutedCaptureService(active.runtime);
	await service.start({ kind: 'take-cycle-routed-capture' }, active.scope);
	assert.throws(() => service.pause(), /cannot be paused/u);
	await service.stop();
});

interface LaneFixture {
	capture: TakeCycleLiveLaneCapture;
	readonly spans: TakeCycleCapturePcmSpan[];
	appendCalls: number;
	discardCalls: number;
	sealed: boolean;
}

interface FixtureOptions {
	readonly tracks?: readonly string[];
	readonly captureSampleRate?: number;
	readonly projectSampleRate?: number;
	readonly preflightError?: Error;
	readonly append?: (trackId: string, call: number) => Promise<void>;
	readonly playError?: Error;
	readonly acquireGate?: Promise<void>;
	readonly lockedTracks?: readonly string[];
	readonly takeGroups?: readonly Readonly<{
		readonly id: string;
		readonly sequenceId: string;
		readonly trackId: string;
		readonly startSample: number;
		readonly endSample: number;
		readonly lanes?: readonly unknown[];
		readonly takes?: readonly unknown[];
		readonly compRegions?: readonly unknown[];
	}>[];
}

function captureFixture(options: FixtureOptions = {}) {
	const trackIds = options.tracks ?? ['track-a', 'track-b'];
	const events: string[] = [];
	const lanes = new Map<string, LaneFixture>();
	const recorderOptions: RecordingControllerFactoryOptions[] = [];
	const startOptions: Array<Readonly<{ startFrame?: number; stopFrame?: number }>> = [];
	const loopCalls: Array<Readonly<{ enabled: boolean; startFrame: number; endFrame: number }>> = [];
	const seekCalls: number[] = [];
	const finalizedTrackIds: string[] = [];
	const storageRequests: Array<Readonly<{
		readonly requiredBytes: number;
		readonly operation: 'take-cycle-recording';
	}>> = [];
	const preflightBytes: number[] = [];
	let requests = 0;
	let pauses = 0;
	let releases = 0;
	let activeProjectId = 'project-cycle';
	let disposed = false;
	let laneIdentity = 0;
	let groupIdCalls = 0;
	const project = {
		id: 'project-cycle', sampleRate: options.projectSampleRate ?? 48_000,
		tracks: trackIds.map((id) => ({
			id, type: 'audio', armed: true, locked: options.lockedTracks?.includes(id) ?? false,
		})),
		sequences: [{ id: 'main-sequence', trackIds: [...trackIds] }],
		primarySequenceId: 'main-sequence',
		loop: { enabled: true, startFrame: 100, endFrame: 500 },
		takeGroups: options.takeGroups ?? [],
	};
	const selection: { current: { startFrame: number; endFrame: number } | null } = { current: null };
	const soundActivation = { current: false };
	const session: TakeCycleLiveCaptureSession = {
		projectId: project.id,
		publicationGeneration: 17,
		get pendingLaneCount() { return [...lanes.values()].filter(({ sealed }) => !sealed).length; },
		async beginLane(lane) {
			events.push(`begin-lane:${lane.trackId}`);
			const spans: TakeCycleCapturePcmSpan[] = [];
			const fixture: LaneFixture = {
				spans, appendCalls: 0, discardCalls: 0, sealed: false,
				capture: undefined as unknown as TakeCycleLiveLaneCapture,
			};
			const capture: TakeCycleLiveLaneCapture = {
				draftId: `draft-${lane.trackId}`, spoolToken: `spool-${lane.trackId}`,
				envelopeId: `envelope-${lane.trackId}`, laneId: `lane-${++laneIdentity}`,
				get frameCount() { return spans.reduce((total, span) => total + span.channels[0]!.length, 0); },
				async append(span) {
					fixture.appendCalls += 1;
					events.push(`append:${lane.trackId}:${String(fixture.appendCalls)}`);
					await options.append?.(lane.trackId, fixture.appendCalls);
					spans.push(Object.freeze({
						startSample: span.startSample, endSample: span.endSample,
						channels: Object.freeze(span.channels.map((channel) => channel.slice())),
					}));
				},
				async seal() {
					if (fixture.sealed) throw new Error('already sealed');
					fixture.sealed = true;
					events.push(`seal:${lane.trackId}`);
					return { lane: { laneId: this.laneId } } as never;
				},
				async discard() {
					fixture.discardCalls += 1;
					fixture.sealed = true;
					events.push(`discard:${lane.trackId}`);
				},
			};
			fixture.capture = capture;
			lanes.set(lane.trackId, fixture);
			return capture;
		},
		async finalize() {
			events.push('finalize');
			for (const [trackId, lane] of lanes) if (lane.sealed && !lane.discardCalls) finalizedTrackIds.push(trackId);
			events.push('activate');
			return Object.freeze({
				kind: 'take-cycle-finalization', generation: 17,
				lanes: Object.freeze(finalizedTrackIds.map((trackId) => Object.freeze({
					groupId: `group-${trackId}`, laneId: lanes.get(trackId)!.capture.laneId,
					status: 'committed' as const, committedPasses: Object.freeze([]), error: null,
				}))),
			});
		},
	};
	const context = {
		sampleRate: options.captureSampleRate ?? 48_000,
		currentTime: 3.668,
		resume: async () => {},
	};
	const stream = {
		getAudioTracks: () => [{ readyState: 'live', getSettings: () => ({ channelCount: trackIds.length }) }],
		getTracks: () => [],
	};
	const runtime: TakeCycleRoutedCaptureRuntime = {
		orchestrator: {
			async beginLiveSession() { events.push('begin-session'); return session; },
		},
		capturePool: {
			async acquireHardware() { requests += 1; await options.acquireGate; return stream; },
			async acquireDisplay() { requests += 1; await options.acquireGate; return stream; },
		},
		engine: {
			async getAudioContext() { return context; },
			setLoop(loop) { loopCalls.push({ ...loop }); },
			seek(frame) { seekCalls.push(frame); },
			async playAt() {
				events.push('play');
				if (options.playError) throw options.playError;
			},
			pause() { pauses += 1; },
		},
		getProject: () => activeProjectId === project.id ? project : { ...project, id: activeProjectId },
		getRoutes: () => Object.fromEntries(trackIds.map((trackId, channelStart) => [trackId, {
			kind: 'device' as const, deviceId: 'mic', channelStart, channelCount: 1,
		}])),
		activeSelection: () => selection.current,
		soundActivationEnabled: () => soundActivation.current,
		recordingRouteSourceKey: (route) => `device:${route.deviceId}`,
		streamAudioChannelCount: () => trackIds.length,
		recordingStreamIsLive: () => true,
		createRecorder: async (factoryOptions) => {
			events.push('create-recorder');
			recorderOptions.push(factoryOptions);
			return {
				start(start) { startOptions.push(start ?? {}); events.push('start-recorder'); },
				pause() { return false; }, resume() { return false; },
				async stop() { events.push('stop-recorder'); },
				async dispose() { events.push('dispose-recorder'); },
				setMonitoring() {}, setInputGain() {},
			};
		},
		createGroupId: (trackId) => { groupIdCalls += 1; return `group-${trackId}`; },
		createRecordingName: (trackId) => `Cycle ${trackId}`,
		sourceChunkFrames: 65_536,
		async preflightStorage(requiredBytes, operation) {
			storageRequests.push({ requiredBytes, operation });
			preflightBytes.push(requiredBytes);
			if (options.preflightError) throw options.preflightError;
		},
		beginPlaybackCachePreparation: async () => {},
		handleError() {},
		releaseInputs() { releases += 1; },
	};
	const scope = Object.freeze({
		generation: 41,
		projectId: project.id,
		assertCurrent() {
			if (disposed || activeProjectId !== project.id) {
				const error = new Error('recording start superseded');
				error.name = 'AbortError';
				throw error;
			}
		},
	});
	return {
		runtime, scope, project, events, lanes, recorderOptions, startOptions, loopCalls, seekCalls, storageRequests,
		finalizedTrackIds, selection, soundActivation, preflightBytes,
		inputRequests: () => requests,
		groupIdCalls: () => groupIdCalls,
		pauseCalls: () => pauses,
		releaseCalls: () => releases,
		switchProject(projectId: string) { activeProjectId = projectId; },
		dispose() { disposed = true; },
	};
}

function chunk(frameStart: number, frames: number, ...values: number[]) {
	return {
		frameStart, frames,
		channels: values.map((value) => Float32Array.from({ length: frames }, () => value)),
	};
}

function gridBoundaries(spans: readonly TakeCycleCapturePcmSpan[], start: number, length: number): number[] {
	return spans.map(({ endSample }) => endSample)
		.filter((sample) => sample > start && (sample - start) % length === 0);
}

function sameLoopCell(start: number, end: number, origin: number, length: number): boolean {
	return Math.floor((start - origin) / length) === Math.floor((end - 1 - origin) / length);
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await Promise.resolve();
	assert.equal(predicate(), true, 'condition did not settle');
}
