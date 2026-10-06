/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { newLabelRange } from '../src/common/editor/ui/workspace/new-label-range.ts';

test('new labels follow the playhead without a selected range', () => {
	assert.deepEqual(newLabelRange(null, 38_400), { startFrame: 38_400, endFrame: 38_400 });
	assert.deepEqual(newLabelRange({ startFrame: 0, endFrame: 0 }, 38_400), { startFrame: 38_400, endFrame: 38_400 });
	assert.deepEqual(newLabelRange({ startFrame: 100, endFrame: 200 }, 38_400), { startFrame: 100, endFrame: 200 });
});
