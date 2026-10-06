/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { mixerEffectReplacement } from '../src/common/editor/ui/workspace/mixer-effect-replacement.ts';

test('mixer menu replacements reset parameters and clear the previous effect context', () => {
	const replacement = mixerEffectReplacement('Compressor', {});
	assert.equal(replacement.type, 'audacity-compressor');
	assert.deepEqual(replacement.params, createEffect('audacity-compressor').params);
	assert.equal(replacement.context, null);
	assert.equal(replacement.state, null);
});
