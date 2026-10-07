/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { floatWave } from './helpers/float32-wave-fixture.ts';

for (const mixed of [false, true]) test(`public Delete removes generated visual${mixed ? ' and audio together' : ''} in one history entry`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(authoring);
	await authoring.run('video-title');
	const visualId = String(controller.project?.clips.at(-1)?.id);
	if (mixed) {
		const pcm = new Float32Array(4_800).fill(0.25);
		await controller.actions.project.importFiles([new File([Uint8Array.from(floatWave(48_000, 1,
			new Uint8Array(pcm.buffer)))], 'tone.wav', { type: 'audio/wav' })]);
	}
	controller.actions.timeline.selectClip(visualId);
	if (mixed) {
		const audio = controller.project?.clips.find(clip => clip.kind === 'audio');
		assert.ok(audio);
		controller.actions.timeline.selectClip(String(audio.id), { additive: true });
	}
	const before = structuredClone(controller.project);
	assert.ok(before);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.deleteLeaveGap();
	assert.deepEqual(controller.project?.clips, []);
	assert.equal(controller.getSnapshot().selectedClipId, null);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.sources, before.sources);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, []);
});
