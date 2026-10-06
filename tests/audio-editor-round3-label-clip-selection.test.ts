/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

async function selectedClip(context: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round3-label-${context.name}` }),
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 0.8, frequency: 440 });
	controller.actions.timeline.selectClip(controller.getSnapshot().selectedClipId!);
	controller.actions.transport.seek(12_000);
	return { controller, engine };
}

function labelTimes(controller: Awaited<ReturnType<typeof selectedClip>>['controller']) {
	const track: unknown = controller.getSnapshot().project?.tracks?.find(track => 'type' in track && track.type === 'label');
	assert.ok(track && typeof track === 'object' && 'labels' in track && Array.isArray(track.labels));
	const label: unknown = track.labels[0];
	assert.ok(label && typeof label === 'object' && 'startFrame' in label && 'endFrame' in label);
	return { start: label.startFrame, end: label.endFrame };
}

test('Add label captures a selected clip range before adding its label track', async context => {
	const { controller, engine } = await selectedClip(context);
	controller.actions.labels.add();
	assert.deepEqual(labelTimes(controller), { start: 0, end: 38_400 });
	assert.equal(engine.getPositionFrames(), 12_000);
});

test('an explicitly requested point label retains its point instead of inheriting clip duration', async context => {
	const { controller } = await selectedClip(context);
	controller.actions.labels.add(null, { startFrame: 12_000 });
	assert.deepEqual(labelTimes(controller), { start: 12_000, end: 12_000 });
});

test('an explicit time selection remains authoritative over an earlier clip pick', async context => {
	const { controller } = await selectedClip(context);
	controller.actions.timeline.setExactSelection(4_800, 9_600);
	controller.actions.labels.add();
	assert.deepEqual(labelTimes(controller), { start: 4_800, end: 9_600 });
});
