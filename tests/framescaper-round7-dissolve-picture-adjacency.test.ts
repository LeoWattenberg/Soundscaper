/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareFramescaperSelectedAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-authoring-workflows.ts';
import { pairProject, view, apply } from './helpers/round7-dissolve-project.ts';

type Data = Record<string, unknown>;

test('the exact adjacent pair picker does not skip a generated Solid picture', async () => {
	let project = pairProject(5, 5);
	assert.equal(view(project).transitionPairs.length, 1, 'healthy adjacent camera clips remain available');
	const generated = await prepareFramescaperSelectedAuthoringFinishing('video-solid', project);
	project = apply(project, generated.command);
	assert.equal(view(project).transitionPairs.length, 1, 'a later Solid does not remove the adjacent camera pair');
	const solid = (project.clips as readonly Data[]).find(clip => clip.kind === 'generator');
	assert.ok(solid);
	// These are the same ordinary clip moves offered by visible Clip properties.
	project = apply(project, { type: 'clip/move', clipId: 'incoming-video', trackId: 'video-track', timelineStartFrame: 55 * 4_800 });
	project = apply(project, { type: 'clip/move', clipId: solid.id, trackId: 'video-track', timelineStartFrame: 5 * 4_800 });
	const clips = project.clips as readonly Data[];
	assert.equal(clips.find(clip => clip.id === solid.id)?.sequenceStartFrame, 5);
	assert.equal(clips.find(clip => clip.id === 'incoming-video')?.sequenceStartFrame, 55);
	assert.deepEqual(view(project).transitionPairs, [], 'the intervening five-second picture breaks camera adjacency');
	project = apply(project, { type: 'clip/move', clipId: solid.id, trackId: 'video-track', timelineStartFrame: 10 * 4_800 });
	project = apply(project, { type: 'clip/move', clipId: 'incoming-video', trackId: 'video-track', timelineStartFrame: 5 * 4_800 });
	assert.equal(view(project).transitionPairs.length, 1, 'restoring ordinary adjacency admits the same camera identities');
});
