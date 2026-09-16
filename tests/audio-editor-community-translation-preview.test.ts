/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

test('controller preview republishes current wording without editing history, projects or playback', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, {
		copy: COPY, locale: 'en', headless: true,
		engine: engine as unknown as Options['engine'],
		store: createMemoryStore() as unknown as Options['store'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	try {
		await controller.ready;
		engine.play();
		const originalProject = controller.project;
		const originalSnapshot = controller.getSnapshot();
		const published = controller.presentationLocalization.getSnapshot();
		let notifications = 0;
		const unsubscribe = controller.subscribe(() => { notifications += 1; });
		controller.presentationLocalization.applyPreview('de', { ready: 'Bereit', track: 'Entwurfsspur', untitledProject: 'Entwurfsprojekt' });
		assert.equal(controller.getSnapshot().status.message, 'Bereit');
		assert.equal(controller.engine, engine);
		assert.equal(engine.state, 'playing');
		assert.equal(engine.disposeCalls, 0);
		assert.equal(controller.project, originalProject);
		assert.deepEqual(controller.getSnapshot().history, originalSnapshot.history);
		assert.deepEqual(controller.getSnapshot().projectTabs, originalSnapshot.projectTabs);
		assert.equal(controller.getSnapshot().save.state, originalSnapshot.save.state);
		assert.ok(notifications > 0);
		assert.equal(published.copy.ready, COPY.ready);
		controller.presentationLocalization.resetPreview();
		assert.equal(controller.getSnapshot().status.message, COPY.ready);
		assert.equal(controller.project, originalProject);
		assert.equal(engine.state, 'playing');
		controller.presentationLocalization.applyPreview('de', { track: 'Entwurfsspur' });
		const trackId = controller.actions.track.add();
		assert.equal(controller.project?.tracks.find(track => track.id === trackId)?.name, `${COPY.track} 2`);
		unsubscribe();
	} finally {
		await controller.dispose();
		controller.presentationLocalization.resetPreview();
		assert.equal(engine.disposeCalls, 1);
	}
});
