/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { collectRound4DspFixtures } from './helpers/responsiveness-round4-dsp-fixtures.ts';

test('round-four DSP preserves frozen baseline PCM, snapshots and painted geometry', async () => {
	// Spectrum signatures include the deliberate round-five Hann gain and complete-window fixes.
	// Independent level expectations live in audio-editor-round5-spectrum-level-calibration.test.ts.
	// EBU signatures include round-six's sample/true-peak separation; all other
	// EBU fields remain exact, as checked in audio-editor-round6-ebu-sample-peak.test.ts.
	const expected: unknown = JSON.parse(readFileSync(new URL('./fixtures/dsp-round4-parity.json', import.meta.url), 'utf8'));
	assert.deepEqual(await collectRound4DspFixtures(), expected);
});
