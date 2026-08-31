/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandVisual,
} from '../src/framescaper/editor-project-visual-commands.ts';
import type { FramescaperProjectVisual } from '../src/framescaper/editor-project-visual.ts';
import { visualProject } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;

test('removing a video track also removes its visual clips and adjustment targets', () => {
	const removed = applyFramescaperProjectCommandVisual(PROFILE, visualProject(), {
		type: 'track/remove', trackId: 'video-track',
	});
	const tracks = removed.tracks as readonly Readonly<{ id: string }>[];

	assert.equal(tracks.some(({ id }) => id === 'video-track'), false);
	assert.equal(removed.clips.some(({ kind }) => kind === 'still' || kind === 'generator'), false);
	assert.deepEqual(removed.videoAdjustmentLayers, []);
});

test('removing a source prunes only its unused mask input', () => {
	const project = structuredClone(visualProject()) as unknown as Data;
	const masks = project.videoMaskMattes as Data[];
	const inputs = masks[0]!.inputs as Data[];
	inputs[0]!.sourceRef = 'video-source';

	const removed = applyFramescaperProjectCommandVisual(
		PROFILE,
		project as unknown as FramescaperProjectVisual,
		{
			type: 'batch',
			commands: [
				{ type: 'clip/remove', clipId: 'video-clip' },
				{ type: 'project-bin/remove', clipId: 'bin-video' },
				{ type: 'source/remove', sourceId: 'video-source' },
			],
		},
	);

	assert.equal(removed.sources.some(({ id }) => id === 'video-source'), false);
	assert.deepEqual(removed.videoMaskMattes[0]?.inputs, []);
});

test('inherited commands retain the current still and generator selection', () => {
	const project = structuredClone(visualProject());
	selection(project).clipIds = ['still-clip', 'generator-clip'];
	const updated = applyFramescaperProjectCommandVisual(PROFILE, project, {
		type: 'track/update', trackId: 'audio-track', changes: { mute: true },
	});
	assert.deepEqual(selection(updated).clipIds, ['still-clip', 'generator-clip']);
});

test('nested inherited batches retain their final visual clip selection', () => {
	const selected = applyFramescaperProjectCommandVisual(PROFILE, visualProject(), {
		type: 'batch', commands: [{
			type: 'batch', commands: [{
				type: 'selection/set', startFrame: 0, endFrame: 0,
				clipIds: ['generator-clip'], trackIds: ['video-track'],
			}, { type: 'track/update', trackId: 'audio-track', changes: { mute: true } }],
		}],
	});
	assert.deepEqual(selection(selected).clipIds, ['generator-clip']);
});

function selection(project: FramescaperProjectVisual): { clipIds: string[] } {
	return project.selection as { clipIds: string[] };
}
