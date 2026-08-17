/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { sequenceFrameAtSample } from '../src/common/editor/sequence-frame-navigation.ts';

/**
 * The three interchange profiles must agree on which frame a sample lands on.
 *
 * Each profile converts the project's sample domain to sequence frames, and it
 * is entirely possible to write three plausible conversions that disagree on a
 * handful of boundaries. `point` rounding — the rule the ruler, the playhead,
 * and the runtime clip projection already use — can move a boundary either way
 * against the exact quotient, so a plain `floor` of the quotient is close but
 * not equal. A project exported to EDL and to OTIO must not describe two
 * different edits.
 */

const SAMPLE_RATE = 48_000;
const NTSC = { num: 30_000, den: 1_001 };

/**
 * A sample where flooring the exact quotient and resolving the frame grid
 * disagree: the grid puts it on 309, the quotient on 308. Found by sweeping
 * the two conversions against each other rather than by guessing.
 */
const DISAGREEING_SAMPLE = 494_894;

test('the disagreeing sample really is one, or this test is guarding nothing', () => {
	assert.equal(sequenceFrameAtSample(DISAGREEING_SAMPLE, NTSC, SAMPLE_RATE), 309);
	assert.equal(
		Math.floor((DISAGREEING_SAMPLE * NTSC.num) / (SAMPLE_RATE * NTSC.den)),
		308,
		'if these ever agree, pick a new sample rather than deleting the test',
	);
});

function project() {
	return {
		id: 'p', title: 'Agreement', sampleRate: SAMPLE_RATE, primarySequenceId: 'seq',
		sequences: [{
			id: 'seq', name: 'Sequence', rate: NTSC, dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		}],
		sources: [{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' }],
		clips: [{
			kind: 'video', id: 'c1', sourceId: 'src', title: 'Shot',
			timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
			sourceStartFrame: DISAGREEING_SAMPLE, speedRatio: 1,
		}],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false }],
	};
}

test('all three profiles place the same sample on the same frame', () => {
	const expected = sequenceFrameAtSample(DISAGREEING_SAMPLE, NTSC, SAMPLE_RATE);

	const edl = createProjectEdlExport({ project: project() });
	const edlSourceIn = edl.text
		.split('\n')
		.filter((line) => /^\d{3} /u.test(line))
		.map((line) => line.trim().split(/\s+/u).slice(-4)[0])[0];

	const otio = createOtioExport({ project: project(), sequenceRate: NTSC });
	const otioStart = (
		(otio.document.tracks as { children: { children: Record<string, never>[] }[] })
			.children[0].children[0] as unknown as { source_range: { start_time: { value: number } } }
	).source_range.start_time.value;

	const fcpxml = createFcpxmlExport({ project: project(), sequenceRate: NTSC });
	const fcpStart = /<asset-clip[^>]*start="(\d+)(?:\/(\d+))?s"/u.exec(fcpxml.text);
	assert.ok(fcpStart, 'the FCPXML clip must carry a rational start');
	const fcpFrames = Math.round(
		(Number(fcpStart[1]) * NTSC.num) / ((fcpStart[2] ? Number(fcpStart[2]) : 1) * NTSC.den),
	);

	assert.equal(otioStart, expected, 'OTIO must resolve the frame grid, not floor the quotient');
	assert.equal(fcpFrames, expected, 'FCPXML must resolve the frame grid, not floor the quotient');
	// The EDL carries labels rather than indices, so compare the label the
	// shared formatter produces for the frame the other two agreed on.
	assert.equal(edlSourceIn, '00:00:10:09', `frame ${expected} at 29.97 non-drop`);
});
