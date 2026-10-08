/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectBinPeakRanges } from '../src/common/editor/ui/workspace/project-bin-model.ts';

test('bin warp columns retain musical tempo authority and unavailable media draws nothing', () => {
	const project = createSoundscaperProject({ id: 'musical-pause', sampleRate: 48_000,
		sources: [{ id: 'recording', kind: 'audio', name: 'Pause.wav', frameCount: 16,
			channelCount: 1, sampleRate: 48_000, storageKey: 'recording' }],
		projectBin: { clips: [{ id: 'excerpt', kind: 'audio', sourceId: 'recording', anchor: 'musical',
			musicalStartBeat: { num: 1, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 1 },
			sourceStartFrame: 0, sourceDurationFrames: 16,
			warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' },
				{ outer: { num: 1, den: 2 }, source: 12, mode: 'forward' }, { outer: 1, source: 16, mode: 'forward' }] } }] },
	});
	const clip = project.projectBin.clips[0]!;
	const owned = { ...clip, binItemId: clip.binItemId ?? undefined };
	const samples = Float32Array.from({ length: 16 }, (_, index) => index >= 4 && index < 8 ? 0 : 0.5);
	const visual = { buffer: { length: 16, numberOfChannels: 1, getChannelData: () => samples } };
	const ranges = projectBinPeakRanges(visual, owned, 16, project);
	assert.deepEqual(ranges[3], { minimum: 0, maximum: 0 });
	assert.deepEqual(ranges[4], { minimum: 0, maximum: 0 });
	assert.deepEqual(ranges[8], { minimum: 0.5, maximum: 0.5 });
	assert.deepEqual(projectBinPeakRanges({}, owned, 16, project), []);
});

for (const cached of [false, true]) {
	test(`bin drawing keeps the authored nonlinear pause, cached ${String(cached)}`, () => {
		let project = createSoundscaperProject({ id: 'pause', sampleRate: 48_000,
			sources: [{ id: 'recording', kind: 'audio', name: 'Pause.wav', frameCount: 16,
				channelCount: 1, sampleRate: 48_000, storageKey: 'recording' }],
			clips: [{ id: 'excerpt', kind: 'audio', sourceId: 'recording', timelineStartFrame: 120,
				durationFrames: 16, sourceStartFrame: 0, sourceDurationFrames: 16,
				warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' },
					{ outer: 8, source: 12, mode: 'forward' }, { outer: 16, source: 16, mode: 'forward' }] } }],
			tracks: [{ id: 'voice', type: 'audio', clipIds: ['excerpt'] }],
		});
		project = applySoundscaperProjectCommand(project, { type: 'project-bin/move-from-timeline', clipIds: ['excerpt'] });
		const original = structuredClone(project);
		const clip = project.projectBin.clips[0]!;
		const samples = Float32Array.from({ length: 16 }, (_, index) => index >= 4 && index < 8 ? 0 : 0.5);
		const visual = cached ? { peaks: { levels: [{ blockSize: 1,
			channels: [{ minimums: samples, maximums: samples }] }] } }
			: { buffer: { length: samples.length, numberOfChannels: 1, getChannelData: () => samples } };
		const ranges = projectBinPeakRanges(visual, { ...clip, binItemId: clip.binItemId ?? undefined }, 16, project);
		assert.deepEqual(ranges[3], { minimum: 0, maximum: 0 });
		assert.deepEqual(ranges[4], { minimum: 0, maximum: 0 });
		assert.deepEqual(ranges[0], { minimum: 0.5, maximum: 0.5 });
		assert.deepEqual(ranges[8], { minimum: 0.5, maximum: 0.5 });
		assert.deepEqual(projectBinPeakRanges(visual, { ...clip, binItemId: clip.binItemId ?? undefined }, 1, project),
			[{ minimum: 0, maximum: 0.5 }]);
		assert.deepEqual(project, original);
		assert.deepEqual(samples, Float32Array.from({ length: 16 }, (_, index) => index >= 4 && index < 8 ? 0 : 0.5));
	});
}
