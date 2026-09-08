/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	linearMixerGainToDb,
	mixerDbToLinearGain,
} from '../src/common/editor/ui/workspace/AudioEditorMixerPanel.jsx';

test('the mixer fader floor round-trips literal silence', () => {
	assert.equal(linearMixerGainToDb(0), -60);
	assert.equal(mixerDbToLinearGain(-60), 0);
	assert.equal(mixerDbToLinearGain(linearMixerGainToDb(0)), 0);
});
