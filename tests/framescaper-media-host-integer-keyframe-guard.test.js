/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const HEADER = new URL(
	'../native/framescaper-media-host/src/unified_plan_common.hpp',
	import.meta.url,
);

/**
 * A structural guard, not a behavioural one: the host takes a whole plan on the
 * command line and the repository has no C++ harness that validates one, so the
 * cheapest honest protection is to pin where the rule is evaluated.
 *
 * The rule keeps an integer-only effect parameter — pixelate block size, an
 * RGB-split offset, a luma-key mode — on hold segments, because anything else
 * interpolates to fractional values it cannot represent. Evaluating it inside
 * the non-bezier branch let a cubic Bezier between two integral anchors through,
 * which interpolates exactly the same way.
 */
test('the integer keyframe rule is evaluated before the segment kind is dispatched', async () => {
	const source = await readFile(HEADER, 'utf8');
	const guard = source.indexOf('An integer picture keyframe target requires hold segments.');
	const dispatch = source.indexOf('if (segment_kind == "bezier") {');

	assert.notEqual(guard, -1, 'the integer keyframe rule is present');
	assert.notEqual(dispatch, -1, 'the segment kind dispatch is present');
	assert.ok(
		guard < dispatch,
		'the rule must precede the dispatch, or a bezier segment bypasses it',
	);
	assert.equal(
		source.split('An integer picture keyframe target requires hold segments.').length - 1,
		1,
		'the rule is stated once, so neither branch can drift away from it',
	);
});
