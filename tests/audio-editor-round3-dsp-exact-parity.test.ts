/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { collectRound3DspFixtures } from './helpers/round3-dsp-fixtures.ts';

test('round-three DSP preserves exact merged-baseline PCM and profile bytes', async () => {
	// Only mono Vocoder changes for round-six's complete carrier; independent equivalence
	// expectations live in audio-editor-round6-vocoder-mono-carrier.test.ts.
	const expected: unknown = JSON.parse(readFileSync(new URL('./fixtures/dsp-round3-parity.json', import.meta.url), 'utf8'));
	assert.deepEqual(await collectRound3DspFixtures(), expected);
});
