/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Two envelopes agree only when their summaries can both be described.
 *
 * The comparison runs each summary through the canonical form and compares the
 * text, and a summary the canonical form refuses - a non-finite number, a
 * circular reference, a symbol key - produces no text at all. V1 says so out
 * loud: "a value no canonical form can describe states nothing, so it agrees
 * with nothing." V2 and V3 compared the two absences directly, so two summaries
 * that could not be described were reported as describing the same plan.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	divergentNativeMediaPlanSummaryFields,
} from '../src/common/editor/native-media-plan-envelope.ts';
import {
	divergentNativeMediaPlanEnvelopeV2Fields,
	type NativeMediaPlanEnvelopeV2,
} from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	divergentNativeMediaPlanEnvelopeV3Fields,
	type NativeMediaPlanEnvelopeV3,
} from '../src/common/editor/native-media-plan-envelope-v3.ts';

function envelope(summary: unknown, envelopeVersion: 2 | 3): unknown {
	return {
		envelopeVersion,
		planVersion: 14,
		strategy: 'framescaper-unified-exact-v14-native',
		fingerprint: 'a'.repeat(64),
		canonicalByteLength: 128,
		summary,
		plan: { version: 14 },
	};
}

/** Summaries the canonical form refuses, and which describe different plans. */
const INDESCRIBABLE = Object.freeze([
	{ width: 1_920, height: Number.NaN },
	{ width: 1_280, height: Number.POSITIVE_INFINITY },
]);

test('V2 reports summaries no canonical form can describe as divergent', () => {
	const [left, right] = INDESCRIBABLE;
	assert.deepEqual(
		divergentNativeMediaPlanEnvelopeV2Fields(
			envelope(left, 2) as NativeMediaPlanEnvelopeV2,
			envelope(right, 2) as NativeMediaPlanEnvelopeV2,
		),
		['summary'],
	);
});

test('V3 reports summaries no canonical form can describe as divergent', () => {
	const [left, right] = INDESCRIBABLE;
	assert.deepEqual(
		divergentNativeMediaPlanEnvelopeV3Fields(
			envelope(left, 3) as NativeMediaPlanEnvelopeV3,
			envelope(right, 3) as NativeMediaPlanEnvelopeV3,
		),
		['summary'],
	);
});

test('V1 already refuses to let two indescribable summaries agree', () => {
	const [left, right] = INDESCRIBABLE;
	assert.deepEqual(
		divergentNativeMediaPlanSummaryFields(left, right as never),
		['height', 'width'],
	);
});

test('describable summaries still compare on their content alone', () => {
	const summary = { width: 1_920, height: 1_080 };
	for (const [compare, version] of [
		[divergentNativeMediaPlanEnvelopeV2Fields, 2],
		[divergentNativeMediaPlanEnvelopeV3Fields, 3],
	] as const) {
		const same = compare(
			envelope({ ...summary }, version) as never,
			envelope({ ...summary }, version) as never,
		);
		assert.deepEqual(same, [], `V${String(version)} equal summaries must not diverge`);
		const different = compare(
			envelope(summary, version) as never,
			envelope({ ...summary, height: 720 }, version) as never,
		);
		assert.deepEqual(different, ['summary'], `V${String(version)} must see a changed summary`);
	}
});
