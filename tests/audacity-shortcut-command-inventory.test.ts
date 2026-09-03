/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAudacityShortcutCommands } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts';

test('shortcut preferences expose one canonical Insert row', () => {
	const commands = collectAudacityShortcutCommands([]);
	assert.equal(commands.filter(({ id }) => id === 'insert').length, 1);
	assert.equal(commands.some(({ id }) => id === 'action://trackedit/paste-insert'), false);
});
