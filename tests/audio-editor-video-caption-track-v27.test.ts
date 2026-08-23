/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeVideoCaptionTrackV1,
	type VideoCaptionTrackV1,
} from '../src/common/editor/video-caption-track-v27.ts';

function captionTrack(): VideoCaptionTrackV1 {
	return normalizeVideoCaptionTrackV1({
		schemaVersion: 1,
		id: 'captions-en',
		name: 'English',
		language: 'en-GB',
		styles: [{
			schemaVersion: 1,
			id: 'style-dialogue',
			fontFamily: 'soundscaper-sans',
			fontSizePercent: 5,
			foregroundColor: '#ffffffff',
			backgroundColor: '#000000cc',
			fontWeight: 'normal',
			fontStyle: 'normal',
			textDecoration: 'none',
			textAlign: 'center',
		}],
		regions: [{
			schemaVersion: 1,
			id: 'region-bottom',
			xPercent: 10,
			yPercent: 80,
			widthPercent: 80,
			heightPercent: 15,
			displayAlign: 'after',
		}],
		speakers: [{ schemaVersion: 1, id: 'speaker-alex', name: 'Alex' }],
		cues: [{
			schemaVersion: 1,
			id: 'cue-1',
			startFrame: 48_000,
			endFrame: 96_000,
			text: 'A complete sentence.',
			styleId: 'style-dialogue',
			regionId: 'region-bottom',
			speakerId: 'speaker-alex',
			words: [
				{ startFrame: 48_000, endFrame: 60_000, text: 'A' },
				{ startFrame: 60_000, endFrame: 96_000, text: 'complete sentence.' },
			],
		}],
	});
}

test('explicit caption tracks preserve styles, regions, speakers, cues, and word timing', () => {
	const track = captionTrack();
	assert.equal(track.cues[0]?.startFrame, 48_000);
	assert.equal(track.cues[0]?.words[1]?.endFrame, 96_000);
	assert.equal(track.cues[0]?.speakerId, 'speaker-alex');
	assert.equal(Object.isFrozen(track), true);
	assert.equal(Object.isFrozen(track.cues), true);
	assert.equal(Object.isFrozen(track.cues[0]?.words), true);
});

test('caption timing and references are closed and exact', () => {
	const track = captionTrack();
	assert.throws(() => normalizeVideoCaptionTrackV1({
		...track,
		cues: [{ ...track.cues[0]!, styleId: 'missing-style' }],
	}), /style.*missing|unknown.*style/iu);
	assert.throws(() => normalizeVideoCaptionTrackV1({
		...track,
		cues: [{ ...track.cues[0]!, endFrame: 47_999 }],
	}), /cue.*timing|end.*start/iu);
	assert.throws(() => normalizeVideoCaptionTrackV1({
		...track,
		cues: [{
			...track.cues[0]!,
			words: [{ startFrame: 47_999, endFrame: 60_000, text: 'outside' }],
		}],
	}), /word.*cue|within/iu);
	assert.throws(() => normalizeVideoCaptionTrackV1({
		...track,
		cues: [{ ...track.cues[0]!, text: 'unsafe\u202e' }],
	}), /caption.*text|unsafe/iu);
});

test('caption cue order is canonical and identities cannot collide', () => {
	const track = captionTrack();
	const earlier = {
		...track.cues[0]!,
		id: 'cue-0',
		startFrame: 0,
		endFrame: 24_000,
		words: [],
	};
	const normalized = normalizeVideoCaptionTrackV1({
		...track,
		cues: [track.cues[0], earlier],
	});
	assert.deepEqual(normalized.cues.map((cue) => cue.id), ['cue-0', 'cue-1']);
	assert.throws(() => normalizeVideoCaptionTrackV1({
		...track,
		cues: [track.cues[0], { ...track.cues[0] }],
	}), /identity.*duplicated|duplicate/iu);
});
