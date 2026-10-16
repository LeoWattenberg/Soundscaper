/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { evaluateAudioWarpSourceFrame, type AudioWarpRuntimeClip, type AudioWarpRuntimeProject } from '../src/common/editor/audio-warp-runtime.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import type { ProjectBinPreviewEngine } from '../src/common/editor/controller/import/internal/project-bin/project-bin-preview-service.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createHarness } from './helpers/project-bin-service-harness.ts';

function fixture(musical = false, warped = true) {
	let project = createCurrentAudioEditorProject({ id: 'bin-warp-preview', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'first', beat: 0, bpm: 120 }, { id: 'second', beat: 2, bpm: 60 },
		] } });
	project = applyEditorCommand(project, { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'audio', storageKey: 'audio', name: 'Interview.wav', sampleRate: 48_000, frameCount: 72_000, channelCount: 1 } },
		{ type: 'track/add', track: { id: 'track', name: 'Interview' } },
		{ type: 'clip/add', trackId: 'track', clip: { id: 'clip', kind: 'audio', title: 'Interview', sourceId: 'audio',
			timelineStartFrame: 24_000, durationFrames: 72_000, sourceStartFrame: 0, sourceDurationFrames: 72_000,
			...(musical ? { anchor: 'musical', musicalStartBeat: 1, musicalExtent: 'beat', musicalDurationBeats: 2 } : {}),
			...(warped ? { warpMap: normalizeAudioWarpMap({ feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: musical ? 1 : 24_000, source: 48_000, mode: 'forward' },
				{ outer: musical ? 2 : 72_000, source: 72_000, mode: 'forward' },
			] }) } : {}) } },
	] });
	return applyEditorCommand(project, { type: 'project-bin/move-from-timeline', clipIds: ['clip'] });
}

for (const musical of [false, true]) {
	test(`bin audition preserves ${musical ? 'musical' : 'sample'} warp source positions and original project`, async () => {
		const project = fixture(musical);
		const original = structuredClone(project);
		let loaded: EngineProject | null = null;
		const engine: ProjectBinPreviewEngine = {
			loadProject: (value) => { loaded = value; },
			play: async () => {
				assert.ok(loaded);
				const previewClip = loaded.clips![0] as unknown as AudioWarpRuntimeClip;
				const originalClip = { ...project.projectBin.clips[0], timelineStartFrame: 24_000, durationFrames: 72_000 } as AudioWarpRuntimeClip;
				for (const frame of [0, 6_000, 18_000, 24_000, 48_000, 71_999, 72_000]) {
					assert.deepEqual(evaluateAudioWarpSourceFrame(loaded as unknown as AudioWarpRuntimeProject, previewClip, frame),
						evaluateAudioWarpSourceFrame(project, originalClip, frame + 24_000));
				}
			}, pause: () => undefined,
		};
		const harness = createHarness(project, { createPreviewEngine: () => engine });
		await harness.service.playPauseProjectBinClip('clip');
		assert.equal(harness.preview?.state, 'playing');
		assert.deepEqual(project, original);
	});
}

test('ordinary unwarped bin audition still retains its native source window', async () => {
	let loaded: EngineProject | null = null;
	const engine: ProjectBinPreviewEngine = {
		loadProject: (value) => { loaded = value; }, play: async () => undefined, pause: () => undefined,
	};
	const harness = createHarness(fixture(false, false), { createPreviewEngine: () => engine });
	await harness.service.playPauseProjectBinClip('clip');
	assert.ok(loaded);
	const clip = (loaded as EngineProject).clips![0]!;
	assert.equal(clip.sourceDurationFrames, 72_000);
	assert.equal(clip.timelineStartFrame, 0);
	assert.equal(clip.warpMap, null);
});
