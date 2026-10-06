/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { finishTrackFolderRenameFromKeyboard } from '../src/common/editor/ui/timeline/track-folder-rename-keyboard.ts';

test('folder rename Enter and Escape return focus after the input is removed', async () => {
	for (const [key, expected] of [['Enter', 'Rhythm'], ['Escape', null]] as const) {
		const calls: unknown[] = [];
		const row = { isConnected: true, focus: () => calls.push('focus') };
		const event = { key, currentTarget: { value: 'Rhythm', closest: () => row },
			preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') };
		assert.equal(finishTrackFolderRenameFromKeyboard(event as never, 'folder', (id, value) => {
			calls.push([id, value]);
		}), true);
		assert.deepEqual(calls, ['prevent', 'stop', ['folder', expected]]);
		await Promise.resolve();
		assert.deepEqual(calls, ['prevent', 'stop', ['folder', expected], 'focus']);
	}
});

test('ordinary blur navigation and disconnected rows do not steal focus', async () => {
	const calls: unknown[] = [];
	const row = { isConnected: false, focus: () => calls.push('focus') };
	const event = { key: 'Tab', currentTarget: { value: 'Rhythm', closest: () => row },
		preventDefault() {}, stopPropagation() {} };
	assert.equal(finishTrackFolderRenameFromKeyboard(event as never, 'folder', () => calls.push('rename')), false);
	assert.deepEqual(calls, []);
	finishTrackFolderRenameFromKeyboard({ ...event, key: 'Escape' } as never,
		'folder', () => calls.push('cancel'));
	await Promise.resolve();
	assert.deepEqual(calls, ['cancel']);
});
