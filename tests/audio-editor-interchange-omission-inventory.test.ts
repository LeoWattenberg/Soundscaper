/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import {
	interchangeAnnotationOmission,
	interchangeCaptionTrackOmission,
	interchangeClipTimeEffect,
} from '../src/common/editor/interchange-omission-inventory.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';

/**
 * An interchange file states what it could not carry.
 *
 * The delivery report these profiles publish is the one surface that answers
 * "what did the export leave behind", and two whole categories never reached it.
 *
 * A retimed clip was detected only through `speedRatio`, the pre-foundation
 * scalar: a clip warped by an audio warp map or retimed by a video retime curve
 * carries `speedRatio === 1`, so its file claimed it consumes exactly as much
 * source as it occupies on the timeline — wrong numbers, and a report that said
 * nothing about them.
 *
 * Markers, regions, and label tracks are carried by none of the three profiles,
 * and none of them said so. A project full of markers exported with a report of
 * preserved and converted items only, which reads as nothing lost.
 */

const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 25, den: 1 });

test('a time effect is named whichever authority states it', () => {
	assert.equal(interchangeClipTimeEffect({ id: 'c', speedRatio: 1 }), null);
	assert.deepEqual(
		interchangeClipTimeEffect({ id: 'c', speedRatio: 2 }),
		{ kind: 'speed', data: { speedRatio: 2 } },
	);
	assert.deepEqual(
		interchangeClipTimeEffect({
			id: 'c', speedRatio: 1,
			warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0 }, { outer: 10, source: 20 }] },
		}),
		{ kind: 'audio-warp', data: { warpPoints: 2 } },
	);
	assert.deepEqual(
		interchangeClipTimeEffect({
			id: 'c', speedRatio: 1,
			retimeMap: { feature: 'video-retime', points: [{ outer: 0, source: 0 }, { outer: 5, source: 10 }] },
		}),
		{ kind: 'video-retime', data: { retimePoints: 2 } },
	);
	// A neutral map is not a time effect: every clip carries one.
	assert.equal(interchangeClipTimeEffect({
		id: 'c', speedRatio: 1, warpMap: { feature: 'audio-warp', points: [] },
	}), null);
});

test('markers, regions, and label tracks are counted as what a profile leaves behind', () => {
	assert.equal(interchangeAnnotationOmission({ id: 'p', tracks: [], timelineAnnotations: [] }), null);
	assert.deepEqual(
		interchangeAnnotationOmission({
			id: 'p',
			timelineAnnotations: [{ id: 'a' }, { id: 'b' }],
			tracks: [
				{ id: 'labels', type: 'label', labels: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] },
				{ id: 'empty-labels', type: 'label', labels: [] },
				{ id: 'audio', type: 'audio', clipIds: [] },
			],
		}),
		{ annotations: 2, labelTracks: ['labels'], labels: 3 },
	);
	assert.deepEqual(
		interchangeCaptionTrackOmission({
			id: 'p', tracks: [], timelineAnnotations: [],
			videoCaptionTracks: [
				{ id: 'captions-en', cues: [{ id: 'c1' }, { id: 'c2' }] },
				{ id: 'captions-empty', cues: [] },
			],
		}),
		{ captionTracks: ['captions-en', 'captions-empty'], captions: 2 },
	);
	assert.deepEqual(interchangeCaptionTrackOmission({
		id: 'p', primarySequenceId: 'sequence-a',
		videoCaptionTracks: [
			{ id: 'a-full', sequenceId: 'sequence-a', cues: [{ id: 'c1' }] },
			{ id: 'a-empty', sequenceId: 'sequence-a', cues: [] },
			{ id: 'b-full', sequenceId: 'sequence-b', cues: [{ id: 'c2' }, { id: 'c3' }] },
		],
	}), { captionTracks: ['a-full', 'a-empty'], captions: 1 });
});

test('every profile reports the annotations and warp it cannot carry', () => {
	const project = annotatedProject();
	const otio = createOtioExport({ project, sequenceRate: PAL });
	const fcpxml = createFcpxmlExport({ project, sequenceRate: PAL });
	const edl = createProjectEdlExport({ project, sequenceId: 'seq' });

	for (const [profile, report] of [
		['otio', otio.report], ['fcpxml', fcpxml.report], ['edl', edl.report],
	] as const) {
		const item = report.items.find(({ code }) => code === `${profile}.annotations-omitted`);
		assert.ok(item, `${profile} must say the markers stay behind`);
		assert.equal(item.disposition, 'omitted');
		assert.deepEqual(item.data, { annotations: 1, labelTracks: 1, labels: 2 });
		const captions = report.items.find(({ code }) => code === `${profile}.caption-tracks-omitted`);
		assert.ok(captions, `${profile} must say explicit captions stay behind`);
		assert.equal(captions.disposition, 'omitted');
		assert.deepEqual(captions.data, { captionTracks: 1, captions: 2 });
	}

	// The warped audio clip is named by both profiles that describe audio.
	for (const [profile, report] of [['otio', otio.report], ['fcpxml', fcpxml.report]] as const) {
		const item = report.items.find(({ code }) => code === `${profile}.speed-change-omitted`);
		assert.ok(item, `${profile} must name the time effect`);
		assert.equal((item.data as { kind?: string }).kind, 'audio-warp');
	}
});

test('the caption inventory follows the exported sequence, not the primary', () => {
	// The controller resolves which sequence an export describes and forwards its
	// id; the inventory must filter by that sequence, and only fall back to the
	// primary when no export target was stated.
	const project = {
		...annotatedProject(),
		sequences: [...annotatedProject().sequences, secondSequence()],
		videoCaptionTracks: [
			{ id: 'captions-b', sequenceId: 'seq-b', cues: [{ id: 'c1' }, { id: 'c2' }] },
		],
	};
	const otio = createOtioExport({ project, sequenceRate: PAL, sequenceId: 'seq-b' });
	const fcpxml = createFcpxmlExport({ project, sequenceRate: PAL, sequenceId: 'seq-b' });
	const edl = createProjectEdlExport({ project, sequenceId: 'seq-b' });
	for (const [profile, report] of [
		['otio', otio.report], ['fcpxml', fcpxml.report], ['edl', edl.report],
	] as const) {
		const item = report.items.find(({ code }) => code === `${profile}.caption-tracks-omitted`);
		assert.ok(item, `${profile} must inventory the exported sequence's captions`);
		assert.deepEqual(item.data, { captionTracks: 1, captions: 2 });
	}

	// Absent an explicit sequence the primary is the filter, and it has none.
	const fallback = createOtioExport({ project, sequenceRate: PAL });
	assert.equal(
		fallback.report.items.find(({ code }) => code === 'otio.caption-tracks-omitted'),
		undefined,
	);
});

function secondSequence() {
	return {
		id: 'seq-b', name: 'Second', rate: PAL, dropFrame: false,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
	};
}

function annotatedProject() {
	return {
		id: 'interchange-omissions', title: 'Omissions', sampleRate: SAMPLE_RATE, primarySequenceId: 'seq',
		sequences: [{
			id: 'seq', name: 'Sequence', rate: PAL, dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		}],
		sources: [
			{ kind: 'video', id: 'cam', name: 'CAM', storageKey: 'media/cam.mp4' },
			{ kind: 'audio', id: 'bed', name: 'BED', storageKey: 'media/bed.wav' },
		],
		clips: [
			{
				kind: 'video', id: 'v-clip', sourceId: 'cam', title: 'Wide',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'audio', id: 'a-clip', sourceId: 'bed', title: 'Bed',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
				sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE * 2, speedRatio: 1,
				warpMap: {
					feature: 'audio-warp',
					points: [
						{ outer: 0, source: 0, mode: 'forward' },
						{ outer: SAMPLE_RATE, source: SAMPLE_RATE * 2, mode: 'forward' },
					],
				},
			},
		],
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v-clip'], hidden: false },
			{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['a-clip'], mute: false },
			{ type: 'label', id: 'labels', name: 'Labels', labels: [{ id: 'l1' }, { id: 'l2' }] },
		],
		videoCaptionTracks: [{
			id: 'captions', sequenceId: 'seq', cues: [{ id: 'c1' }, { id: 'c2' }],
		}],
		timelineAnnotations: [{
			id: 'marker', sequenceId: 'seq', kind: 'marker', anchor: 'sample',
			name: 'Cue', positionFrame: 0,
		}],
	};
}
