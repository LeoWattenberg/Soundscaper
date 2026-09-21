/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FrameTrimDataRecord,
	FrameTrimProjectIndex,
} from '../src/common/editor/frame-canonical-edge-trim-domain.ts';
import {
	frameCanonicalStableParticipants,
	frameCanonicalTrackParticipants,
} from '../src/common/editor/frame-canonical-trim-planning.ts';

test('stable trim participants retain project clip order while filtering target IDs', () => {
	const index = audioIndex(['second', 'first', 'third']);
	const participants = frameCanonicalStableParticipants(index, new Set(['third', 'first']));

	assert.deepEqual(participants.map(({ clipId }) => clipId), ['first', 'third']);
});

test('track trim participants retain lane order and preserve missing-ownership errors', () => {
	const index = audioIndex(['second', 'first']);

	assert.deepEqual(
		frameCanonicalTrackParticipants(index, 'track').map(({ clipId }) => clipId),
		['second', 'first'],
	);
	assert.throws(
		() => frameCanonicalTrackParticipants(index, 'missing'),
		/Media lane missing is missing clip ownership\./u,
	);
});

function audioIndex(trackClipIds: readonly string[]): FrameTrimProjectIndex {
	const source = Object.freeze({ id: 'source', kind: 'audio', frameCount: 10_000 });
	const clips = ['first', 'second', 'third'].map((id, index) => Object.freeze({
		id,
		kind: 'audio',
		sourceId: 'source',
		timelineStartFrame: index * 100,
		durationFrames: 50,
		sourceStartFrame: index * 100,
		sourceDurationFrames: 50,
		trimStartFrames: 0,
		trimEndFrames: 0,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
	}));
	const track = Object.freeze({ id: 'track', type: 'audio', clipIds: trackClipIds });
	const trackByClipId = new Map<string, FrameTrimDataRecord>(
		trackClipIds.map((clipId) => [clipId, track]),
	);
	return {
		project: {},
		sampleRate: 48_000,
		clips,
		clipById: new Map(clips.map((clip) => [clip.id, clip])),
		trackById: new Map([['track', track]]),
		trackByClipId,
		sourceById: new Map([['source', source]]),
		sequenceById: new Map(),
		sequenceIdByTrackId: new Map(),
	};
}
