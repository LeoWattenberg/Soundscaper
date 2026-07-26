/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { splitButtonFlyoutPlacement } from '../src/common/editor/ui/AudioEditorSplitButton.tsx';

test('split-button adapter anchors flyouts consistently for pointer and keyboard activation', () => {
	const rect = { left: 10, width: 28, top: 20, bottom: 48 };
	assert.deepEqual(splitButtonFlyoutPlacement(rect, 500, true), {
		x: 24, y: 48, direction: 'down', autoFocus: true,
	});
	assert.deepEqual(splitButtonFlyoutPlacement(rect, 200, false), {
		x: 24, y: 48, direction: 'up', autoFocus: false,
	});
});
