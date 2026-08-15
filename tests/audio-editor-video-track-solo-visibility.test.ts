/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVisibleVideoTrackPredicate } from '../src/common/editor/video-timeline.js';

const AUDIO = { id: 'audio', type: 'audio', hidden: false, solo: false };

function videoTrack(id: string, state: Readonly<{ hidden?: boolean; solo?: boolean }> = {}) {
	return { id, type: 'video', hidden: state.hidden ?? false, solo: state.solo ?? false };
}

test('with nothing soloed, picture visibility is exactly the hidden flag', () => {
	const tracks = [AUDIO, videoTrack('a'), videoTrack('b', { hidden: true })];
	const visible = createVisibleVideoTrackPredicate(tracks);
	assert.equal(visible(tracks[1]), true);
	assert.equal(visible(tracks[2]), false);
	// The predicate speaks only about picture, so an audio track never composes.
	assert.equal(visible(AUDIO), false);
});

test('soloing a video track hides every other video track', () => {
	const tracks = [AUDIO, videoTrack('a', { solo: true }), videoTrack('b'), videoTrack('c')];
	const visible = createVisibleVideoTrackPredicate(tracks);
	assert.deepEqual(tracks.filter((track) => visible(track)).map(({ id }) => id), ['a']);
});

test('solo overrides hidden on the soloed track and suppresses unhidden peers', () => {
	// Solo is a statement about the set: while it is engaged the hidden flags of the
	// other tracks stop mattering, and the soloed track composes even if it was hidden.
	const tracks = [videoTrack('a', { hidden: true, solo: true }), videoTrack('b')];
	const visible = createVisibleVideoTrackPredicate(tracks);
	assert.deepEqual(tracks.filter((track) => visible(track)).map(({ id }) => id), ['a']);
});

test('several soloed tracks all compose', () => {
	const tracks = [videoTrack('a', { solo: true }), videoTrack('b', { solo: true }), videoTrack('c')];
	const visible = createVisibleVideoTrackPredicate(tracks);
	assert.deepEqual(tracks.filter((track) => visible(track)).map(({ id }) => id), ['a', 'b']);
});

test('an absent solo field is treated as not soloed', () => {
	// Older documents carry no solo fact, and must keep composing exactly as before.
	const legacy = [{ id: 'a', type: 'video', hidden: false }, { id: 'b', type: 'video', hidden: true }];
	const visible = createVisibleVideoTrackPredicate(legacy);
	assert.deepEqual(legacy.filter((track) => visible(track)).map(({ id }) => id), ['a']);
});
