/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { discoverPasteCommandTree } from '../src/common/editor/controller/edit/internal/paste-command-tree.ts';

test('paste command discovery walks nested batches in stable depth-first order', () => {
	const firstSource = { type: 'source/add', source: { id: 'first' } } as const;
	const paste = { type: 'clipboard/paste', clipboard: {}, atFrame: 0 } as unknown as Extract<
		AudioEditorCommand,
		{ readonly type: 'clipboard/paste' }
	>;
	const secondSource = { type: 'source/add', source: { id: 'second' } } as const;
	const command: AudioEditorCommand = {
		type: 'batch',
		commands: [
			firstSource,
			{ type: 'batch', commands: [
				{ type: 'project/rename', title: 'Ignored' },
				paste,
				{ type: 'batch', commands: [secondSource] },
			] },
		],
	};

	const discovered = discoverPasteCommandTree(command);

	assert.deepEqual(discovered.pastes, [paste]);
	assert.deepEqual(discovered.sourceAdds, [firstSource, secondSource]);
});

test('paste command discovery retains every nested paste for caller-specific cardinality errors', () => {
	const first = { type: 'clipboard/paste', clipboard: {}, atFrame: 0 } as unknown as Extract<
		AudioEditorCommand,
		{ readonly type: 'clipboard/paste' }
	>;
	const second = { ...first };
	const discovered = discoverPasteCommandTree({
		type: 'batch',
		commands: [first, { type: 'batch', commands: [second] }],
	});

	assert.deepEqual(discovered.pastes, [first, second]);
	assert.deepEqual(discovered.sourceAdds, []);
});
