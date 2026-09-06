/* SPDX-License-Identifier: AGPL-3.0-only */

// Playing a time selection has to stop where the selection stops. The engine
// used to end every unlooped run at the end of the timeline, so a selection
// could only be auditioned by watching the playhead and hitting stop by hand.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createProject } from './helpers/audio-editor-runtime-harness.js';
import {
	MockAudioBuffer,
	MockAudioContext,
} from './helpers/mock-audio-context.js';

const SAMPLE_RATE = 48_000;
const RANGE_START_FRAME = 12_000;
const RANGE_END_FRAME = 24_000;

function sourceBuffers(): Map<string, AudioBuffer> {
	return new Map([
		['source-1', new MockAudioBuffer(1, SAMPLE_RATE, SAMPLE_RATE) as unknown as AudioBuffer],
	]);
}

function createEngine() {
	const context = new MockAudioContext() as unknown as EngineAudioContext;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 50,
	});
	engine.loadProject(createProject() as unknown as EngineProject, sourceBuffers());
	return { context, engine };
}

function host(engine: ReturnType<typeof createEngine>['engine']): EngineRuntimeHost {
	return engine as unknown as EngineRuntimeHost;
}

test('a play range bounds the run instead of the end of the timeline', async () => {
	const { engine } = createEngine();

	const range = engine.setPlayRange({ startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	assert.deepEqual(range, { startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	engine.seek(RANGE_START_FRAME);
	await engine.play();

	assert.equal(host(engine).playEndFrame, RANGE_END_FRAME);
	assert.ok(
		host(engine).playbackDurationFrames > RANGE_END_FRAME,
		'the timeline must outlast the range for this to be a measurement',
	);

	engine.stop();
	await engine.dispose();
});

test('a play range the playhead has already passed does not stop playback on the spot', async () => {
	const { engine } = createEngine();

	engine.setPlayRange({ startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	engine.seek(RANGE_END_FRAME + 1_000);
	await engine.play();

	assert.equal(host(engine).playEndFrame, host(engine).playbackDurationFrames);

	engine.stop();
	await engine.dispose();
});

test('a bounded run leaves the playhead on the boundary it stopped at', async () => {
	const { context, engine } = createEngine();

	engine.setPlayRange({ startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	engine.seek(RANGE_START_FRAME);
	await engine.play();
	// Run the audio clock past the end of the range and let the ticker observe it.
	(context as unknown as { currentTime: number }).currentTime += 1;
	await new Promise<void>((resolve) => { setTimeout(resolve, 80); });

	assert.equal(engine.getState().state, 'stopped');
	assert.equal(engine.getPositionFrames(), RANGE_END_FRAME);

	await engine.dispose();
});

test('leaving playback retires the play range so the next run is unbounded', async () => {
	const { engine } = createEngine();

	engine.setPlayRange({ startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	engine.seek(RANGE_START_FRAME);
	await engine.play();
	engine.stop();
	assert.equal(host(engine).playRange, null);

	await engine.play();
	assert.equal(host(engine).playEndFrame, host(engine).playbackDurationFrames);

	engine.stop();
	await engine.dispose();
});

test('pausing, and the clocked start recording uses, both retire the range', async () => {
	const { engine } = createEngine();

	engine.setPlayRange({ startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	engine.seek(RANGE_START_FRAME);
	await engine.play();
	engine.pause();
	assert.equal(host(engine).playRange, null, 'a resumed run says for itself what bounds it');

	engine.setPlayRange({ startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	await engine.playAt(0, RANGE_START_FRAME);
	assert.equal(host(engine).playRange, null);
	assert.equal(host(engine).playEndFrame, host(engine).playbackDurationFrames);

	engine.stop();
	await engine.dispose();
});

test('an enabled loop region keeps ownership of where playback ends', async () => {
	const { engine } = createEngine();

	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 4_800 });
	engine.setPlayRange({ startFrame: RANGE_START_FRAME, endFrame: RANGE_END_FRAME });
	await engine.play();

	assert.equal(host(engine).playEndFrame, 4_800);

	engine.stop();
	await engine.dispose();
});

test('a play range is clamped to the timeline and collapses to none when empty', async () => {
	const { engine } = createEngine();
	const timelineFrames = host(engine).playbackDurationFrames;

	assert.deepEqual(
		engine.setPlayRange({ startFrame: -50, endFrame: timelineFrames + 10_000 }),
		{ startFrame: 0, endFrame: timelineFrames },
	);
	assert.equal(engine.setPlayRange({ startFrame: 500, endFrame: 500 }), null);
	assert.equal(engine.setPlayRange(null), null);

	await engine.dispose();
});
