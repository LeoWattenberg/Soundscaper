/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlenderWorkspaceMenuPort, disposeBlenderWorkspaceSession } from '../src/common/editor/ui/workspace/blender-workspace-menu.ts';

test('workspace teardown prevents a pending Blender module load from opening the export picker', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'soundscaperDesktop');
	let selections = 0;
	Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true,
		value: { v1: { blender: { select: async () => { selections += 1; return null; } } } } });
	const controller = { getSnapshot: () => ({ project: { id: 'project', revision: 1 } }),
		subscribe: () => () => undefined,
		actions: { export: { publishBlenderTracks: async () => ({ revision: 1 }) } } };
	try {
		const input = { controller, copy: {}, fileService: { isDesktop: true }, productId: 'soundscaper', run: (action: () => unknown) => action() };
		assert.equal(createBlenderWorkspaceMenuPort({ ...input, productId: 'framescaper' }), null);
		assert.equal(createBlenderWorkspaceMenuPort({ ...input, fileService: { isDesktop: false } }), null);
		const port = createBlenderWorkspaceMenuPort(input);
		assert.ok(port);
		const pending = port.exportTracks();
		disposeBlenderWorkspaceSession(controller);
		await pending;
		assert.equal(selections, 0);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'soundscaperDesktop', previous);
		else Reflect.deleteProperty(globalThis, 'soundscaperDesktop');
	}
});
