/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	capturePersistedTrackLockAuthority,
} from '../src/common/editor/controller/clip-video/internal/trim/persisted-track-lock-authority.ts';

test('persisted track-lock authority admits only strict locks with non-empty string IDs', () => {
	const isTrackLocked = capturePersistedTrackLockAuthority({
		tracks: [
			{ id: 'locked', locked: true },
			{ id: 'unlocked', locked: false },
			{ id: 'truthy', locked: 1 },
			{ id: '', locked: true },
			{ id: 42, locked: true },
			null,
			[],
			'not-a-track',
		],
	});
	assert.equal(isTrackLocked('locked'), true);
	for (const trackId of ['unlocked', 'truthy', '', '42', 'missing']) {
		assert.equal(isTrackLocked(trackId), false, trackId);
	}
});

test('persisted track-lock authority treats malformed project track collections as unlocked', () => {
	for (const project of [null, undefined, [], {}, { tracks: null }, { tracks: {} }]) {
		const isTrackLocked = capturePersistedTrackLockAuthority(project);
		assert.equal(isTrackLocked('track'), false);
	}
});

test('persisted track-lock authority is an immutable snapshot of one planning project read', () => {
	const track = { id: 'track', locked: true };
	const project = { tracks: [track] };
	const isTrackLocked = capturePersistedTrackLockAuthority(project);
	track.id = 'renamed';
	track.locked = false;
	project.tracks.push({ id: 'later-lock', locked: true });
	assert.equal(isTrackLocked('track'), true);
	assert.equal(isTrackLocked('renamed'), false);
	assert.equal(isTrackLocked('later-lock'), false);
});
