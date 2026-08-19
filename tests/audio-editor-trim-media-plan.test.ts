/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrimMediaPlan, trimMediaRetainsFrame } from '../src/common/editor/trim-media-plan.ts';

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p', title: 'Trim', sampleRate: 48_000,
		sources: [{ kind: 'audio', id: 'src', name: 'Take', frameCount: 1_000 }],
		clips: [{
			kind: 'audio', id: 'c1', sourceId: 'src', title: 'A',
			timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 400,
			sourceDurationFrames: 100, speedRatio: 1,
		}],
		tracks: [{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c1'] }],
		...overrides,
	};
}

const planFor = (overrides: Record<string, unknown> = {}, handleFrames = 0) => (
	createTrimMediaPlan({ project: project(overrides), handleFrames })
);

test('only the referenced span is retained, and every referenced frame is in it', () => {
	const plan = planFor();
	const [source] = plan.sources;
	assert.deepEqual(source.retained, [{ startFrame: 400, endFrame: 500 }]);
	assert.equal(source.retainedFrames, 100);
	assert.equal(source.discardedFrames, 900);
	for (let frame = 400; frame < 500; frame += 1) {
		assert.ok(trimMediaRetainsFrame(source, frame), `frame ${frame} is referenced and must survive`);
	}
	assert.equal(trimMediaRetainsFrame(source, 399), false);
	assert.equal(trimMediaRetainsFrame(source, 500), false, 'the end is exclusive');
});

test('handles widen what is kept and never narrow it', () => {
	const plan = planFor({}, 50);
	assert.deepEqual(plan.sources[0].retained, [{ startFrame: 350, endFrame: 550 }]);
	// Clamped at the source bounds rather than running negative or past the end.
	const clamped = planFor({
		clips: [{
			kind: 'audio', id: 'c1', sourceId: 'src', timelineStartFrame: 0,
			durationFrames: 100, sourceStartFrame: 10, sourceDurationFrames: 980, speedRatio: 1,
		}],
	}, 100);
	assert.deepEqual(clamped.sources[0].retained, [{ startFrame: 0, endFrame: 1_000 }]);
	assert.equal(clamped.sources[0].wholeSourceRetained, true);
});

test('a hidden or muted track still protects its media', () => {
	// This is the opposite of the rule the interchange profiles follow, and
	// deliberately so: an edit list describes the render, but trim-media decides
	// which bytes survive. Hiding a track must never destroy the material.
	const hidden = planFor({
		tracks: [{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c1'], mute: true, hidden: true }],
	});
	assert.deepEqual(hidden.sources[0].retained, [{ startFrame: 400, endFrame: 500 }]);
	assert.equal(hidden.sources[0].referenceCount, 1);
});

test('overlapping and abutting references merge into one continuous run', () => {
	const plan = planFor({
		clips: [
			{ kind: 'audio', id: 'c1', sourceId: 'src', durationFrames: 100, sourceStartFrame: 100, sourceDurationFrames: 100, speedRatio: 1 },
			{ kind: 'audio', id: 'c2', sourceId: 'src', durationFrames: 100, sourceStartFrame: 150, sourceDurationFrames: 100, speedRatio: 1 },
			{ kind: 'audio', id: 'c3', sourceId: 'src', durationFrames: 100, sourceStartFrame: 250, sourceDurationFrames: 50, speedRatio: 1 },
			{ kind: 'audio', id: 'c4', sourceId: 'src', durationFrames: 100, sourceStartFrame: 700, sourceDurationFrames: 100, speedRatio: 1 },
		],
	});
	assert.deepEqual(
		plan.sources[0].retained,
		[{ startFrame: 100, endFrame: 300 }, { startFrame: 700, endFrame: 800 }],
		'overlap merges, an exact abutment merges, and a real hole stays a hole',
	);
	assert.equal(plan.sources[0].retainedFrames, 300);
});

test('a retimed clip reads more source than it occupies, and keeps all of it', () => {
	// Falling back to the timeline duration for a sped-up clip under-retains,
	// which is the one error this module must never make.
	const plan = planFor({
		clips: [{
			kind: 'audio', id: 'c1', sourceId: 'src', timelineStartFrame: 0,
			durationFrames: 100, sourceStartFrame: 0, speedRatio: 2,
		}],
	});
	assert.deepEqual(plan.sources[0].retained, [{ startFrame: 0, endFrame: 200 }],
		'a clip playing at 2x reads 200 source frames to fill 100 timeline frames');
});

test('an unreferenced source is reported rather than quietly emptied', () => {
	const plan = planFor({ clips: [] });
	assert.equal(plan.sources[0].retainedFrames, 0);
	const item = plan.report.items.find((entry) => entry.code === 'trim.source-unreferenced');
	assert.equal(item?.severity, 'warning');
	assert.equal(item?.scope.id, 'src');
});

test('a fully referenced source is marked as nothing to do', () => {
	const plan = planFor({
		clips: [{
			kind: 'audio', id: 'c1', sourceId: 'src', durationFrames: 1_000,
			sourceStartFrame: 0, sourceDurationFrames: 1_000, speedRatio: 1,
		}],
	});
	assert.equal(plan.sources[0].wholeSourceRetained, true);
	assert.equal(plan.discardedFrames, 0);
	assert.ok(plan.report.items.some((entry) => entry.code === 'trim.source-whole'));
});

test('a clip whose source is gone is an error, not a silent omission', () => {
	const plan = planFor({
		clips: [{ kind: 'audio', id: 'orphan', sourceId: 'nope', durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10, speedRatio: 1 }],
	});
	const item = plan.report.items.find((entry) => entry.code === 'trim.clip-source-missing');
	assert.equal(item?.severity, 'error');
	assert.equal(item?.disposition, 'missing');
});

test('the report counts agree with its items, and the plan refuses bad input', () => {
	const plan = planFor({}, 10);
	assert.equal(
		plan.report.counts.converted,
		plan.report.items.filter((entry) => entry.disposition === 'converted').length,
	);
	assert.throws(() => createTrimMediaPlan({ project: project(), handleFrames: -1 }), /non-negative/u);
	assert.throws(() => createTrimMediaPlan({ project: null as never }), /requires a project/u);
});

test('every referenced frame survives, checked exhaustively rather than by example', () => {
	// The slice's acceptance is that trim provably retains every referenced
	// sample plus declared handles. The examples above check particular spans;
	// this walks every frame of the source against every clip that reads it, so
	// the property holds rather than merely not having been contradicted.
	const clips = [
		{ start: 0, duration: 37 },
		{ start: 36, duration: 1 },
		{ start: 120, duration: 300 },
		{ start: 300, duration: 5 },
		{ start: 999, duration: 1 },
	];
	for (const handleFrames of [0, 1, 25]) {
		const plan = createTrimMediaPlan({
			project: project({
				clips: clips.map((clip, index) => ({
					kind: 'audio', id: `c${index}`, sourceId: 'src', timelineStartFrame: 0,
					durationFrames: clip.duration, sourceStartFrame: clip.start,
					sourceDurationFrames: clip.duration, speedRatio: 1,
				})),
			}),
			handleFrames,
		});
		const [source] = plan.sources;
		const referenced = new Set<number>();
		for (const clip of clips) {
			for (let frame = clip.start; frame < clip.start + clip.duration; frame += 1) referenced.add(frame);
		}
		for (let frame = 0; frame < source.frameCount; frame += 1) {
			if (!referenced.has(frame)) continue;
			assert.ok(
				trimMediaRetainsFrame(source, frame),
				`handles=${handleFrames}: frame ${frame} is referenced and would have been discarded`,
			);
		}
		// And the retained set is not simply everything, or the property is free.
		if (handleFrames === 0) {
			assert.ok(source.discardedFrames > 0, 'the plan must actually be discarding something');
			assert.equal(trimMediaRetainsFrame(source, 500), false, 'an unreferenced frame is not kept');
		}
		// Ranges stay disjoint and ascending at every handle size.
		for (let index = 1; index < source.retained.length; index += 1) {
			assert.ok(
				source.retained[index].startFrame > source.retained[index - 1].endFrame,
				'merged ranges must be disjoint and ascending',
			);
		}
	}
});

test('a Project Bin clip protects its media as firmly as a timeline clip does', () => {
	// The bin holds real references: a bin clip names a source and a range in it,
	// and discarding those frames would leave the bin pointing at material the
	// file no longer contains. Walking only the timeline would do exactly that
	// to any source parked in the bin and not yet placed.
	const binOnly = planFor({
		clips: [],
		tracks: [{ type: 'audio', id: 'a1', name: 'A1', clipIds: [] }],
		projectBin: {
			clips: [{
				kind: 'audio', id: 'b1', sourceId: 'src', title: 'Take',
				timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 400,
				sourceDurationFrames: 100, speedRatio: 1,
			}],
		},
	});
	const [source] = binOnly.sources;
	assert.equal(source.referenceCount, 1, 'the bin clip is a reference');
	assert.deepEqual(source.retained, [{ startFrame: 400, endFrame: 500 }]);
	for (let frame = 400; frame < 500; frame += 1) {
		assert.ok(trimMediaRetainsFrame(source, frame), `bin-referenced frame ${frame} must survive`);
	}

	// And a bin clip that reaches further than the timeline widens what is kept
	// rather than being overridden by it.
	const wider = planFor({
		projectBin: {
			clips: [{
				kind: 'audio', id: 'b1', sourceId: 'src', timelineStartFrame: 0,
				durationFrames: 300, sourceStartFrame: 600, sourceDurationFrames: 300, speedRatio: 1,
			}],
		},
	});
	assert.deepEqual(wider.sources[0].retained, [
		{ startFrame: 400, endFrame: 500 },
		{ startFrame: 600, endFrame: 900 },
	]);
	assert.equal(wider.sources[0].referenceCount, 2);
});
