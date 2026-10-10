/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipSourcePreviewService, type ClipSourcePreviewDependencies } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

function fixture(prepare: () => Promise<unknown> = async () => undefined, disposeEngine: () => Promise<void> = async () => undefined) {
	const events: string[] = [];
	let loaded: EngineProject | null = null;
	let stateListener: (state: string) => void = () => undefined;
	let positionListener: (position: number) => void = () => undefined;
	let timelineListener: (state: string) => void = () => undefined;
	const project = { id: 'project', sampleRate: 48_000, tempoMap: { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', kind: 'audio', sampleRate: 48_000, frameCount: 400, channelCount: 1 }],
		clips: [{ id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 1000, durationFrames: 100, sourceId: 'source', sourceStartFrame: 100, sourceDurationFrames: 200, pitchCents: 100, gain: 0.5, fadeInFrames: 10, fadeOutFrames: 20 }],
	};
	const engine = {
		loadProject: (next: EngineProject) => { loaded = next; events.push('load'); },
		play: async () => { events.push('play'); stateListener('playing'); },
		pause: () => { events.push('pause'); stateListener('paused'); },
		stop: () => { events.push('stop'); stateListener('stopped'); },
		seek: (frame: number) => { events.push(`seek:${String(frame)}`); positionListener(frame); return frame; },
		setLoop: (enabled: boolean) => { events.push(`loop:${String(enabled)}`); },
		setPlayRange: () => undefined,
		setSourceResolver: () => undefined,
		subscribePosition: (listener: typeof positionListener) => { positionListener = listener; return () => undefined; },
		dispose: async () => { events.push('dispose'); await disposeEngine(); },
	};
	const lifetime = new EditorControllerLifetime();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const dependencies: ClipSourcePreviewDependencies = {
		lifetime,
		getProject: () => project,
		captureProject: () => generation.capture(), assertProject: (token) => generation.assertCurrent(token),
		handleError: (error) => { throw error; },
		resources: {
			sourceBuffers: new Map(), sourceChunkProviders: new Map(),
			createEngine: ({ onState }) => { stateListener = onState; return engine; },
			prepare, retirePlayback: () => { events.push('retire'); },
			subscribeTimelineState: (listener) => { timelineListener = listener; return () => undefined; },
		},
	};
	const service = createClipSourcePreviewService(dependencies);
	return { service, events, lifetime, project, switchProject: () => { generation.activate(project.id); }, loaded: () => loaded, mainPlay: () => { timelineListener('playing'); } };
}

test('full-source preview keeps clip processing within its active span and owns playback', async () => {
	const { service, events, loaded } = fixture();
	service.focus('clip');
	assert.equal(service.snapshot().focused, true);
	assert.equal(service.snapshot().durationFrames, 300);
	await service.playPause('clip');
	const clips = loaded()?.clips ?? [];
	assert.equal(clips.length, 3);
	assert.deepEqual(clips.map((clip) => [clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames]), [[0,100,0,100],[100,100,100,200],[200,100,300,100]]);
	assert.equal(clips[1]?.pitchCents, 100);
	assert.equal(clips[1]?.gain, 0.5);
	assert.equal(clips[1]?.fadeInFrames, 10);
	assert.equal(clips[0]?.pitchCents, 0);
	assert.equal(clips[2]?.gain, 1);
	assert.equal(service.snapshot().state, 'playing');
	assert.ok(events.indexOf('retire') < events.indexOf('play'));
	await service.playPause('clip');
	assert.equal(service.snapshot().state, 'paused');
	service.setLoop(true);
	service.seek(180);
	assert.equal(service.snapshot().positionFrame, 180);
	service.stop();
	assert.equal(service.snapshot().positionFrame, 0);
	await service.dispose();
	await service.dispose();
	assert.equal(events.filter((event) => event === 'dispose').length, 1);
});

test('timeline playback and leaving the source editor pause its private transport', async () => {
	const { service, mainPlay } = fixture();
	await service.playPause('clip');
	mainPlay();
	assert.equal(service.snapshot().focused, false);
	assert.equal(service.snapshot().state, 'paused');
	await service.playPause('clip');
	service.blur();
	assert.equal(service.snapshot().state, 'paused');
	await service.dispose();
});

test('a pending preview cannot begin playback after focus is lost', async () => {
	let resolve!: () => void;
	const pending = new Promise<void>((complete) => { resolve = complete; });
	const { service, events } = fixture(() => pending);
	const playback = service.playPause('clip');
	service.blur();
	resolve();
	await playback;
	assert.equal(events.includes('play'), false);
	await service.dispose();
});

test('Stop cancels source preparation while preserving source transport focus', async () => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	const { service, events } = fixture(() => pending);
	const playback = service.playPause('clip');
	assert.equal(service.snapshot().state, 'loading');
	service.stop();
	release();
	await playback;
	assert.equal(service.snapshot().focused, true);
	assert.equal(service.snapshot().state, 'stopped');
	assert.equal(service.snapshot().positionFrame, 0);
	assert.equal(events.includes('play'), false);
	await service.dispose();
});


test('repeated focus preserves playing state and refreshes edited source duration', async () => {
	const { service, project, events } = fixture();
	await service.playPause('clip');
	const eventCount = events.length;
	service.focus('clip');
	service.focus('clip');
	assert.equal(service.snapshot().state, 'playing');
	assert.equal(events.length, eventCount);
	service.setSelection({ startFrame: 250, endFrame: 300 });
	service.seek(290);
	project.clips[0]!.durationFrames = 50;
	service.focus('clip');
	assert.equal(service.snapshot().durationFrames, 250);
	assert.equal(service.snapshot().positionFrame, 250);
	assert.equal(service.snapshot().selection, null);
	await service.dispose();
});

test('project teardown cancels source playback and a replacement project reusing clip IDs reloads', async () => {
	const { service, lifetime, switchProject, events } = fixture();
	await service.playPause('clip');
	lifetime.cancelScope('project');
	assert.equal(service.snapshot().focused, false);
	assert.equal(service.snapshot().state, 'paused');
	switchProject();
	await service.playPause('clip');
	assert.equal(events.filter((event) => event === 'load').length, 2);
	await service.dispose();
});


test('loop boundaries remain independent of a later source selection', async () => {
	const { service } = fixture();
	service.focus('clip');
	service.setSelection({ startFrame: 10, endFrame: 100 });
	service.setLoopRange({ startFrame: 20, endFrame: 80 });
	service.setLoop(true);
	service.setSelection({ startFrame: 100, endFrame: 200 });
	assert.deepEqual(service.snapshot().loopRange, { startFrame: 20, endFrame: 80 });
	assert.deepEqual(service.snapshot().selection, { startFrame: 100, endFrame: 200 });
	await service.playPause('clip');
	assert.equal(service.snapshot().positionFrame, 20);
	await service.dispose();
});

test('all dispose callers await the same engine cleanup fence', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const { service, events } = fixture(undefined, () => gate);
	await service.playPause('clip');
	const first = service.dispose();
	const second = service.dispose();
	assert.equal(first, second);
	release();
	await second;
	assert.equal(events.filter((event) => event === 'dispose').length, 1);
});
