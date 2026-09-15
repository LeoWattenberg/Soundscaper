/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext, EngineRenderMixOptions } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createProject } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

function fixture(multipleTracks = false) {
	const context = new MockAudioContext();
	const project = createProject();
	project.clips[0]!.durationFrames = 480_000;
	if (multipleTracks) project.tracks.unshift({ ...project.tracks[0]!, id: 'upper-track' });
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
	engine.loadProject(project as unknown as EngineProject, new Map([
		['source-1', new MockAudioBuffer(1, 480_000, 48_000) as unknown as AudioBuffer],
	]));
	const renders: EngineRenderMixOptions[] = [];
	engine.renderMix = async (options = {}) => {
		renders.push(options);
		const buffer = new MockAudioBuffer(1, Number(options.endFrame) - Number(options.startFrame), 48_000);
		buffer.getChannelData(0).fill(renders.length === 1 ? 0.25 : 0.75);
		return buffer as unknown as AudioBuffer;
	};
	return { context, engine, project, renders };
}

test('cut preview joins two seconds before and one second after the gap, with the audible playhead jumping it', async () => {
	const { context, engine, project, renders } = fixture();
	const before = structuredClone(project);
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 48_000 });
	await engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000 });
	assert.deepEqual(renders.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[48_000, 144_000], [240_000, 288_000]]);
	assert.ok(renders.every(({ includeTail }) => includeTail === false));
	assert.ok(renders.every(({ trackId }) => trackId === 'track-1'));
	const buffer = context.bufferSources.at(-1)!.buffer as AudioBuffer;
	assert.equal(buffer.length, 144_000);
	assert.equal(buffer.getChannelData(0)[95_999], 0.25);
	assert.equal(buffer.getChannelData(0)[96_000], 0.75);
	context.currentTime = 1;
	assert.equal(engine.getPositionFrames(), 96_000);
	context.currentTime = 2.25;
	assert.equal(engine.getPositionFrames(), 252_000);
	context.currentTime = 4;
	await new Promise<void>((resolve) => { setTimeout(resolve, 80); });
	assert.equal(engine.getState().state, 'stopped');
	assert.equal(engine.getPositionFrames(), 288_000);
	assert.deepEqual(project, before);
	assert.deepEqual(engine.getState().loop, { enabled: true, startFrame: 0, endFrame: 48_000 });
	await engine.dispose();
});

test('cut preview clamps at project edges and stopping during preparation cancels playback', async () => {
	const { engine, renders } = fixture();
	await engine.playCutPreview({ startFrame: 0, endFrame: 456_000 });
	assert.deepEqual(renders.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[456_000, 480_000]]);
	engine.stop();
	let release: (() => void) | undefined;
	engine.renderMix = () => new Promise<AudioBuffer>((resolve) => {
		release = () => { resolve(new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer); };
	});
	const pending = engine.playCutPreview({ startFrame: 48_000, endFrame: 456_000 });
	engine.stop();
	assert.ok(release);
	release();
	await pending;
	assert.equal(engine.getState().state, 'stopped');
	await engine.dispose();
});

test('cut preview auditions only the uppermost selected track regardless of selection ID order', async () => {
	const { engine, renders } = fixture(true);
	await engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000, trackIds: ['track-1', 'upper-track'] });
	assert.ok(renders.every(({ trackId }) => trackId === 'upper-track'));
	engine.stop();
	await engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000, trackIds: ['track-1'] });
	assert.ok(renders.slice(2).every(({ trackId }) => trackId === 'track-1'));
	engine.stop();
	await engine.dispose();
});

test('seeking a stopped editing cursor preserves stopped transport while seeking paused playback stays paused', async () => {
	const { engine } = fixture();
	engine.seek(12_345);
	assert.equal(engine.getState().state, 'stopped');
	await engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000 });
	engine.pause();
	engine.seek(12_345);
	assert.equal(engine.getState().state, 'paused');
	engine.stop();
	engine.seek(12_345);
	assert.equal(engine.getState().state, 'stopped');
	await engine.dispose();
});

for (const pauseTime of [1, 2.25]) {
	test(`paused cut preview resumes its joined buffer at ${pauseTime} seconds without entering the saved loop`, async () => {
		const { context, engine, renders } = fixture();
		try {
			engine.setLoop({ enabled: true, startFrame: 0, endFrame: 48_000 });
			await engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000 });
			const buffer = context.bufferSources.at(-1)!.buffer;
			context.currentTime = pauseTime;
			engine.pause();
			assert.equal(engine.getState().cutPreview, true);
			const pausedFrame = engine.getPositionFrames();
			assert.equal(pausedFrame, pauseTime < 2 ? 96_000 : 252_000);
			context.currentTime = 10;
			assert.equal(engine.getPositionFrames(), pausedFrame, 'pause must hold its original timeline position');
			await engine.play();
			const resumed = context.bufferSources.at(-1)!;
			assert.ok(resumed.buffer === buffer, 'resume must reuse the joined audition instead of the original media');
			assert.deepEqual(resumed.started, [10, pauseTime, undefined]);
			assert.equal(engine.getPositionFrames(), pausedFrame);
			assert.equal(renders.length, 2, 'resume must reuse the bounded render');
			context.currentTime = 10 + (pauseTime < 2 ? 1.25 : 0.25);
			assert.equal(engine.getPositionFrames(), pauseTime < 2 ? 252_000 : 264_000);
			context.currentTime = 10 + 3 - pauseTime + 0.1;
			await new Promise<void>((resolve) => { setTimeout(resolve, 80); });
			assert.equal(engine.getState().state, 'stopped');
			assert.equal(engine.getState().cutPreview, false);
			assert.equal(engine.getPositionFrames(), 288_000);
			assert.deepEqual(engine.getState().loop, { enabled: true, startFrame: 0, endFrame: 48_000 });
		} finally {
			await engine.dispose();
		}
	});
}

for (const interrupt of ['stop', 'seek', 'replace-project', 'play-selection'] as const) {
	test(`${interrupt} retires a paused cut audition before subsequent ordinary playback`, async () => {
		const { context, engine, project } = fixture();
		try {
			await engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000 });
			context.currentTime = 1;
			engine.pause();
			if (interrupt === 'stop') engine.stop();
			if (interrupt === 'seek') engine.seek(12_345);
			if (interrupt === 'replace-project') engine.loadProject({ ...project, id: 'replacement' } as unknown as EngineProject, new Map([
				['source-1', new MockAudioBuffer(1, 480_000, 48_000) as unknown as AudioBuffer],
			]));
			if (interrupt === 'play-selection') engine.setPlayRange({ startFrame: 96_000, endFrame: 144_000 });
			await engine.play();
			assert.equal((context.bufferSources.at(-1)!.buffer as AudioBuffer).length, 480_000);
		} finally {
			await engine.dispose();
		}
	});
}

test('a second cut preview supersedes a pending render without letting the first preview start', async () => {
	const { context, engine } = fixture();
	try {
		let releaseFirst: (() => void) | undefined;
		let calls = 0;
		engine.renderMix = (options = {}) => {
			calls += 1;
			const buffer = new MockAudioBuffer(1, Number(options.endFrame) - Number(options.startFrame), 48_000) as unknown as AudioBuffer;
			if (calls !== 1) return Promise.resolve(buffer);
			return new Promise<AudioBuffer>((resolve) => { releaseFirst = () => { resolve(buffer); }; });
		};
		const first = engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000 });
		await engine.playCutPreview({ startFrame: 48_000, endFrame: 96_000 });
		assert.ok(releaseFirst);
		releaseFirst();
		await first;
		assert.equal(context.bufferSources.length, 1);
		assert.equal((context.bufferSources[0]!.buffer as AudioBuffer).length, 96_000);
		assert.equal(calls, 3, 'the superseded request must not render its second window');
		assert.equal(engine.getPositionFrames(), 0);
	} finally {
		await engine.dispose();
	}
});

test('cut preview skips selected video tracks and rejects video-only selections', async () => {
	const { engine, project, renders } = fixture(true);
	try {
		Object.assign(project.tracks[0]!, { type: 'video' });
		engine.loadProject(project as unknown as EngineProject);
		await engine.playCutPreview({ startFrame: 144_000, endFrame: 240_000, trackIds: ['upper-track', 'track-1'] });
		assert.ok(renders.every(({ trackId }) => trackId === 'track-1'), 'the selected audio companion owns audition');
		engine.stop();
		await assert.rejects(engine.playCutPreview({
			startFrame: 144_000, endFrame: 240_000, trackIds: ['upper-track'],
		}), /Select an audio track/u);
	} finally {
		await engine.dispose();
	}
});
