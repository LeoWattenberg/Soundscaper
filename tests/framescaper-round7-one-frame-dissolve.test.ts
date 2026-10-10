/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareFramescaperVideoTransitionAllocations, snapshotFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { pairProject, view, apply } from './helpers/round7-dissolve-project.ts';

test('the advertised one-frame dissolve works for ordinary two-frame camera clips', async () => {
	const project = pairProject(2, 2);
	const authoring = view(project);
	const pair = authoring.transitionPairs[0];
	assert.ok(pair);
	assert.equal(pair.maximumDurationFrames, 1);
	const authored = await prepareFramescaperSelectedVisualAuthoringFinishing({
		surface: 'video-transition-dissolve', project,
		request: { fence: authoring.fence, clipId: 'video-clip', operation: 'apply', pairId: pair.id, durationFrames: 1 },
		store: {} as never,
	});
	const prepared = prepareFramescaperVideoTransitionAllocations(PROFILE, project,
		snapshotFramescaperProjectCommand(authored.command), () => 'healthy-transition');
	assert.equal(validateFramescaperProject(PROFILE, apply(project, prepared)), true);
});

test('an ordinary one-frame camera clip does not advertise an impossible proper dissolve', () => {
	const project = pairProject(1, 10);
	const authoring = view(project);
	assert.deepEqual(authoring.transitionPairs, [], 'one-frame outgoing clips cannot retain their own edge before an overlap');
	assert.equal(authoring.selectedPairId, null);
});

