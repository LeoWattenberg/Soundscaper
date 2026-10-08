/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { findControllerClip, findControllerSource, type ControllerProject }
	from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryFfmpeg, storedChannelSample } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore }
	from './helpers/audio-editor-controller-harness.js';

for (const [destinationWidth, copiedWidth] of [[2, 1], [2, 2], [1, 1]] as const) {
	test(`joined paste ${String(copiedWidth)}→${String(destinationWidth)} preserves actual channel levels and history`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false,
			databaseName: `r5-joined-level-${String(destinationWidth)}-${String(copiedWidth)}` });
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.preferences.update({ editing: { alwaysPasteAsNewClip: false } });
		await controller.actions.generators.generate('tone', { amplitude: 0.1, channelCount: destinationWidth,
			durationSeconds: 0.1, frequency: 440 });
		const targetTrack = controller.getSnapshot().selectedTrackId;
		const targetClip = controller.getSnapshot().selectedClipId;
		assert.equal(typeof targetTrack, 'string'); assert.equal(typeof targetClip, 'string');
		if (typeof targetTrack !== 'string' || typeof targetClip !== 'string') throw new Error('Missing target.');
		controller.actions.track.add({ name: 'Copied recording' });
		await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: copiedWidth,
			durationSeconds: 0.1, frequency: 660 });
		const generated = runtime.projectForCommandConsumers(controller.getSnapshot().project!) as ControllerProject;
		const copiedClip = findControllerClip(generated, controller.getSnapshot().selectedClipId);
		assert.ok(copiedClip);
		controller.actions.edit.copy();
		controller.actions.edit.deleteLeaveGap();
		controller.actions.timeline.selectClip(targetClip);
		controller.actions.timeline.setSelection(2400, 2400, { trackIds: [targetTrack] });
		controller.actions.transport.seek(2400);
		const before = controller.getSnapshot().project!;
		const original = runtime.projectForCommandConsumers(before) as ControllerProject;
		const originalTarget = findControllerClip(original, targetClip);
		assert.ok(originalTarget);
		const history = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.edit.paste();
		const after = controller.getSnapshot().project!;
		const projection = runtime.projectForCommandConsumers(after) as ControllerProject;
		const joined = findControllerClip(projection, targetClip);
		assert.ok(joined);
		assert.equal(projection.clips.length, 1);
		assert.equal(joined.durationFrames, 9600);
		assert.equal(findControllerSource(projection, joined.sourceId)?.channelCount, destinationWidth);
		for (let channel = 0; channel < destinationWidth; channel += 1) {
			const originalSample = await storedChannelSample(store, copiedClip.sourceId,
				copiedWidth === 1 ? 0 : channel, 256);
			assert.equal(await storedChannelSample(store, joined.sourceId, channel, 2656),
				Math.fround(originalSample * (copiedWidth === 1 && destinationWidth === 2 ? Math.SQRT1_2 : 1)));
			const untouched = await storedChannelSample(store, originalTarget.sourceId, channel, 256);
			assert.equal(await storedChannelSample(store, joined.sourceId, channel, 256), untouched);
			assert.equal(await storedChannelSample(store, joined.sourceId, channel, 7456),
				await storedChannelSample(store, originalTarget.sourceId, channel, 2656));
		}
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.clips, before.clips);
		assert.deepEqual(controller.getSnapshot().project!.tracks, before.tracks);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.clips, after.clips);
		assert.deepEqual(controller.getSnapshot().project!.tracks, after.tracks);
	});
}
