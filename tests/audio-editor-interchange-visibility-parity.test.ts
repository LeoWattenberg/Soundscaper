/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { createVisibleVideoTrackPredicate } from '../src/common/editor/video-track-visibility.js';

/**
 * Every interchange profile describes the programme the render would produce.
 *
 * Playback and export are the same render in this project, and an interchange
 * file is a statement about that render, so a track that composes must appear in
 * all three profiles and a track that does not must appear in none. A file that
 * describes a different edit than the one that would play is wrong in the way
 * that is hardest to notice: it looks entirely plausible.
 *
 * Two rules are easy to conflate and are not the same. Picture composes unless
 * hidden — `mute` is deliberately independent of composition so a future UI can
 * use it for media audio — and solo is a statement about the whole set. Both
 * FCPXML and OTIO once tested `hidden || mute` for every track, which dropped a
 * muted video track that does compose and kept unsoloed tracks that do not,
 * while the EDL adapter used the shared predicate and disagreed with them.
 */

const SAMPLE_RATE = 48_000;
const PAL = { num: 25, den: 1 };

function project(tracks: readonly Record<string, unknown>[]) {
	return {
		id: 'p', title: 'Parity', sampleRate: SAMPLE_RATE, primarySequenceId: 'seq',
		sequences: [{
			id: 'seq', name: 'Seq', rate: PAL, dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		}],
		sources: [{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' }],
		clips: [
			{
				kind: 'video', id: 'c1', sourceId: 'src', title: 'A',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'video', id: 'c2', sourceId: 'src', title: 'B',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
		],
		tracks,
	};
}

function composingVideoTrackIds(tracks: readonly Record<string, unknown>[]): string[] {
	const composes = createVisibleVideoTrackPredicate(tracks);
	return tracks.filter((track) => track.type === 'video' && composes(track)).map((track) => String(track.id));
}

function otioTrackNames(tracks: readonly Record<string, unknown>[]): string[] {
	const result = createOtioExport({ project: project(tracks), sequenceRate: PAL });
	return (result.document.tracks as { children: { name: string }[] }).children.map((track) => track.name);
}

function fcpxmlClipNames(tracks: readonly Record<string, unknown>[]): string[] {
	const result = createFcpxmlExport({ project: project(tracks), sequenceRate: PAL });
	return [...result.text.matchAll(/<asset-clip[^>]*name="([^"]+)"/gu)].map((match) => match[1]);
}

function edlEventCount(tracks: readonly Record<string, unknown>[]): number {
	return createProjectEdlExport({ project: project(tracks) })
		.text.split('\n').filter((line) => /^\d{3} /u.test(line)).length;
}

test('a muted video track still composes, so every profile still describes it', () => {
	// mute is about sound. A muted video track is on screen, and an interchange
	// file that omits it describes an edit the render would never produce.
	const tracks = [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false, mute: true }];
	assert.deepEqual(composingVideoTrackIds(tracks), ['v1'], 'the render composes it');
	assert.deepEqual(otioTrackNames(tracks), ['V1']);
	assert.deepEqual(fcpxmlClipNames(tracks), ['A']);
	assert.equal(edlEventCount(tracks), 1);
});

test('solo is a statement about the whole set, and every profile honours it', () => {
	const tracks = [
		{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false },
		{ type: 'video', id: 'v2', name: 'V2', clipIds: ['c2'], hidden: false, solo: true },
	];
	assert.deepEqual(composingVideoTrackIds(tracks), ['v2'], 'only the soloed track composes');
	assert.deepEqual(otioTrackNames(tracks), ['V2'], 'exporting the unsoloed track is exporting the wrong edit');
	assert.deepEqual(fcpxmlClipNames(tracks), ['B']);
	assert.equal(edlEventCount(tracks), 1);
});

test('a hidden video track composes in nothing and appears in nothing', () => {
	const tracks = [
		{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: true },
		{ type: 'video', id: 'v2', name: 'V2', clipIds: ['c2'], hidden: false },
	];
	assert.deepEqual(composingVideoTrackIds(tracks), ['v2']);
	assert.deepEqual(otioTrackNames(tracks), ['V2']);
	assert.deepEqual(fcpxmlClipNames(tracks), ['B']);
});

test('a muted audio track is silent, so it is left out and reported', () => {
	// The audio rule genuinely is mute-based, which is exactly why it must not
	// be applied to picture as well.
	const tracks = [
		{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false },
		{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c2'], mute: true },
	];
	assert.deepEqual(otioTrackNames(tracks), ['V1']);
	const result = createOtioExport({ project: project(tracks), sequenceRate: PAL });
	const omission = result.report.items.find((item) => item.code === 'otio.track-silent-omitted');
	assert.equal(omission?.scope.id, 'a1');
	assert.equal(omission?.data.reason, 'muted', 'the report says why, and says something true');
});

test('audio solo is honoured too, not silently ignored', () => {
	const tracks = [
		{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false },
		{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c2'] },
		{ type: 'audio', id: 'a2', name: 'A2', clipIds: ['c2'], solo: true },
	];
	assert.deepEqual(otioTrackNames(tracks), ['V1', 'A2'], 'only the soloed audio track is audible');
});
