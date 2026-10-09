/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { finishInlineTrackRename } from '../src/common/editor/ui/timeline/track-name-keyboard-focus.ts';

for (const key of ['Enter', 'Escape']) test(`inline track rename releases composing ${key}`, () => {
	const calls: string[] = [];
	const event = { key, nativeEvent: { isComposing: true }, currentTarget: { closest: () => null },
		preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') };
	assert.equal(finishInlineTrackRename(event, () => calls.push('save'), () => calls.push('cancel')), false);
	assert.equal(calls.length, 0);
	assert.equal(finishInlineTrackRename({ ...event, nativeEvent: { isComposing: false } },
		() => calls.push('save'), () => calls.push('cancel')), true);
	assert.deepEqual(calls, ['prevent', 'stop', key === 'Enter' ? 'save' : 'cancel']);
});
