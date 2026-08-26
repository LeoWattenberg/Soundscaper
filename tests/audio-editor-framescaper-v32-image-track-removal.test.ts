/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFramescaperProjectCommandV32 } from '../src/framescaper/editor-project-v32-commands.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { addFramescaperV32BoundaryImage } from './helpers/framescaper-v32-boundary-fixture.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;

/**
 * Image clips are invisible to the inherited command runtime, so the V32 layer
 * captures them and puts them back afterwards. A timeline image belongs to
 * exactly one video track, so when the inherited command removed that track the
 * image has to go with it — restoring it would leave an ownerless clip that the
 * validator refuses, and the removal could never succeed.
 */
test('removing a video track removes the timeline image it owns', () => {
	const base = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const fixture = addFramescaperV32BoundaryImage(base);
	const trackId = String(
		fixture.project.tracks.find(({ type, locked }) => type === 'video' && !locked)?.id,
	);
	const removed = applyFramescaperProjectCommandV32(PROFILE, fixture.project, {
		type: 'track/remove', trackId,
	});

	assert.equal(removed.tracks.some(({ id }) => String(id) === trackId), false);
	assert.equal(
		removed.clips.some((clip) => String((clip as { id: unknown }).id) === fixture.clip.id),
		false,
		'the image clip is removed with the track that owned it',
	);
	assert.equal(
		removed.sources.some((source) => String((source as { id: unknown }).id) === fixture.source.id),
		true,
		'the image source stays available in the project',
	);
});

test('removing an unrelated track keeps the timeline image it does not own', () => {
	const base = createFramescaperProjectV32(PROFILE, framescaperV20Options());
	const fixture = addFramescaperV32BoundaryImage(base);
	const imageTrackId = String(
		fixture.project.tracks.find(({ type, locked }) => type === 'video' && !locked)?.id,
	);
	const other = fixture.project.tracks.find(({ id }) => String(id) !== imageTrackId);
	assert.ok(other, 'the fixture project has a second track');

	const removed = applyFramescaperProjectCommandV32(PROFILE, fixture.project, {
		type: 'track/remove', trackId: String(other.id),
	});

	assert.equal(
		removed.clips.some((clip) => String((clip as { id: unknown }).id) === fixture.clip.id),
		true,
		'the image survives removal of a track that never owned it',
	);
});
