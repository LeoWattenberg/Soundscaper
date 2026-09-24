/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

test('controller surfaces a playback stream failure and releases its error subscription', async () => {
	const listeners = new Set<(error: unknown) => void>();
	const engine = Object.assign(createMemoryEngine(), {
		subscribePlaybackErrors(listener: (error: unknown) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createMemoryStore() as never,
		engine: engine as never,
		ffmpeg: createMemoryFfmpeg() as never,
	});
	try {
		await controller.ready;
		assert.equal(listeners.size, 1);
		const failure = new Error('PCM read failed after priming');
		for (const listener of listeners) listener(failure);
		assert.deepEqual(controller.getSnapshot().status, {
			message: 'Error: PCM read failed after priming',
			state: 'error',
			localization: { key: 'genericError', parameters: { message: 'PCM read failed after priming' } },
		});
	} finally {
		await controller.dispose();
	}
	assert.equal(listeners.size, 0);
});
