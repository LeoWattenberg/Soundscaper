/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { findControllerClip, findControllerSource, type ControllerClip, type ControllerProject }
	from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryFfmpeg, storedChannelSample } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore }
	from './helpers/audio-editor-controller-harness.js';

for (const mode of ['mixed left/right', 'mixed centered', 'pure stereo'] as const) {
	test(`Split stereo ${mode} extracts each source's actual stereo contribution atomically`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `r5-mixed-${mode}` });
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 2,
			durationSeconds: 0.1, frequency: 440 });
		const trackId = controller.getSnapshot().selectedTrackId;
		assert.equal(typeof trackId, 'string');
		if (typeof trackId !== 'string') throw new Error('Missing stereo track.');
		if (mode !== 'pure stereo') {
			controller.actions.track.add({ name: 'Mono recording' });
			await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1,
				durationSeconds: 0.1, frequency: 660 });
			const monoClip = controller.getSnapshot().selectedClipId;
			assert.equal(typeof monoClip, 'string');
			if (typeof monoClip !== 'string') throw new Error('Missing mono recording.');
			controller.actions.clip.move(monoClip, trackId, 4800);
		}
		const before = controller.getSnapshot().project!;
		const original = runtime.projectForCommandConsumers(before) as ControllerProject;
		const originalTrack = original.tracks.find(track => track.id === trackId);
		assert.ok(originalTrack);
		assert.equal(originalTrack.clipIds?.length, mode === 'pure stereo' ? 1 : 2);
		const history = controller.getSnapshot().history.undoEntries.length;
		const split = mode === 'mixed centered'
			? await controller.actions.track.splitStereoCenter(trackId)
			: await controller.actions.track.splitStereoLR(trackId);
		assert.ok(split);
		const after = controller.getSnapshot().project!;
		const projection = runtime.projectForCommandConsumers(after) as ControllerProject;
		for (const [side, targetId] of [[0, split.leftTrackId], [1, split.rightTrackId]] as const) {
			const target = projection.tracks.find(track => track.id === targetId);
			assert.ok(target);
			assert.equal(target.pan, mode === 'mixed centered' ? 0 : side === 0 ? -1 : 1);
			const originalClipIds: readonly string[] = originalTrack.clipIds ?? [];
			for (const clipId of originalClipIds) {
				const clip = findControllerClip(original, clipId);
				assert.ok(clip);
				const source = findControllerSource(original, clip.sourceId);
				assert.ok(source);
				const replacement: ControllerClip | undefined = projection.clips.find(candidate => target.clipIds?.includes(candidate.id)
					&& candidate.timelineStartFrame === clip.timelineStartFrame);
				assert.ok(replacement);
				const sample = await storedChannelSample(store, source.id, source.channelCount === 1 ? 0 : side, 32);
				const expected = Math.fround(sample * (source.channelCount === 1 ? Math.SQRT1_2 : 1));
				assert.equal(await storedChannelSample(store, replacement.sourceId, 0, 32), expected);
				assert.equal(replacement.durationFrames, clip.durationFrames);
				assert.equal(replacement.sourceStartFrame, clip.sourceStartFrame);
			}
		}
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, before.tracks);
		assert.deepEqual(controller.getSnapshot().project!.clips, before.clips);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, after.tracks);
		assert.deepEqual(controller.getSnapshot().project!.clips, after.clips);
	});
}
