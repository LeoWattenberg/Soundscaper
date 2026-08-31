/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE as PROFILE } from
	'../src/framescaper/editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandTransitions,
	canonicalTransitionEdgesForProjectTransitions,
} from '../src/framescaper/editor-project-transitions-commands.ts';
import { transitionProject } from './helpers/framescaper-unified-render-project-fixture.ts';

test('transition commands preserve millisecond precision from Date options', () => {
	const project = transitionProject();
	const track = project.tracks.find(({ id }) => id === 'video-track');
	assert.ok(track?.type === 'video');
	const transition = track.videoTransitions[0];
	assert.ok(transition);
	const edges = canonicalTransitionEdgesForProjectTransitions(
		PROFILE, project, track.id, transition.id,
	);
	const now = new Date('2026-08-31T12:34:56.789Z');
	const updated = applyFramescaperProjectCommandTransitions(PROFILE, project, {
		type: 'video-transition/set', trackId: track.id, transitionId: transition.id,
		expectedTransition: transition, transition, expectedEdges: edges, edges,
	}, { now });
	assert.equal(updated.updatedAt, now.toISOString());
});
