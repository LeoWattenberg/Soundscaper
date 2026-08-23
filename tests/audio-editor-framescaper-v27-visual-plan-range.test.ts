/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperVideoVisualPlanV27 } from '../src/framescaper/video-export-visual-plan-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

/**
 * Playback plays every clip on the timeline, so the picture-only export's
 * 'project' range must cover every clip too — the keyed route already does.
 * A range computed only from stills and generators silently cut the audio
 * tail out of the delivered file.
 */
test('the visual export project range covers audio clips beyond the last picture', () => {
	const options = framescaperV20Options();
	options.clips = (options.clips as Record<string, unknown>[])
		.filter((clip) => clip.id !== 'video-clip');
	(options.clips as Record<string, unknown>[]).push({
		schemaVersion: 1, kind: 'generator', id: 'generator-clip',
		sourceId: 'generator-source', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 5,
		sourceInFrame: 0, sourceFrameCount: 5,
	});
	const audioSource = (options.sources as Record<string, unknown>[])
		.find((source) => source.id === 'audio-source')!;
	audioSource.frameCount = 96_000;
	const audioClip = (options.clips as Record<string, unknown>[])
		.find((clip) => clip.id === 'audio-clip')!;
	audioClip.sourceDurationFrames = 96_000;
	audioClip.durationFrames = 96_000;
	const tracks = options.tracks as Record<string, unknown>[];
	tracks[0]!.clipIds = ['generator-clip'];
	const project = createFramescaperProjectV27(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Wash',
				width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 }, frameCount: 100,
				generator: { kind: 'solid', color: '#ffffffff' },
			}],
		},
	});
	const plan = createFramescaperVideoVisualPlanV27(project, {
		canonicalProject: project, exportProject: project,
		format: 'mp4', range: 'project', includeAudio: true, canvas: undefined,
	} as never);
	assert.equal(
		plan.range.endFrame, 96_000,
		'the project range extends to the audio clip end, not the last picture',
	);
	assert.equal(plan.range.durationFrames, 96_000);
	assert.ok(plan.inputs.some((input) => (input as { kind?: unknown }).kind === 'staged-audio-mix'));
});
