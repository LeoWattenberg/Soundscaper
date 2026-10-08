/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { prepareFramescaperVideoTransitionAllocationsFinishing } from '../src/framescaper/editor-project-finishing-transition-allocation.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('transition preparation retains an inherited nested transaction using existing clip identities', () => {
	const project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const command = { type: 'batch' as const, commands: [{ type: 'batch' as const, commands: [
		{ type: 'track/update' as const, trackId: 'video-track', changes: { name: 'Picture copy' } },
		{ type: 'selection/set' as const, startFrame: 0, endFrame: 0,
			trackIds: ['video-track'], clipIds: ['video-clip'] },
	] }] };
	const original = structuredClone(project);
	const prepared = prepareFramescaperVideoTransitionAllocationsFinishing(PROFILE, project, command, prefix => `${prefix}-new`);
	assert.deepEqual(prepared, command);
	assert.deepEqual(project, original);
	const applied = applyFramescaperProjectCommandFinishing(PROFILE, project, prepared);
	assert.equal(applied.tracks.find(track => track.id === 'video-track')?.name, 'Picture copy');
	assert.deepEqual(applied.selection.clipIds, ['video-clip']);
	assert.deepEqual(applied.clips, project.clips);
});
