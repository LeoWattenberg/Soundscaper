/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';

const SAMPLE_RATE = 48_000;
const NTSC = { num: 30_000, den: 1_001 };

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p', title: 'Cut list', sampleRate: SAMPLE_RATE,
		primarySequenceId: 'seq',
		sequences: [{
			id: 'seq', name: 'Sequence', rate: NTSC, dropFrame: true,
			startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 },
		}],
		sources: [
			{ kind: 'video', id: 'src-a', name: 'A ROLL' },
			{ kind: 'video', id: 'src-b', name: 'B ROLL' },
		],
		clips: [
			{
				kind: 'video', id: 'c1', sourceId: 'src-a', title: 'Opening',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'video', id: 'c2', sourceId: 'src-b', title: 'Reverse',
				timelineStartFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE,
				sourceStartFrame: SAMPLE_RATE * 2, speedRatio: 1,
			},
		],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1', 'c2'], hidden: false }],
		...overrides,
	};
}

function eventLines(text: string): string[] {
	return text.split('\n').filter((line) => /^\d{3} /u.test(line));
}

/** Whitespace-tolerant field view: column padding is the formatter's business, not this test's. */
function eventFields(line: string) {
	const parts = line.trim().split(/\s+/u);
	const [sourceIn, sourceOut, recordIn, recordOut] = parts.slice(-4);
	return {
		number: parts[0], reel: parts[1], trackKind: parts[2], edit: parts[3],
		sourceIn, sourceOut, recordIn, recordOut,
	};
}

test('a project becomes an EDL whose events are the visible track in timeline order', () => {
	const result = createProjectEdlExport({ project: project() });
	const lines = eventLines(result.text);
	assert.equal(lines.length, 2);
	assert.deepEqual(
		lines.map((line) => {
			const { number, reel, trackKind, edit } = eventFields(line);
			return { number, reel, trackKind, edit };
		}),
		[
			{ number: '001', reel: 'A_ROLL', trackKind: 'V', edit: 'C' },
			{ number: '002', reel: 'B_ROLL', trackKind: 'V', edit: 'C' },
		],
		'reels come from the source names, sanitized to the format\'s alphabet',
	);
	assert.ok(result.text.includes('* FROM CLIP NAME: Opening'));
	assert.equal(result.fileName, 'Cut-list.edl');
});

test('simultaneous EDL events use code-unit identity order, not host collation', () => {
	const clips = [
		{
			kind: 'video', id: 'alpha', sourceId: 'src-a', title: 'Lowercase',
			timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
		},
		{
			kind: 'video', id: 'Zebra', sourceId: 'src-b', title: 'Uppercase',
			timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
		},
	];
	const result = createProjectEdlExport({
		project: project({
			clips,
			tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['alpha', 'Zebra'], hidden: false }],
		}),
	});
	assert.deepEqual(eventLines(result.text).map((line) => eventFields(line).reel), ['B_ROLL', 'A_ROLL']);
});

test('record timecode carries the sequence start timecode rather than starting at zero', () => {
	const result = createProjectEdlExport({ project: project() });
	const { recordIn, sourceIn } = eventFields(eventLines(result.text)[0]);
	assert.equal(
		recordIn,
		'01:00:00;00',
		'a sequence starting at 01:00:00:00 must not emit a list that starts at zero',
	);
	assert.equal(sourceIn, '00:00:00;00', 'the source side is unaffected by the sequence offset');
});

test('a cut event never disagrees with itself about its own duration', () => {
	// Independently rounding the source and record ends can differ by a frame at
	// 30000/1001; a cut whose two sides disagree is rejected by conforming readers.
	const result = createProjectEdlExport({ project: project() });
	for (const line of eventLines(result.text)) {
		const { sourceIn, sourceOut, recordIn, recordOut } = eventFields(line);
		assert.equal(
			frameSpan(sourceIn, sourceOut),
			frameSpan(recordIn, recordOut),
			`source and record durations must match: ${line}`,
		);
	}
});

test('a hidden track is absent from the list, exactly as it is absent from the render', () => {
	const hidden = project({
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false },
			{ type: 'video', id: 'v2', name: 'V2', clipIds: ['c2'], hidden: true },
		],
	});
	const result = createProjectEdlExport({ project: hidden });
	assert.equal(eventLines(result.text).length, 1, 'only the composing track is described');
	assert.equal(
		result.report.items.filter((item) => item.code === 'edl.video-track-omitted').length,
		0,
		'a track that does not compose is not an omission; it was never in the programme',
	);
});

test('a solo video track wins here the same way it wins in the render', () => {
	const soloed = project({
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false },
			{ type: 'video', id: 'v2', name: 'V2', clipIds: ['c2'], hidden: false, solo: true },
		],
	});
	const result = createProjectEdlExport({ project: soloed });
	assert.equal(eventLines(result.text).length, 1);
	assert.equal(eventFields(eventLines(result.text)[0]).reel, 'B_ROLL', 'the soloed track is the programme');
});

test('tracks the one-track profile leaves behind are itemized, and the counts stay true', () => {
	const multi = project({
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false },
			{ type: 'video', id: 'v2', name: 'V2', clipIds: ['c2'], hidden: false },
			{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c2'], hidden: false },
		],
	});
	const result = createProjectEdlExport({ project: multi });
	const codes = result.report.items.map((item) => item.code);
	assert.ok(codes.includes('edl.video-track-omitted'));
	assert.ok(codes.includes('edl.audio-track-omitted'));
	assert.equal(
		result.report.counts.omitted,
		result.report.items.filter((item) => item.disposition === 'omitted').length,
		'a report whose counts disagree with its items is how an unreported conversion hides',
	);
	assert.ok(Object.isFrozen(result.report.items), 'the sealed report is the artifact');
});

test('a speed-changed clip is emitted as a unity cut and says so', () => {
	const retimed = project({
		clips: [{
			kind: 'video', id: 'c1', sourceId: 'src-a', title: 'Fast',
			timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 2,
		}],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false }],
	});
	const result = createProjectEdlExport({ project: retimed });
	assert.ok(
		result.report.items.some((item) => item.code === 'edl.speed-change-omitted'),
		'the format carries no motion record, so the list must admit the change is gone',
	);
});

test('a clip too short to span a frame is reported, not quietly dropped', () => {
	// Without the report the list simply has one fewer event than the sequence
	// has clips, and nothing says which one went.
	const blink = project({
		clips: [{
			kind: 'video', id: 'blink', sourceId: 'src-a', title: 'Blink',
			timelineStartFrame: 0, durationFrames: 7, sourceStartFrame: 0, speedRatio: 1,
		}],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['blink'], hidden: false }],
	});
	const result = createProjectEdlExport({ project: blink });
	assert.equal(eventLines(result.text).length, 0);
	const omission = result.report.items.find((item) => item.code === 'edl.sub-frame-clip-omitted');
	assert.equal(omission?.scope.id, 'blink', 'the report names the clip that vanished');
	assert.equal(
		result.report.counts.omitted,
		result.report.items.filter((item) => item.disposition === 'omitted').length,
	);
});

test('an explicit reel mapping overrides the source name', () => {
	const result = createProjectEdlExport({
		project: project(),
		reelNames: { 'src-a': 'TAPE001', 'src-b': 'TAPE002' },
	});
	assert.equal(eventFields(eventLines(result.text)[0]).reel, 'TAPE001');
});

test('the adapter refuses rather than inventing a sequence or a track', () => {
	assert.throws(() => createProjectEdlExport({ project: project(), trackId: 'nope' }), /nope/u);
	assert.throws(
		() => createProjectEdlExport({ project: project({ tracks: [] }) }),
		/no visible video track/u,
	);
	assert.throws(
		() => createProjectEdlExport({ project: project({ sampleRate: 0 }) }),
		/sample rate/u,
	);
});

/** Frame distance between two drop-frame labels, counting labels rather than time. */
function frameSpan(from: string, to: string): number {
	return labelFrames(to) - labelFrames(from);
}

function labelFrames(label: string): number {
	const parts = label.split(/[:;]/u).map(Number);
	const [hours, minutes, seconds, frames] = parts;
	const total = ((hours * 60 + minutes) * 60 + seconds) * 30 + frames;
	const totalMinutes = hours * 60 + minutes;
	return total - 2 * (totalMinutes - Math.floor(totalMinutes / 10));
}
