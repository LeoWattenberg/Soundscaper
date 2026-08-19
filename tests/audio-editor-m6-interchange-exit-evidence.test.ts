/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Milestone 6C exit evidence: one fixture through all three profiles.
 *
 * Each profile has its own conformance test against a third-party reader, and
 * the frame-agreement test pins the single hardest sample. What neither does is
 * take one project through all three at once and ask whether they describe the
 * same edit — which is the exit gate's real question, because a project whose
 * EDL and OTIO disagree about where a cut falls is a project that cannot be
 * handed to a finishing suite whatever each file validates as on its own.
 *
 * The fixture is built to be lossy on purpose. A speed change, a transition and
 * a label track are all things the profiles cannot carry, so the gate's other
 * sentence — reports itemize every conversion or omission — is witnessed on a
 * project that actually has omissions rather than on one that has none.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';

const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 25, den: 1 });
/** 25 fps at 48 kHz: one frame is exactly 1,920 samples, so cuts land cleanly. */
const FRAME_SAMPLES = SAMPLE_RATE / RATE.num;
const CUT_STARTS = Object.freeze([0, 100, 250]);

test('all three profiles describe the same three cuts in the same places', () => {
	const edl = createProjectEdlExport({ project: fixture() });
	const otio = createOtioExport({ project: fixture(), sequenceRate: RATE });
	const fcpxml = createFcpxmlExport({ project: fixture(), sequenceRate: RATE });

	assert.deepEqual(edlRecordStarts(edl.text), CUT_STARTS);
	assert.deepEqual(otioRecordStarts(otio.document), CUT_STARTS);
	assert.deepEqual(fcpxmlRecordStarts(fcpxml.text), CUT_STARTS);
});

test('every profile itemizes the material it could not carry', () => {
	const reports = {
		edl: createProjectEdlExport({ project: fixture() }).report,
		otio: createOtioExport({ project: fixture(), sequenceRate: RATE }).report,
		fcpxml: createFcpxmlExport({ project: fixture(), sequenceRate: RATE }).report,
	};

	for (const [profile, report] of Object.entries(reports)) {
		// A sealed report has no draft flag left on it; an unsealed one would have
		// counts that stop matching the moment anything appended to it.
		assert.equal(Object.hasOwn(report, 'draft'), false, `${profile} must publish a sealed report`);
		assert.ok(report.items.length > 0, `${profile} reported nothing about a lossy export`);
		// The speed change is in every profile's blind spot, so every profile has
		// to say so; a silent one would be the failure this sentence exists for.
		assert.ok(
			report.items.some(({ code }) => code === `${profile}.speed-change-omitted`),
			`${profile} dropped a speed change without saying so`,
		);
		// Nothing may be reported as an omission and counted as preserved.
		for (const item of report.items) {
			assert.ok(
				['preserved', 'converted', 'missing', 'omitted'].includes(item.disposition),
				`${profile}.${item.code} has an unknown disposition`,
			);
		}
		assert.equal(
			report.counts.omitted + report.counts.missing + report.counts.converted + report.counts.preserved,
			report.items.length,
			`${profile} counts disagree with its own items`,
		);
	}
});

test('a transition is omitted by the profiles that cannot express one', () => {
	const edl = createProjectEdlExport({ project: fixture() });
	const otio = createOtioExport({ project: fixture(), sequenceRate: RATE });

	assert.ok(edl.report.items.some(({ code }) => code === 'edl.transition-omitted'));
	assert.ok(otio.report.items.some(({ code }) => code === 'otio.transition-omitted'));
});

function fixture() {
	return {
		id: 'p',
		title: 'Exit Evidence',
		sampleRate: SAMPLE_RATE,
		primarySequenceId: 'seq',
		sequences: [{
			id: 'seq',
			name: 'Sequence',
			rate: RATE,
			dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		}],
		sources: [{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' }],
		clips: [
			cut('c1', CUT_STARTS[0]!, { speedRatio: 1 }),
			// A speed change no profile in this family can carry.
			cut('c2', CUT_STARTS[1]!, { speedRatio: 0.5 }),
			// A transition, which the EDL and OTIO profiles must itemize.
			cut('c3', CUT_STARTS[2]!, { speedRatio: 1, transition: 'cross-dissolve' }),
		],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1', 'c2', 'c3'], hidden: false }],
	};
}

function cut(
	id: string,
	startFrame: number,
	extras: Readonly<{ speedRatio: number; transition?: string }>,
) {
	return {
		kind: 'video',
		id,
		sourceId: 'src',
		title: id.toUpperCase(),
		timelineStartFrame: startFrame * FRAME_SAMPLES,
		durationFrames: 50 * FRAME_SAMPLES,
		sourceStartFrame: startFrame * FRAME_SAMPLES,
		...extras,
	};
}

function edlRecordStarts(text: string): number[] {
	return text
		.split('\n')
		.filter((line) => /^\d{3} /u.test(line))
		.map((line) => {
			const fields = line.trim().split(/\s+/u);
			return timecodeFrames(fields.at(-2)!);
		});
}

function timecodeFrames(value: string): number {
	const [hours, minutes, seconds, frames] = value.split(':').map(Number);
	return ((hours! * 60 + minutes!) * 60 + seconds!) * RATE.num + frames!;
}

function otioRecordStarts(document: Readonly<Record<string, unknown>>): number[] {
	const tracks = document.tracks as { children: { children: Record<string, unknown>[] }[] };
	let start = 0;
	const starts: number[] = [];
	for (const child of tracks.children[0]!.children) {
		const range = child.source_range as { duration: { value: number } } | undefined;
		if (String(child.OTIO_SCHEMA ?? '').startsWith('Gap')) {
			start += range?.duration.value ?? 0;
			continue;
		}
		starts.push(start);
		start += range?.duration.value ?? 0;
	}
	return starts;
}

function fcpxmlRecordStarts(text: string): number[] {
	return [...text.matchAll(/<asset-clip[^>]*offset="(\d+)(?:\/(\d+))?s"/gu)].map(([, num, den]) => (
		Math.round((Number(num) * RATE.num) / ((den ? Number(den) : 1) * RATE.den))
	));
}
