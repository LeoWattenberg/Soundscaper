/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COPY,
	createAudioEditorController,
	createProjectStore,
} from './helpers/audio-editor-controller-harness.js';
import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';

test('document composition retains project-bin clips across edits, undo and redo', async () => {
	let retained = new Set<string>();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	const clipTimePitchCache = new ClipTimePitchRenderCacheCoordinator({ store });
	const retainClipIds = clipTimePitchCache.retainClipIds.bind(clipTimePitchCache);
	clipTimePitchCache.retainClipIds = (ids: ReadonlySet<string>) => {
		retained = new Set(ids);
		return retainClipIds(ids);
	};
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY,
		store,
		engine: createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null }),
		clipTimePitchCache,
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
