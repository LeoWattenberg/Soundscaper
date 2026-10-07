/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleAudio } from '../handbook/guides/example-audio.mjs';

test('the restoration example contains repeated flat-topped peaks at both polarities', () => {
	const bytes = exampleAudio('clipped-take');
	let positiveRuns = 0;
	let negativeRuns = 0;
	for (let offset = 46; offset < bytes.length; offset += 2) {
		const previous = bytes.readInt16LE(offset - 2);
		const sample = bytes.readInt16LE(offset);
		if (previous === 32_767 && sample === previous) positiveRuns++;
		if (previous === -32_767 && sample === previous) negativeRuns++;
	}
	assert.ok(positiveRuns > 1000);
	assert.ok(negativeRuns > 1000);
});
