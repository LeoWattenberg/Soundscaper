/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createProject } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

const START_FRAME = 12_000;

function fixture() {
	const context = new MockAudioContext();
	const project = createProject() as unknown as EngineProject;
	const sources = new Map([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
	]);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
	});
	engine.loadProject(project, sources);
	return { context, engine, project, sources };
}

test('Stop returns to the nonzero playback start and publishes that position', async () => {
	const { context, engine } = fixture();
	try {
		for (const start of [START_FRAME, 24_000]) {
			engine.seek(start);
			await engine.play();
			context.currentTime += 0.1;
			assert.ok(engine.getPositionFrames() > start);
			const positions: number[] = [];
			const unsubscribe = engine.subscribePosition((frame) => { positions.push(frame); });
			engine.stop();
			unsubscribe();
			assert.equal(engine.getState().state, 'stopped');
			assert.equal(engine.getPositionFrames(), start);
			assert.equal(positions.at(-1), start);
		}
	} finally {
		await engine.dispose();
	}
});

test('Stop on an idle transport keeps the editing cursor where the user put it', async () => {
	const { engine } = fixture();
	try {
		engine.seek(START_FRAME);
		engine.stop();
		assert.equal(engine.getPositionFrames(), START_FRAME);
	} finally {
		await engine.dispose();
	}
});

test('selection playback returns to its actual start and clears its playback bound', async () => {
	const { context, engine } = fixture();
	try {
		engine.setPlayRange({ startFrame: START_FRAME, endFrame: 36_000 });
		engine.seek(START_FRAME);
		await engine.play();
		context.currentTime += 0.1;
		engine.stop();
		assert.equal(engine.getPositionFrames(), START_FRAME);
		await engine.play();
		context.currentTime += 0.6;
		assert.ok(engine.getPositionFrames() > 36_000, 'a fresh ordinary run is unbounded');
	} finally {
		await engine.dispose();
	}
});

test('loop playback returns to the loop start when playback had to enter the loop', async () => {
	const { context, engine } = fixture();
	try {
		engine.setLoop({ enabled: true, startFrame: START_FRAME, endFrame: 24_000 });
		engine.seek(0);
		await engine.play();
		context.currentTime += 0.4;
		engine.stop();
		assert.equal(engine.getPositionFrames(), START_FRAME);
	} finally {
		await engine.dispose();
	}
});

test('pause and resume preserve the original playback start for Stop', async () => {
	const { context, engine } = fixture();
	try {
		engine.seek(START_FRAME);
		await engine.play();
		context.currentTime += 0.1;
		engine.pause();
		await engine.play();
		context.currentTime += 0.1;
		engine.stop();
		assert.equal(engine.getPositionFrames(), START_FRAME);
	} finally {
		await engine.dispose();
	}
});

test('seeking during playback keeps the original playback start for Stop', async () => {
	const { context, engine } = fixture();
	try {
		engine.seek(START_FRAME);
		await engine.play();
		await new Promise<void>((resolve) => {
			const unsubscribe = engine.subscribePosition(() => { unsubscribe(); resolve(); });
			engine.seek(24_000);
		});
		context.currentTime += 0.1;
		assert.ok(engine.getPositionFrames() > 24_000);
		engine.stop();
		assert.equal(engine.getPositionFrames(), START_FRAME);
	} finally {
		await engine.dispose();
	}
});

test('variable-speed playback returns to its playback start', async () => {
	const { context, engine } = fixture();
	try {
		engine.seek(START_FRAME);
		await engine.playAtSpeed(1.5);
		context.currentTime += 0.1;
		assert.ok(engine.getPositionFrames() > START_FRAME);
		engine.stop();
		assert.equal(engine.getPositionFrames(), START_FRAME);
	} finally {
		await engine.dispose();
	}
});

test('a project refresh during playback preserves the original playback start', async () => {
	const { context, engine, project, sources } = fixture();
	try {
		engine.seek(START_FRAME);
		await engine.play();
		context.currentTime += 0.1;
		await engine.applyProject({ ...project }, sources);
		context.currentTime += 0.1;
		engine.stop();
		assert.equal(engine.getPositionFrames(), START_FRAME);
	} finally {
		await engine.dispose();
	}
});

test('loading a project retires the previous playback start', async () => {
	const { context, engine, project, sources } = fixture();
	try {
		engine.seek(START_FRAME);
		await engine.play();
		context.currentTime += 0.1;
		engine.loadProject({ ...project, id: 'next-project' }, sources);
		engine.seek(24_000);
		engine.stop();
		assert.equal(engine.getPositionFrames(), 24_000);
	} finally {
		await engine.dispose();
	}
});

test('a fresh cut preview replaces the prior playback start and preserves it on resume', async () => {
	const { context, engine } = fixture();
	try {
		engine.renderMix = async (options = {}) => new MockAudioBuffer(
			1, Number(options.endFrame) - Number(options.startFrame), 48_000,
		) as unknown as AudioBuffer;
		engine.seek(START_FRAME);
		await engine.play();
		await engine.playCutPreview({ startFrame: 30_000, endFrame: 40_000 });
		const previewStart = engine.getPositionFrames();
		assert.equal(previewStart, 0);
		context.currentTime += 0.1;
		engine.pause();
		await engine.play();
		context.currentTime += 0.1;
		engine.stop();
		assert.equal(engine.getPositionFrames(), previewStart);
	} finally {
		await engine.dispose();
	}
});
