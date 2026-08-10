/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveVideoEditTargets,
	toggleVideoEditTarget,
} from '../src/common/editor/video-edit-targeting.ts';

function project(overrides: Record<string, unknown> = {}) {
	return {
		primarySequenceId: 'main',
		sequences: [
			{ id: 'main', trackIds: ['video-1', 'audio-1', 'audio-solo'] },
			{ id: 'second', trackIds: ['video-2'] },
		],
		tracks: [
			{ id: 'video-1', type: 'video', laneGroupId: 'lane-a' },
			{ id: 'audio-1', type: 'audio', laneGroupId: 'lane-a' },
			{ id: 'audio-solo', type: 'audio', laneGroupId: null },
			{ id: 'video-2', type: 'video', laneGroupId: 'lane-b' },
		],
		...overrides,
	};
}

test('with nothing targeted the edit follows the selected track and its lane partner', () => {
	assert.deepEqual(resolveVideoEditTargets(project(), { selectedTrackId: 'video-1' }), {
		sequenceId: 'main',
		videoTrackId: 'video-1',
		audioTrackId: 'audio-1',
		explicit: false,
	});
	// Selecting the audio member of the same lane group resolves the same pair.
	assert.deepEqual(resolveVideoEditTargets(project(), { selectedTrackId: 'audio-1' }), {
		sequenceId: 'main',
		videoTrackId: 'video-1',
		audioTrackId: 'audio-1',
		explicit: false,
	});
});

test('a selected track outside any lane group targets only itself', () => {
	assert.deepEqual(resolveVideoEditTargets(project(), { selectedTrackId: 'audio-solo' }), {
		sequenceId: 'main',
		videoTrackId: null,
		audioTrackId: 'audio-solo',
		explicit: false,
	});
	assert.deepEqual(resolveVideoEditTargets(project(), { selectedTrackId: null }), {
		sequenceId: 'main',
		videoTrackId: null,
		audioTrackId: null,
		explicit: false,
	});
});

test('a track selected in another sequence does not target this one', () => {
	assert.deepEqual(resolveVideoEditTargets(project(), { selectedTrackId: 'video-2' }), {
		sequenceId: 'main',
		videoTrackId: null,
		audioTrackId: null,
		explicit: false,
	});
	assert.deepEqual(
		resolveVideoEditTargets(project(), { selectedTrackId: 'video-2', sequenceId: 'second' }),
		{ sequenceId: 'second', videoTrackId: 'video-2', audioTrackId: null, explicit: false },
	);
});

test('an explicit choice is complete: an untargeted lane stays untargeted', () => {
	assert.deepEqual(resolveVideoEditTargets(project(), {
		targeting: { videoTrackId: 'video-1', audioTrackId: null },
		selectedTrackId: 'video-1',
	}), {
		sequenceId: 'main',
		videoTrackId: 'video-1',
		audioTrackId: null,
		explicit: true,
	});
});

test('a targeted track that no longer exists resolves as untargeted', () => {
	const removed = project({
		sequences: [{ id: 'main', trackIds: ['audio-1'] }],
		tracks: [{ id: 'audio-1', type: 'audio', laneGroupId: 'lane-a' }],
	});
	assert.deepEqual(resolveVideoEditTargets(removed, {
		targeting: { videoTrackId: 'video-1', audioTrackId: 'audio-1' },
	}), {
		sequenceId: 'main',
		videoTrackId: null,
		audioTrackId: 'audio-1',
		explicit: true,
	});
});

test('a lane cannot be targeted with the wrong kind of track', () => {
	assert.deepEqual(resolveVideoEditTargets(project(), {
		targeting: { videoTrackId: 'audio-1', audioTrackId: 'video-1' },
	}), {
		sequenceId: 'main',
		videoTrackId: null,
		audioTrackId: null,
		explicit: true,
	});
});

test('toggling a lane starts from what is resolved and turns off on a second press', () => {
	const fallback = resolveVideoEditTargets(project(), { selectedTrackId: 'video-1' });
	// The first press adopts the inherited pair and turns its video lane off.
	assert.deepEqual(toggleVideoEditTarget(fallback, 'video-1', 'video'), {
		videoTrackId: null,
		audioTrackId: 'audio-1',
	});
	assert.deepEqual(toggleVideoEditTarget(fallback, 'audio-solo', 'audio'), {
		videoTrackId: 'video-1',
		audioTrackId: 'audio-solo',
	});
	assert.throws(() => toggleVideoEditTarget(fallback, 'labels', 'label'), RangeError);
});

test('an unknown sequence is a reference error rather than an empty target', () => {
	assert.throws(() => resolveVideoEditTargets(project(), { sequenceId: 'missing' }), ReferenceError);
	assert.throws(() => resolveVideoEditTargets(project({ primarySequenceId: '' })), TypeError);
});
