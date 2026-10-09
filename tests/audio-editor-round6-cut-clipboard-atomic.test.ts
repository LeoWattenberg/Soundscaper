/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

interface Clip { readonly id: string; readonly sourceId: string }
interface Project { readonly clips: readonly Clip[] }

for (const action of ['cutLeaveGap', 'cutPerClipRipple', 'cutPerTrackRipple', 'cutAllTracksRipple'] as const) {
	test(`${action} preserves the previous clipboard on refusal and publishes a successful Cut`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const projectRuntime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime, sessionController: projectRuntime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round6-cut-atomic-${action}` }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.1, frequency: 440 });
		const first = controller.getSnapshot();
		assert.ok(first.selectedClipId);
		const clipA = (first.project as unknown as Project).clips.find(clip => clip.id === first.selectedClipId);
		assert.ok(clipA);
		const protectedTrackId = controller.actions.track.add({ name: 'Protected' });
		assert.ok(protectedTrackId);
		controller.actions.timeline.setSelection(0, 0, { trackIds: [protectedTrackId], clipIds: [] });
		await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.1, frequency: 660 });
		const second = controller.getSnapshot();
		assert.ok(second.selectedClipId);
		const clipB = (second.project as unknown as Project).clips.find(clip => clip.id === second.selectedClipId);
		assert.ok(clipB);
		assert.notEqual(clipA.sourceId, clipB.sourceId);
		controller.actions.timeline.selectClip(clipA.id);
		await controller.actions.edit.copy();
		controller.actions.timeline.selectClip(clipB.id);
		controller.actions.edit.commit({ type: 'track/update', trackId: protectedTrackId, changes: { locked: true } });
		const before = controller.getSnapshot();
		await controller.actions.edit[action]();
		const refused = controller.getSnapshot();
		assert.equal(refused.status.state, 'error');
		assert.deepEqual(refused.project, before.project);
		assert.equal(refused.history.undoEntries.length, before.history.undoEntries.length);
		const destination = controller.actions.track.add({ name: 'Paste destination' });
		assert.ok(destination);
		await controller.actions.edit.paste();
		const pastedA = controller.getSnapshot();
		const known = new Set([clipA.id, clipB.id]);
		const additionA = (pastedA.project as unknown as Project).clips.find(clip => !known.has(clip.id));
		assert.ok(additionA, JSON.stringify(pastedA.status));
		assert.equal(additionA.sourceId, clipA.sourceId);
		controller.actions.edit.undo();
		controller.actions.edit.commit({ type: 'track/update', trackId: protectedTrackId, changes: { locked: false } });
		controller.actions.timeline.selectClip(clipB.id);
		const historyBeforeCut = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.edit[action]();
		const cut = controller.getSnapshot();
		assert.equal(cut.history.undoEntries.length, historyBeforeCut + 1);
		assert.deepEqual((cut.project as unknown as Project).clips.map(clip => clip.id), action === 'cutAllTracksRipple' ? [] : [clipA.id]);
		controller.actions.timeline.selectTrack(destination);
		await controller.actions.edit.paste();
		const pastedB = controller.getSnapshot();
		const additionB = (pastedB.project as unknown as Project).clips.find(clip => clip.sourceId === clipB.sourceId);
		assert.ok(additionB, JSON.stringify(pastedB.status));
		assert.equal(additionB.sourceId, clipB.sourceId);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.clips, cut.project!.clips);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.clips, pastedB.project!.clips);
	});
}
