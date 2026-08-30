/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ThreePointEditError,
	convertFrameCount,
	resolveThreePointEdit,
} from '../src/common/editor/three-point-edit.ts';

const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 25, den: 1 });
const FILM = Object.freeze({ num: 24, den: 1 });
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

function context(overrides: Record<string, unknown> = {}) {
	return {
		sourceRate: FILM,
		sequenceRate: PAL,
		sampleRate: SAMPLE_RATE,
		sourceFrameCount: 240,
		...overrides,
	};
}

test('a marked source range placed at a sequence point resolves the sequence out', () => {
	// 48 frames of 24 fps media is two seconds, which is 50 frames of PAL.
	const edit = resolveThreePointEdit({ sourceIn: 24, sourceOut: 72, sequenceIn: 100 }, context());
	assert.equal(edit.resolved, 'sequenceOut');
	assert.deepEqual(
		[edit.sourceIn, edit.sourceOut, edit.sequenceIn, edit.sequenceOut],
		[24, 72, 100, 150],
	);
	assert.equal(edit.sourceFrameCount, 48);
	assert.equal(edit.sequenceFrameCount, 50);
	// The same span in samples, resolved from the sequence grid.
	assert.equal(edit.startFrame, 100 * SAMPLE_RATE / 25);
	assert.equal(edit.endFrame, 150 * SAMPLE_RATE / 25);
});

test('a sequence range filled from a source in point resolves the source out', () => {
	const edit = resolveThreePointEdit({ sourceIn: 0, sequenceIn: 10, sequenceOut: 60 }, context());
	assert.equal(edit.resolved, 'sourceOut');
	assert.deepEqual([edit.sourceIn, edit.sourceOut], [0, 48]);
	assert.equal(edit.sequenceFrameCount, 50);
});

test('backtimed edits resolve the leading point from the trailing one', () => {
	const fromSequenceOut = resolveThreePointEdit(
		{ sourceIn: 24, sourceOut: 72, sequenceOut: 150 },
		context(),
	);
	assert.equal(fromSequenceOut.resolved, 'sequenceIn');
	assert.equal(fromSequenceOut.sequenceIn, 100);

	const fromSourceOut = resolveThreePointEdit(
		{ sourceOut: 72, sequenceIn: 10, sequenceOut: 60 },
		context(),
	);
	assert.equal(fromSourceOut.resolved, 'sourceIn');
	assert.equal(fromSourceOut.sourceIn, 24);
});

test('the extent depends on the source count and not on where the range starts', () => {
	const first = resolveThreePointEdit({ sourceIn: 0, sourceOut: 48, sequenceIn: 0 }, context());
	for (const start of [1, 7, 23, 100, 191]) {
		const later = resolveThreePointEdit(
			{ sourceIn: start, sourceOut: start + 48, sequenceIn: 0 },
			context(),
		);
		assert.equal(
			later.sequenceFrameCount,
			first.sequenceFrameCount,
			`48 source frames from ${String(start)} must still be ${String(first.sequenceFrameCount)} sequence frames`,
		);
	}
});

test('an NTSC sequence receives an exact change of basis, not a seconds detour', () => {
	// 24 fps into 30000/1001: 240 frames is ten seconds, which is 299.7 NTSC
	// frames and therefore 300 whole frames at the nearest point.
	const edit = resolveThreePointEdit(
		{ sourceIn: 0, sourceOut: 240, sequenceIn: 0 },
		context({ sequenceRate: NTSC }),
	);
	assert.equal(edit.sequenceFrameCount, 300);
	assert.equal(convertFrameCount(240, FILM, NTSC), 300);
	assert.equal(convertFrameCount(300, NTSC, FILM), 240);
	// A single frame never rounds away.
	assert.equal(convertFrameCount(1, NTSC, FILM), 1);
});

test('four points are admitted only when they agree', () => {
	const agreeing = resolveThreePointEdit(
		{ sourceIn: 0, sourceOut: 48, sequenceIn: 0, sequenceOut: 50 },
		context(),
	);
	assert.equal(agreeing.sequenceFrameCount, 50);
	assert.throws(() => resolveThreePointEdit(
		{ sourceIn: 0, sourceOut: 48, sequenceIn: 0, sequenceOut: 40 },
		context(),
	), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'over-specified');
		return true;
	});
});

test('an edit nothing determines is refused rather than guessed at', () => {
	for (const [request, reason] of [
		[{ sourceIn: 0, sequenceIn: 0 }, 'under-specified'],
		[{ sourceIn: 0 }, 'under-specified'],
		[{}, 'under-specified'],
	] as const) {
		assert.throws(() => resolveThreePointEdit(request, context()), (error: unknown) => {
			assert.ok(error instanceof ThreePointEditError);
			assert.equal(error.reason, reason);
			return true;
		});
	}
});

test('every choice of three points completes one pair, so every choice resolves', () => {
	// Omitting any one of four distinct points always leaves a complete pair,
	// which is why there is no fourth "nothing determines this" branch.
	const points = { sourceIn: 24, sourceOut: 72, sequenceIn: 100, sequenceOut: 150 };
	for (const omitted of ['sourceIn', 'sourceOut', 'sequenceIn', 'sequenceOut'] as const) {
		const request = { ...points, [omitted]: null };
		const edit = resolveThreePointEdit(request, context());
		assert.equal(edit.resolved, omitted, `omitting ${omitted} must resolve ${omitted}`);
		assert.deepEqual(
			[edit.sourceIn, edit.sourceOut, edit.sequenceIn, edit.sequenceOut],
			[24, 72, 100, 150],
			`${omitted} must be recovered exactly`,
		);
	}
});

test('an edit that keeps no frames is refused whichever pair is complete', () => {
	assert.throws(() => resolveThreePointEdit(
		{ sourceIn: 5, sourceOut: 5, sequenceIn: 0 },
		context(),
	), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'empty-range');
		return true;
	});
	assert.throws(() => resolveThreePointEdit(
		{ sourceIn: 0, sequenceIn: 7, sequenceOut: 7 },
		context(),
	), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'empty-range');
		return true;
	});
});

test('an edit that asks for media beyond the source is refused, never clamped', () => {
	assert.throws(() => resolveThreePointEdit(
		{ sourceIn: 200, sourceOut: 260, sequenceIn: 0 },
		context(),
	), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'source-out-of-bounds');
		return true;
	});
	assert.throws(() => resolveThreePointEdit(
		{ sourceIn: 0, sequenceIn: 0, sequenceOut: 500 },
		context(),
	), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'source-out-of-bounds');
		return true;
	});
});

test('a backtimed edit that would start before the origin is refused', () => {
	assert.throws(() => resolveThreePointEdit(
		{ sourceIn: 0, sourceOut: 48, sequenceOut: 10 },
		context(),
	), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'empty-range');
		return true;
	});
});

test('the four points of a resolved edit are admitted when they are given again', () => {
	// Count conversion is monotone but not invertible: 1337 PAL frames resolve to
	// 1284 film frames, while 1284 film frames resolve to 1338 PAL frames because
	// the exact ratio lands on a half. Admitting four points in only one of those
	// directions refused an edit this module had itself just produced, so which
	// marks the user happened to set decided whether the edit was legal.
	const scope = context({ sourceFrameCount: 100_000 });
	assert.equal(convertFrameCount(1_337, PAL, FILM), 1_284);
	assert.equal(convertFrameCount(1_284, FILM, PAL), 1_338);
	const derived = resolveThreePointEdit({ sourceIn: 0, sequenceIn: 0, sequenceOut: 1_337 }, scope);
	assert.equal(derived.sourceOut, 1_284);
	const readmitted = resolveThreePointEdit({
		sourceIn: derived.sourceIn,
		sourceOut: derived.sourceOut,
		sequenceIn: derived.sequenceIn,
		sequenceOut: derived.sequenceOut,
	}, scope);
	assert.equal(readmitted.sourceFrameCount, 1_284);
	assert.equal(readmitted.sequenceFrameCount, 1_337);
});

test('four points whose durations genuinely disagree are still refused', () => {
	assert.throws(() => resolveThreePointEdit(
		{ sourceIn: 0, sourceOut: 1_284, sequenceIn: 0, sequenceOut: 1_500 },
		context({ sourceFrameCount: 100_000 }),
	), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'over-specified');
		return true;
	});
});
