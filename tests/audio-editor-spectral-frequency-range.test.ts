/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spectralSelectionFrequencyRangeValid } from '../src/common/editor/ui/dialogs/spectral-selection-frequency-range.ts';

test('spectral ranges reject missing endpoints and retain valid numeric and scientific drafts', () => {
	for (const [minimum, maximum] of [['', '20000'], [' ', '20000'], ['0', ''], ['0', ' ']] as const) {
		assert.equal(spectralSelectionFrequencyRangeValid(minimum, maximum, 24_000), false);
	}
	for (const [minimum, maximum] of [[0, 20_000], ['0', '24000'], ['1e3', '8e3']] as const) {
		assert.equal(spectralSelectionFrequencyRangeValid(minimum, maximum, 24_000), true);
	}
	for (const [minimum, maximum] of [[-1, 1], [0, 24_001], [1, 1], ['invalid', '20000']] as const) {
		assert.equal(spectralSelectionFrequencyRangeValid(minimum, maximum, 24_000), false);
	}
});
