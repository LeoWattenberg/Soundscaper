/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveSelectedTimelineVideoAuthority,
} from '../src/common/editor/selected-timeline-video-authority.ts';

interface Clip {
	readonly id: string;
	readonly kind: 'audio' | 'video';
}

interface Track {
	readonly id: string;
	readonly clipIds: readonly string[];
}

const CLIPS: readonly Clip[] = Object.freeze([
	Object.freeze({ id: 'video-a', kind: 'video' }),
	Object.freeze({ id: 'audio-a', kind: 'audio' }),
	Object.freeze({ id: 'video-b', kind: 'video' }),
]);

const TRACKS: readonly Track[] = Object.freeze([
	Object.freeze({ id: 'video-track-a', clipIds: Object.freeze(['video-a']) }),
	Object.freeze({ id: 'audio-track', clipIds: Object.freeze(['audio-a']) }),
	Object.freeze({ id: 'video-track-b', clipIds: Object.freeze(['video-b']) }),
]);

test('selected timeline-video authority falls back to focus only when project selection is empty', () => {
	const focused = resolve({ selectedClipIds: [], focusedClipId: 'video-a' });
	assert.deepEqual(focused && {
		clipId: focused.clipId,
		clip: focused.clip,
		track: focused.track,
	}, {
		clipId: 'video-a',
		clip: CLIPS[0],
		track: TRACKS[0],
	});
	assert.equal(Object.isFrozen(focused), true);
	assert.equal(resolve({ selectedClipIds: [], focusedClipId: null }), null);
	assert.equal(resolve({ selectedClipIds: ['video-a'], focusedClipId: 'video-b' })?.clipId, 'video-a');
});

test('a focused video narrows a mixed linked selection only when it is the sole selected video', () => {
	assert.equal(resolve({
		selectedClipIds: ['audio-a', 'video-a'],
		focusedClipId: 'video-a',
	})?.clipId, 'video-a');
	assert.equal(resolve({
		selectedClipIds: ['video-a', 'video-b'],
		focusedClipId: 'video-a',
	}), null);
	assert.equal(resolve({
		selectedClipIds: ['audio-a', 'video-a'],
		focusedClipId: 'audio-a',
	}), null);
});

test('selected timeline-video authority requires a present video and exactly one owner', () => {
	assert.equal(resolve({ selectedClipIds: ['audio-a'], focusedClipId: 'audio-a' }), null);
	assert.equal(resolve({ selectedClipIds: ['missing'], focusedClipId: 'missing' }), null);
	assert.equal(resolve({
		selectedClipIds: ['video-a'],
		focusedClipId: 'video-a',
		admitTargetClip: () => false,
	}), null);
	assert.equal(resolve({
		selectedClipIds: ['video-a'],
		focusedClipId: 'video-a',
		tracks: [],
	}), null);
	assert.equal(resolve({
		selectedClipIds: ['video-a'],
		focusedClipId: 'video-a',
		tracks: [...TRACKS, { id: 'duplicate-owner', clipIds: ['video-a'] }],
	}), null);
	assert.equal(resolve({
		selectedClipIds: ['video-a'],
		focusedClipId: 'video-a',
		ownersUnavailable: true,
	}), null);
});

test('selected timeline-video authority preserves caller-owned hostile-input validation', () => {
	const failure = new TypeError('hostile clip record');
	assert.throws(() => resolveSelectedTimelineVideoAuthority<Clip, Track>({
		selectedClipIds: Object.freeze(['video-a']),
		focusedClipId: 'video-a',
		clipForId: () => { throw failure; },
		isVideoClip: (clip) => clip.kind === 'video',
		owningTracksForClipId: () => TRACKS,
	}), (error: unknown) => error === failure);
});

function resolve(options: Readonly<{
	readonly selectedClipIds: readonly string[];
	readonly focusedClipId: unknown;
	readonly tracks?: readonly Track[];
	readonly ownersUnavailable?: boolean;
	readonly admitTargetClip?: (clip: Clip) => boolean;
}>) {
	const tracks = options.tracks ?? TRACKS;
	return resolveSelectedTimelineVideoAuthority<Clip, Track>({
		selectedClipIds: options.selectedClipIds,
		focusedClipId: options.focusedClipId,
		clipForId: (clipId) => CLIPS.find(({ id }) => id === clipId) ?? null,
		isVideoClip: (clip) => clip.kind === 'video',
		...(options.admitTargetClip ? { admitTargetClip: options.admitTargetClip } : {}),
		owningTracksForClipId: (clipId) => options.ownersUnavailable
			? null
			: tracks.filter(({ clipIds }) => clipIds.includes(clipId)),
	});
}
