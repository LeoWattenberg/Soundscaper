import test from 'node:test';
import assert from 'node:assert/strict';
import {
	PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES,
	createAudioEditorEngine,
	estimatePlayAtSpeedStaffPadPeakBytes,
} from '../src/common/editor/engine.js';
import {
	MockAudioBuffer,
	MockAudioContext,
} from './helpers/mock-audio-context.js';
import {
	MockOfflineAudioContext,
	createProject,
} from './helpers/audio-editor-runtime-harness.js';

test('playhead scrubbing auditions independent 50 ms project-time frames', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	// The audition frame is a wall-clock throttle, so drive the clock rather than race it.
	let elapsedMs = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 1_000,
		monotonicNow: () => elapsedMs,
	});
	engine.loadProject(project, new Map([['source-1', source]]));

	await engine.scrub(12_000);
	assert.equal(engine.getState().state, 'paused');
	assert.equal(engine.getState().positionFrame, 12_000);
	assert.equal(context.bufferSources.length, 1);
	assert.deepEqual(context.bufferSources[0].started, [0, 0.25, 0.05]);

	elapsedMs += 10;
	await engine.scrub(24_000);
	assert.equal(engine.getState().positionFrame, 24_000);
	assert.equal(context.bufferSources.length, 1, 'pointer updates within one frame remain intentionally sampled');
	engine.endScrub();
	assert.equal(engine.getState().positionFrame, 24_000, 'ending a scrub keeps the dragged cursor position');
	assert.equal(context.bufferSources[0].stopped, true);

	elapsedMs += 50;
	await engine.scrub(36_000);
	assert.equal(context.bufferSources.length, 2);
	assert.deepEqual(context.bufferSources[1].started, [0, 0.75, 0.05]);
	engine.endScrub();
	await engine.dispose();
});

test('ending a rapid scrub invalidates pending audio scheduling without resetting the cursor', async () => {
	const context = new MockAudioContext();
	let allowResume;
	const resumeGate = new Promise((resolve) => { allowResume = resolve; });
	context.resume = () => resumeGate;
	const project = createProject();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context });
	engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));

	const pending = engine.scrub(12_000);
	void engine.scrub(24_000);
	engine.endScrub();
	allowResume();
	await pending;

	assert.equal(context.bufferSources.length, 0);
	assert.equal(engine.getState().state, 'paused');
	assert.equal(engine.getState().positionFrame, 24_000);
	await engine.dispose();
});

test('play at speed couples naive interpolation to project-time transport timing', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	engine.loadProject(project, new Map([['source-1', source]]));

	await engine.playAtSpeed(2);
	assert.equal(engine.getState().playbackMode, 'naive');
	assert.equal(engine.getState().playbackRate, 2);
	assert.equal(context.bufferSources[0].playbackRate.value, 2);
	assert.deepEqual(context.bufferSources[0].started, [0, 0, 1]);
	context.currentTime = 0.25;
	assert.equal(engine.getPositionFrames(), 24_000);

	engine.seek(12_000);
	assert.equal(context.bufferSources[1].playbackRate.value, 2);
	assert.deepEqual(context.bufferSources[1].started, [0.25, 0.25, 0.75]);
	context.currentTime = 0.5;
	assert.equal(engine.getPositionFrames(), 36_000);
	engine.stop();
	await engine.dispose();
});

test('aborting play at speed while AudioContext resume is delayed never schedules audio', async () => {
	const context = new MockAudioContext();
	let allowResume;
	const resumeGate = new Promise((resolve) => { allowResume = resolve; });
	context.resume = () => resumeGate;
	const abort = new AbortController();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context });
	engine.loadProject(createProject(), new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));

	const pending = engine.playAtSpeed(2, { signal: abort.signal });
	abort.abort();
	allowResume();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(context.bufferSources.length, 0);
	assert.equal(engine.getState().state, 'stopped');
	await engine.dispose();
});

test('StaffPad play-at-speed preflight rejects unsafe whole-project PCM before offline allocation', async () => {
	const project = createProject();
	const unsafeFrames = Math.floor(PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES
		/ (2 * 2 * Float32Array.BYTES_PER_ELEMENT)) + 1;
	project.clips[0].durationFrames = unsafeFrames;
	const estimatedBytes = estimatePlayAtSpeedStaffPadPeakBytes(unsafeFrames, project.sampleRate, 2);
	assert.equal(PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES, 256 * 1024 ** 2);
	assert.ok(estimatedBytes > PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES);
	let offlineAllocations = 0;
	let pitchPreserverCalls = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => new MockAudioContext(),
		offlineAudioContextFactory: () => {
			offlineAllocations += 1;
			throw new Error('Unsafe OfflineAudioContext allocation must be preflighted.');
		},
	});
	engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));

	await assert.rejects(
		engine.playAtSpeed(2, {
			preservePitch: true,
			async pitchPreserver() {
				pitchPreserverCalls += 1;
				return [new Float32Array(1)];
			},
		}),
		(error) => error instanceof RangeError
			&& error.code === 'PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT'
			&& error.message.includes(String(PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES)),
	);
	assert.equal(offlineAllocations, 0);
	assert.equal(pitchPreserverCalls, 0);
	assert.equal(engine.getState().playbackMode, 'normal');
	assert.equal(engine.getState().playbackRate, 1);
	await engine.dispose();
});

test('applyProject keeps active naive play-at-speed timing and stops stale StaffPad playback', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const sources = new Map([['source-1', source]]);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		offlineAudioContextFactory: (options) => new MockOfflineAudioContext(options),
		meterInterval: 1_000,
	});
	engine.loadProject(project, sources);

	await engine.playAtSpeed(1.5);
	context.currentTime = 0.2;
	await engine.applyProject({ ...project, title: 'Naive cache refresh' }, sources);
	assert.equal(engine.getState().state, 'playing');
	assert.equal(engine.getState().playbackMode, 'naive');
	assert.equal(engine.getState().playbackRate, 1.5);
	assert.equal(context.bufferSources.at(-1).playbackRate.value, 1.5);

	engine.stop();
	await engine.playAtSpeed(2, {
		preservePitch: true,
		async pitchPreserver(channels) {
			return channels.map(() => new Float32Array(24_000));
		},
	});
	await engine.applyProject({ ...project, title: 'StaffPad cache refresh' }, sources);
	assert.equal(engine.getState().state, 'stopped');
	assert.equal(engine.getState().playbackMode, 'normal');
	assert.equal(engine.getState().playbackRate, 1);
	await engine.dispose();
});

test('pitch-preserving play at speed schedules a StaffPad-tempo mix at unity source rate', async () => {
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const calls = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map([['source-1', source]]));
	const preservePitch = async (channels, sampleRate, rate) => {
		calls.push({ channelCount: channels.length, frames: channels[0].length, sampleRate, rate });
		return channels.map(() => new Float32Array(24_000));
	};

	await engine.playAtSpeed(2, {
		preservePitch: true,
		pitchPreserver: preservePitch,
	});
	assert.deepEqual(calls, [{ channelCount: 2, frames: 48_000, sampleRate: 48_000, rate: 2 }]);
	assert.equal(offlineContexts.length, 1);
	assert.equal(engine.getState().playbackMode, 'staffpad');
	assert.equal(engine.getState().playbackRate, 2);
	assert.equal(realtime.bufferSources[0].buffer.length, 24_000);
	assert.equal(realtime.bufferSources[0].playbackRate.value, 1);
	assert.deepEqual(realtime.bufferSources[0].started, [0, 0, undefined]);
	realtime.currentTime = 0.25;
	assert.equal(engine.getPositionFrames(), 24_000);

	engine.seek(24_000);
	assert.equal(realtime.bufferSources[1].buffer, realtime.bufferSources[0].buffer);
	assert.deepEqual(realtime.bufferSources[1].started, [0.25, 0.25, undefined]);
	engine.pause();
	await engine.playAtSpeed(2, { preservePitch: true, pitchPreserver: preservePitch });
	assert.equal(calls.length, 1);
	assert.equal(offlineContexts.length, 1);
	assert.equal(realtime.bufferSources[2].buffer, realtime.bufferSources[0].buffer);
	assert.equal(realtime.bufferSources[2].playbackRate.value, 1);
	engine.pause();
	await engine.play();
	assert.equal(engine.getState().playbackMode, 'normal');
	assert.equal(realtime.bufferSources[3].buffer, source);
	assert.equal(realtime.bufferSources[3].playbackRate.value, 1);
	engine.stop();
	await engine.dispose();
});
