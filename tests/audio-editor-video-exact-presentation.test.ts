/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExactVideoPresentationMapping } from '../src/common/editor/video-exact-presentation.ts';

test('the HTML-media seek time stays inside the drawable half-open interval', () => {
	// A reverse cell's exact source time equals the exclusive end of the owned
	// frame's interval; seeking that boundary would present the next frame.
	const mapping = createExactVideoPresentationMapping({
		sourceFrame: { numerator: 9n, denominator: 1n },
		sourceTime: { numerator: 10n, denominator: 1n },
		drawableSourceStartTime: { numerator: 9n, denominator: 1n },
		drawableSourceEndTime: { numerator: 10n, denominator: 1n },
	}, 5, 48_000);
	assert.ok(
		mapping.sourceTimeSeconds >= 9 && mapping.sourceTimeSeconds < 10,
		`the seek target is inside [9, 10): ${String(mapping.sourceTimeSeconds)}`,
	);
	assert.equal(mapping.sourceFrame, 9);
});

test('a descriptor without a drawable interval seeks its exact source time', () => {
	const mapping = createExactVideoPresentationMapping({
		sourceFrame: { numerator: 4n, denominator: 1n },
		sourceTime: { numerator: 9n, denominator: 2n },
	}, 5, 48_000);
	assert.equal(mapping.sourceTimeSeconds, 4.5);
});
