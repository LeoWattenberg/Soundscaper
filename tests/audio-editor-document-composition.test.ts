/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COPY,
	createAudioEditorController,
	createMemoryClipTimePitchCache,
	createMemoryEngine,
	createProjectStore,
} from './helpers/audio-editor-controller-harness.js';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';

test('document composition retains project-bin clips across edits, undo and redo', async () => {
	let retained = new Set<string>();
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: {
			...createMemoryClipTimePitchCache(),
			retainClipIds(ids: ReadonlySet<string>) { retained = new Set(ids); },
		},
	});
	try {
		await controller.ready;
		const source = createAudioSource({ id: 'bin-source', name: 'Bin.wav', storageKey: 'bin-source', frameCount: 1000, channelCount: 1 });
		const clip = createAudioClip({ id: 'bin-only', sourceId: source.id, sourceDurationFrames: 1000, durationFrames: 1000 });
		controller.actions.edit.commit({ type: 'batch', commands: [
			{ type: 'source/add', source },
			{ type: 'project-bin/add', clip },
		] });
		assert.ok(retained.has(clip.id), 'bin-only clips must keep their render caches');
		controller.actions.edit.undo();
		assert.ok(retained.has(clip.id), 'redo history must keep bin-only clips');
		controller.actions.edit.redo();
		assert.ok(retained.has(clip.id), 'restored bin clips must stay live');
	} finally {
		await controller.dispose();
	}
});
