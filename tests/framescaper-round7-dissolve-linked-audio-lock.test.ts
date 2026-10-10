/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { pairProject, view } from './helpers/round7-dissolve-project.ts';

type Data = Record<string, unknown>;

function linkedPair(locked: boolean): FramescaperProject {
	const pair = pairProject(10, 10);
	return {
		...pair,
		clips: (pair.clips as readonly Data[]).map(clip => clip.id === 'incoming-video'
			? { ...clip, avLinkId: 'incoming-link' } : clip.id === 'audio-clip'
				? { ...clip, avLinkId: 'incoming-link', timelineStartFrame: 48_000 } : clip),
		tracks: (pair.tracks as readonly Data[]).map(track => ({ ...track,
			laneGroupId: 'camera-lanes', ...(track.type === 'audio' ? { locked } : {}),
		})),
	} as FramescaperProject;
}

test('a normal unlocked A/V pair advertises and builds the linked audio dissolve move', async () => {
	const project = linkedPair(false);
	assert.equal(validateFramescaperProject(PROFILE, project), true);
	const model = view(project);
	const pair = model.transitionPairs[0];
	assert.ok(pair);
	const result = await prepareFramescaperSelectedVisualAuthoringFinishing({
		surface: 'video-transition-dissolve', project, store: {} as never,
		request: { fence: model.fence, clipId: 'video-clip', operation: 'apply', pairId: pair.id, durationFrames: 3 },
	});
	const command = result.command as Data;
	assert.equal(command.type, 'batch');
	assert.ok((command.commands as readonly Data[]).some(step => step.clipId === 'audio-clip'
		&& step.timelineStartFrame === 33_600));
});

test('locking only the incoming camera audio refuses its move and removes the doomed dissolve pair', async () => {
	const project = linkedPair(true);
	const model = view(project);
	const unlocked = view(linkedPair(false));
	await assert.rejects(prepareFramescaperSelectedVisualAuthoringFinishing({
		surface: 'video-transition-dissolve', project, store: {} as never,
		request: { fence: model.fence, clipId: 'video-clip', operation: 'apply',
			pairId: unlocked.transitionPairs[0]!.id, durationFrames: 3 },
	}), /selected dissolve pair is stale/u);
	assert.deepEqual(model.transitionPairs, [], 'the audio partner is independently locked through its track menu');
	assert.equal(model.selectedPairId, null);
});

test('an unrelated locked audio recording leaves the healthy picture dissolve available', () => {
	const project = pairProject(10, 10);
	const unrelated = { ...project, tracks: (project.tracks as readonly Data[])
		.map(track => ({ ...track, ...(track.type === 'audio' ? { locked: true } : {}) })) } as FramescaperProject;
	assert.equal(view(unrelated).transitionPairs.length, 1);
});
