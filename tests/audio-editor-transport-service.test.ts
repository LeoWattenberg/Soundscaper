/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorTransportService,
	type TransportServiceRuntime,
} from '../src/common/editor/controller/transport-service.ts';

function createRuntime() {
	const state = {
		playAtSpeedRate: 1,
		playAtSpeedAbort: null,
		playAtSpeedGeneration: 0,
	};
	let publishes = 0;
	const callable = () => undefined;
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'state') return state;
			if (name === 'copy') return { timelineFramesFinite: 'Frames must be finite.' };
			if (name === 'getProject') return () => ({ sampleRate: 48_000 });
			if (name === 'projectDurationFrames' || name === 'editorTimelineDurationFrames') return () => 100;
			if (name === 'AUDIO_EDITOR_SAMPLE_RATE') return 44_100;
			if (name === 'publishDocumentSnapshot') return () => { publishes += 1; };
			return callable;
		},
	}) as TransportServiceRuntime;
	return { runtime, state, publishes: () => publishes };
}

test('transport service owns playback rate validation and publication', () => {
	const fixture = createRuntime();
	const service = createEditorTransportService(fixture.runtime);
	assert.equal(Object.isFrozen(service), true);
	assert.equal(service.setPlayAtSpeedRate(1.25), 1.25);
	assert.equal(fixture.state.playAtSpeedRate, 1.25);
	assert.equal(fixture.publishes(), 1);
	assert.throws(() => service.setPlayAtSpeedRate(2.5), /between 0.5 and 2/u);
});

test('transport service normalizes frames against the active project at invocation', () => {
	const service = createEditorTransportService(createRuntime().runtime);
	assert.equal(service.projectSampleRate(), 48_000);
	assert.equal(service.normalizeTimelineFrame(120), 100);
	assert.equal(service.normalizePlaybackFrame(-5), 0);
	assert.throws(() => service.normalizeTimelineFrame(Number.NaN), /Frames must be finite/u);
});

function createTransportFixture() {
	type TestProject = {
		id: string;
		schemaVersion: number;
		sampleRate: number;
		selection: { startFrame: number; endFrame: number; trackIds: string[]; clipIds: string[] } | null;
		loop: { enabled: boolean; startFrame: number; endFrame: number } | null;
		tempo: { bpm: number; timeSignature: { numerator: number } };
	};
	type PlaybackState = { state: string; playbackMode: string; playbackRate: number };
	let project: TestProject = {
		id: 'project-a',
		schemaVersion: 5,
		sampleRate: 48_000,
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track'], clipIds: [] },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		tempo: { bpm: 120, timeSignature: { numerator: 4 } },
	};
	let playbackState: PlaybackState = { state: 'stopped', playbackMode: 'normal', playbackRate: 1 };
	let missingSources = false;
	let beginPreparation: (snapshot: TestProject, options?: { abortController?: AbortController }) => Promise<void>
		= async () => undefined;
	let audioContext: unknown = null;
	const state = {
		playAtSpeedRate: 1,
		playAtSpeedAbort: null as AbortController | null,
		playAtSpeedGeneration: 0,
		recordingStarting: false,
		timedRecordingPreparing: false,
		timedRecording: false,
		recorder: null as object | null,
		projectBinPreview: null as object | null,
		playbackCacheAbort: null as AbortController | null,
		preferences: { playback: { playAtSpeedMode: 'naive' } },
		selectionFollowsLoop: false,
		metronomeEnabled: false,
		transportState: 'stopped',
		disposed: false,
		metronomeTimer: 0 as ReturnType<typeof setTimeout> | 0,
	};
	const calls = {
		begins: [] as TestProject[],
		cacheCancellations: 0,
		commits: [] as unknown[],
		memoryChecks: [] as unknown[][],
		pauses: 0,
		plays: 0,
		playAtSpeed: [] as unknown[][],
		publishes: 0,
		recordStarts: 0,
		recordStops: 0,
		seeks: [] as number[],
		selections: [] as number[][],
		statuses: [] as unknown[][],
		previewStops: 0,
		timedCancellations: 0,
		persisted: [] as unknown[][],
		loops: [] as unknown[],
	};
	const engine = {
		getState: () => playbackState,
		getPositionFrames: () => 40,
		pause: () => { calls.pauses += 1; return 'paused'; },
		play: () => { calls.plays += 1; return 'played'; },
		playAtSpeed: async (rate: number, options: unknown) => {
			calls.playAtSpeed.push([rate, options]);
		},
		stop: () => 'stopped',
		seek: (frame: number) => { calls.seeks.push(frame); return frame; },
		setLoop: (loop: unknown) => { calls.loops.push(loop); },
		getAudioContext: async () => audioContext,
	};
	const runtime: TransportServiceRuntime = {
		AUDIO_EDITOR_SAMPLE_RATE: 44_100,
		abortError: () => Object.assign(new Error('Aborted'), { name: 'AbortError' }),
		activeSelection: () => project.selection,
		assertPlayAtSpeedStaffPadMemorySafe: (...args: unknown[]) => { calls.memoryChecks.push(args); },
		beginPlaybackCachePreparation: async (snapshot: TestProject, options?: { abortController?: AbortController }) => {
			calls.begins.push(snapshot);
			await beginPreparation(snapshot, options);
		},
		calculateAudioEditorMetronomeSchedule: () => ({ beatIndex: 4, delaySeconds: 0.01, beatDurationSeconds: 0.02 }),
		cancelPlaybackCachePreparation: () => {
			calls.cacheCancellations += 1;
			state.playbackCacheAbort?.abort();
			state.playbackCacheAbort = null;
		},
		cancelTimedRecording: () => { calls.timedCancellations += 1; return 'timed-cancelled'; },
		commit: (command: unknown) => {
			calls.commits.push(command);
			const candidate = command as {
				type?: string;
				enabled?: boolean;
				startFrame?: number;
				endFrame?: number;
				commands?: Array<{ type?: string; enabled?: boolean; startFrame?: number; endFrame?: number }>;
			};
			const loopCommand = candidate.type === 'batch'
				? candidate.commands?.find((entry) => entry.type === 'loop/set')
				: candidate;
			if (loopCommand?.type === 'loop/set') {
				project = {
					...project,
					loop: {
						enabled: Boolean(loopCommand.enabled),
						startFrame: Number(loopCommand.startFrame) || 0,
						endFrame: Number(loopCommand.endFrame) || 0,
					},
				};
			}
			return project;
		},
		copy: {
			ready: 'Ready',
			localSourcesMissing: 'Sources missing',
			playAtSpeedPreparing: 'Preparing',
			playAtSpeedPlaying: 'Playing at {rate}',
			timeSelectionRequired: 'Select time',
			timelineFramesFinite: 'Frames must be finite.',
		},
		editorTimelineDurationFrames: () => 1_200,
		engine,
		formatPlaybackRate: (rate: number) => `${rate}x`,
		hasMissingTimelineSources: () => missingSources,
		persistSetting: async (...args: unknown[]) => { calls.persisted.push(args); },
		playAtSpeedPitchPreserver: { name: 'staffpad' },
		productSettingKey: (key: string) => `product:${key}`,
		getProject: () => project,
		projectDurationFrames: () => 1_000,
		publishDocumentSnapshot: () => { calls.publishes += 1; },
		setSelection: (start: number, end: number) => {
			calls.selections.push([start, end]);
			return { startFrame: start, endFrame: end };
		},
		setStatus: (...args: unknown[]) => { calls.statuses.push(args); },
		startRecording: () => { calls.recordStarts += 1; return 'recording-started'; },
		state,
		stopProjectBinPreview: async () => { calls.previewStops += 1; state.projectBinPreview = null; },
		stopRecording: () => { calls.recordStops += 1; return 'recording-stopped'; },
		throwIfAborted: (signal: AbortSignal) => {
			if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
		},
	};
	return {
		service: createEditorTransportService(runtime),
		state,
		calls,
		engine,
		project: () => project,
		setProject(value: TestProject) { project = value; },
		setPlaybackState(value: Partial<PlaybackState>) { playbackState = { ...playbackState, ...value }; },
		setMissingSources(value: boolean) { missingSources = value; },
		setBeginPreparation(value: typeof beginPreparation) { beginPreparation = value; },
		setAudioContext(value: unknown) { audioContext = value; },
	};
}

test('play-at-speed cancellation and preparation cover active, guarded, and pitch-preserving paths', async () => {
	const fixture = createTransportFixture();
	const active = new AbortController();
	fixture.state.playAtSpeedAbort = active;
	assert.equal(fixture.service.cancelPlayAtSpeedPreparation(), true);
	assert.equal(active.signal.aborted, true);
	assert.equal(fixture.calls.publishes, 1);
	fixture.state.playAtSpeedAbort = new AbortController();
	assert.equal(fixture.service.cancelPlayAtSpeedPreparation({ status: true }), true);
	assert.deepEqual(fixture.calls.statuses.at(-1), ['Ready']);
	assert.equal(fixture.service.cancelPlayAtSpeedPreparation(), false);

	fixture.state.recordingStarting = true;
	assert.equal(await fixture.service.handlePlayAtSpeed(), false);
	fixture.state.recordingStarting = false;
	fixture.setMissingSources(true);
	await assert.rejects(fixture.service.handlePlayAtSpeed(), /Sources missing/u);
	fixture.setMissingSources(false);

	fixture.setPlaybackState({ state: 'playing', playbackMode: 'naive' });
	assert.equal(await fixture.service.handlePlayAtSpeed(1.1), 'paused');
	fixture.setPlaybackState({ state: 'stopped', playbackMode: 'normal' });
	fixture.state.preferences.playback.playAtSpeedMode = 'staffpad';
	assert.equal(await fixture.service.handlePlayAtSpeed(1.5), true);
	assert.equal(fixture.calls.memoryChecks.length, 1);
	assert.equal(fixture.calls.playAtSpeed.length, 1);
	assert.deepEqual(fixture.calls.statuses.slice(-2), [
		['Preparing'],
		['Playing at 1.5x', 'success'],
	]);
	assert.equal(fixture.state.playAtSpeedAbort, null);
});

test('play-at-speed aborts stale project work and propagates genuine preparation failures', async () => {
	const stale = createTransportFixture();
	stale.setBeginPreparation(async (snapshot) => {
		stale.setProject({ ...snapshot, id: 'project-b' });
	});
	assert.equal(await stale.service.handlePlayAtSpeed(), false);
	assert.equal(stale.calls.playAtSpeed.length, 0);

	const failed = createTransportFixture();
	failed.setBeginPreparation(async () => { throw new Error('cache failed'); });
	await assert.rejects(failed.service.handlePlayAtSpeed(), /cache failed/u);
	assert.equal(failed.state.playAtSpeedAbort, null);
});

test('transport dispatch coordinates preview, playback, seeking, stop, loop, and record actions', async () => {
	const fixture = createTransportFixture();
	fixture.state.recordingStarting = true;
	assert.equal(await fixture.service.handleTransport('play'), undefined);
	fixture.state.recordingStarting = false;
	fixture.state.projectBinPreview = {};
	assert.equal(await fixture.service.handleTransport('record'), 'recording-started');
	assert.equal(fixture.calls.previewStops, 1);

	fixture.setMissingSources(true);
	await assert.rejects(fixture.service.handleTransport('play'), /Sources missing/u);
	fixture.setMissingSources(false);
	fixture.setPlaybackState({ state: 'playing' });
	assert.equal(await fixture.service.handleTransport('play'), 'paused');
	fixture.setPlaybackState({ state: 'stopped' });
	fixture.state.playbackCacheAbort = new AbortController();
	assert.equal(await fixture.service.handleTransport('play'), undefined);
	assert.equal(fixture.state.playbackCacheAbort, null);
	assert.equal(await fixture.service.handleTransport('play'), 'played');

	assert.equal(await fixture.service.handleTransport('jump-start'), 0);
	assert.equal(await fixture.service.handleTransport('jump-end'), 1_200);
	assert.equal(await fixture.service.handleTransport('rewind'), -239_960);
	assert.equal(await fixture.service.handleTransport('forward'), 240_040);
	assert.deepEqual(fixture.calls.seeks, [0, 1_200, -239_960, 240_040]);

	fixture.state.timedRecording = true;
	assert.equal(await fixture.service.handleTransport('stop'), 'timed-cancelled');
	fixture.state.timedRecording = false;
	fixture.state.recorder = {};
	assert.equal(await fixture.service.handleTransport('stop'), 'recording-stopped');
	assert.equal(await fixture.service.handleTransport('record'), 'recording-stopped');
	fixture.state.recorder = null;
	assert.equal(await fixture.service.handleTransport('stop'), 'stopped');
	assert.equal(await fixture.service.handleTransport('record'), 'recording-started');

	await fixture.service.handleTransport('loop');
	assert.equal(fixture.project().loop?.enabled, true);
	assert.equal(fixture.calls.loops.length, 1);
});

test('loop region commands validate ranges and optionally keep selection synchronized', () => {
	const fixture = createTransportFixture();
	assert.deepEqual(fixture.service.clearLoopRegion(), { enabled: false, startFrame: 0, endFrame: 0 });
	assert.deepEqual(fixture.service.setLoopRegionToSelection(), { enabled: true, startFrame: 10, endFrame: 30 });
	assert.deepEqual(fixture.service.setLoopRegion(80, 20), { enabled: true, startFrame: 20, endFrame: 80 });
	assert.throws(() => fixture.service.setLoopRegion(20, 20), /Select time/u);
	assert.deepEqual(fixture.service.setSelectionToLoopRegion(), { startFrame: 20, endFrame: 80 });
	assert.deepEqual(fixture.service.setLoopRegionInOut(), { enabled: true, startFrame: 10, endFrame: 30 });

	fixture.setProject({ ...fixture.project(), selection: null, loop: null });
	assert.deepEqual(fixture.service.setLoopRegionInOut(), { enabled: true, startFrame: 40, endFrame: 1_000 });
	fixture.state.selectionFollowsLoop = true;
	const synchronized = fixture.service.commitLoopRange({ enabled: true, startFrame: 5, endFrame: 15 });
	assert.deepEqual(synchronized.loop, { enabled: true, startFrame: 5, endFrame: 15 });
	const batch = fixture.calls.commits.at(-1) as { type: string; commands: unknown[] };
	assert.equal(batch.type, 'batch');
	assert.equal(batch.commands.length, 2);

	assert.equal(fixture.service.toggleSelectionFollowsLoop(), false);
	assert.equal(fixture.service.toggleSelectionFollowsLoop(), true);
	assert.deepEqual(fixture.calls.persisted.slice(-2), [
		['product:selection-follows-loop', false],
		['product:selection-follows-loop', true],
	]);
	assert.throws(() => {
		fixture.setProject({ ...fixture.project(), loop: null });
		fixture.service.setSelectionToLoopRegion();
	}, /Select time/u);
});

test('metronome scheduling drives and cleans up a Web Audio click without owning transport', async () => {
	const fixture = createTransportFixture();
	assert.equal(fixture.service.toggleMetronome(), true);
	assert.deepEqual(fixture.calls.persisted, [['product:transport-metronome', true]]);
	const oscillatorCalls: unknown[][] = [];
	let ended: (() => void) | null = null;
	const oscillator = {
		frequency: { setValueAtTime: (...args: unknown[]) => { oscillatorCalls.push(['frequency', ...args]); } },
		connect: (...args: unknown[]) => { oscillatorCalls.push(['connect', ...args]); },
		start: (...args: unknown[]) => { oscillatorCalls.push(['start', ...args]); },
		stop: (...args: unknown[]) => { oscillatorCalls.push(['stop', ...args]); },
		disconnect: () => { oscillatorCalls.push(['disconnect']); },
		set onended(callback: (() => void) | null) { ended = callback; },
	};
	const gain = {
		gain: {
			setValueAtTime: (...args: unknown[]) => { oscillatorCalls.push(['gain', ...args]); },
			exponentialRampToValueAtTime: (...args: unknown[]) => { oscillatorCalls.push(['ramp', ...args]); },
		},
		connect: (...args: unknown[]) => { oscillatorCalls.push(['gain-connect', ...args]); },
		disconnect: () => { oscillatorCalls.push(['gain-disconnect']); },
	};
	fixture.setAudioContext({
		currentTime: 1,
		destination: {},
		createOscillator: () => oscillator,
		createGain: () => gain,
	});
	fixture.state.transportState = 'playing';
	await fixture.service.scheduleMetronomeClick();
	assert.ok(oscillatorCalls.some(([name]) => name === 'start'));
	const invokeEnded = ended as (() => void) | null;
	invokeEnded?.();
	fixture.service.stopMetronome();
	assert.equal(fixture.state.metronomeTimer, 0);

	fixture.state.disposed = true;
	await fixture.service.scheduleMetronomeClick();
	fixture.setProject({ ...fixture.project(), sampleRate: 0 });
	assert.equal(fixture.service.projectSampleRate(), 44_100);
	assert.throws(() => fixture.service.normalizePlaybackFrame(Number.NaN), /finite/u);
});
