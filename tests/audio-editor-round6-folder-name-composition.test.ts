/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { finishTrackFolderRenameFromKeyboard } from '../src/common/editor/ui/timeline/track-folder-rename-keyboard.ts';

for (const key of ['Enter', 'Escape']) test(`folder rename releases composing ${key}`, () => {
	const calls: unknown[] = [];
	const event = { key, nativeEvent: { isComposing: true }, currentTarget: { value: 'とう', closest: () => null },
		preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') };
	const rename = (id: string, value: string | null) => { calls.push({ id, value }); };
	assert.equal(finishTrackFolderRenameFromKeyboard(event, 'folder', rename), false);
	assert.equal(calls.length, 0);
	assert.equal(event.currentTarget.value, 'とう');
	assert.equal(finishTrackFolderRenameFromKeyboard({ ...event, nativeEvent: { isComposing: false } }, 'folder', rename), true);
	assert.deepEqual(calls, ['prevent', 'stop', { id: 'folder', value: key === 'Enter' ? 'とう' : null }]);
});
