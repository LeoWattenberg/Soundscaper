/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	createAudioEditorController,
	createMemoryEngine,
} from './helpers/audio-editor-controller-harness.js';

test('controller copies one configured rack effect adjacently with one undo entry', async () => {
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en', store: createMemoryStore(),
		engine: createMemoryEngine(), ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	try {
		const trackId = controller.getSnapshot().project.tracks[0].id;
		const sourceId = controller.actions.effects.add({
			scope: 'track', trackId, type: 'delay',
			options: {
				enabled: false,
				params: { time: 0.375, feedback: 0.45, mix: 0.3 },
				context: { routing: 'parallel' },
				state: { memory: [1, 2, 3] },
			},
		});
		const highpassId = controller.actions.effects.add({ scope: 'track', trackId, type: 'highpass' });
		const historyBeforeCopy = controller.getSnapshot().history.undoEntries.length;
		const copiedId = controller.actions.effects.copy('track', trackId, sourceId);

		let snapshot = controller.getSnapshot();
		let effects = snapshot.project.tracks[0].effects;
		assert.equal(snapshot.history.undoEntries.length, historyBeforeCopy + 1);
		assert.deepEqual(effects.map((effect) => effect.type), ['delay', 'delay', 'highpass']);
		assert.notEqual(copiedId, sourceId);
		assert.equal(effects[1].id, copiedId);
		assert.deepEqual(configuredEffect(effects[1]), configuredEffect(effects[0]));

		controller.actions.edit.undo();
		effects = controller.getSnapshot().project.tracks[0].effects;
		assert.deepEqual(effects.map(({ id, type }) => ({ id, type })), [
			{ id: sourceId, type: 'delay' },
			{ id: highpassId, type: 'highpass' },
		]);
		controller.actions.edit.redo();
		snapshot = controller.getSnapshot();
		effects = snapshot.project.tracks[0].effects;
		assert.equal(effects[1].id, copiedId);
		assert.deepEqual(configuredEffect(effects[1]), configuredEffect(effects[0]));
	} finally {
		await controller.dispose();
	}
});

function configuredEffect(effect) {
	return {
		type: effect.type, enabled: effect.enabled, params: effect.params,
		context: effect.context, state: effect.state,
	};
}
