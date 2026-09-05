/* SPDX-License-Identifier: AGPL-3.0-only */

// Seeking outside an enabled loop region while the transport is playing used to
// schedule the loop from the seeked frame, which put the next loop iteration in
// the past: Web Audio starts a past-dated source immediately from the loop
// offset, so every missed iteration played at once and the readout drifted away
// from the audible loop.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type {
	EngineAudioContext,
	EngineSourceBufferInput,
} from '../src/common/editor/engine/public-api.ts';
import { ENGINE_SCHEDULE_LOOP_AHEAD } from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import {
	MockOfflineAudioContext,
	createProject,
} from './helpers/audio-editor-runtime-harness.js';
import {
	MockAudioBuffer,
	MockAudioContext,
} from './helpers/mock-audio-context.js';

const SAMPLE_RATE = 48_000;
const LOOP_END_FRAME = 4_800;
const SEEK_FRAME = 20_000;
const CLOCK_EPSILON = 1e-9;

interface StartedSource {
	readonly started?: readonly [number, number, number | undefined];
	readonly loopStart?: number;
	readonly loopEnd?: number;
}

interface TestAudioContext {
	currentTime: number;
	readonly bufferSources: readonly StartedSource[];
}

function mockContext(): TestAudioContext {
	return new MockAudioContext() as unknown as TestAudioContext;
}

function sourceBuffers(): EngineSourceBufferInput {
	return new Map([
		['source-1', new MockAudioBuffer(1, SAMPLE_RATE, SAMPLE_RATE) as unknown as AudioBuffer],
	]);
}

function startTimesAfter(context: TestAudioContext, index: number): number[] {
	return context.bufferSources.slice(index).map((source) => source.started?.[0] ?? Number.NaN);
}

async function settle(): Promise<void> {
	await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

test('seeking past the loop end while playing restarts the loop instead of stacking past iterations', async () => {
	const context = mockContext();
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
		meterInterval: 50,
	});
	engine.loadProject(createProject() as unknown as EngineProject, sourceBuffers());
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: LOOP_END_FRAME });
	await engine.play();
	const scheduledBeforeSeek = context.bufferSources.length;
	context.currentTime = 0.05;

	const seeked = engine.seek(SEEK_FRAME);
	await settle();

	const startTimes = startTimesAfter(context, scheduledBeforeSeek);
	assert.ok(startTimes.length > 0, 'the seek must reschedule playback');
	assert.deepEqual(
		startTimes.filter((when) => !(when >= context.currentTime - CLOCK_EPSILON)),
		[],
		'no loop iteration may be started at a context time that has already passed',
	);
	assert.equal(seeked, 0);
	assert.equal(engine.getState().positionFrame, 0);

	engine.stop();
	await engine.dispose();
});

test('loop look-ahead skips whole iterations the context clock has already passed', async () => {
	const context = mockContext();
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
		meterInterval: 50,
	});
	engine.loadProject(createProject() as unknown as EngineProject, sourceBuffers());
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: LOOP_END_FRAME });
	await engine.play();
	const scheduledBeforeStall = context.bufferSources.length;

	// A stalled look-ahead tick leaves the next iteration far behind the clock.
	context.currentTime = 1;
	(engine as unknown as EngineRuntimeHost)[ENGINE_SCHEDULE_LOOP_AHEAD]();

	const startTimes = startTimesAfter(context, scheduledBeforeStall);
	assert.ok(startTimes.length > 0, 'the look-ahead must keep the loop scheduled');
	assert.deepEqual(
		startTimes.filter((when) => !(when >= context.currentTime - CLOCK_EPSILON)),
		[],
		'a missed loop iteration must be skipped, not started immediately',
	);

	engine.stop();
	await engine.dispose();
});

test('seeking past the loop end in StaffPad playback keeps the buffer offset inside the loop', async () => {
	const context = mockContext();
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
		offlineAudioContextFactory: (options) => (
			new MockOfflineAudioContext(options) as unknown as OfflineAudioContext
		),
		meterInterval: 1_000,
	});
	engine.loadProject(createProject() as unknown as EngineProject, sourceBuffers());
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: LOOP_END_FRAME });
	await engine.playAtSpeed(2, {
		preservePitch: true,
		pitchPreserver: async (channels: readonly Float32Array[]) => channels.map(() => new Float32Array(24_000)),
	});
	assert.equal(engine.getState().playbackMode, 'staffpad');
	context.currentTime = 0.02;

	engine.seek(SEEK_FRAME);
	await settle();

	const source = context.bufferSources[context.bufferSources.length - 1];
	const offset = source?.started?.[1] ?? Number.NaN;
	assert.ok(
		offset >= (source?.loopStart ?? 0) && offset < (source?.loopEnd ?? 0),
		`StaffPad seek offset ${offset} must sit inside [${source?.loopStart}, ${source?.loopEnd})`,
	);

	engine.stop();
	await engine.dispose();
});
