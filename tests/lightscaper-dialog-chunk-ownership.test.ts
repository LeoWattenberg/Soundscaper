/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const owner = 'editor-dialog-foundations';
const ui = fileURLToPath(new URL('../src/common/editor/ui/', import.meta.url));
const neutralModules = ['AudioEditorDialogShell.tsx', 'AudioEditorResizableSurface.jsx', 'dialog-escape-ownership.ts',
	'dialog-focus-ownership.ts', 'focus-restoration.ts', 'dialog-drag-bounds.ts', 'dialog-move-lifecycle.ts',
	'resizable-surface-mouse-lifecycle.ts'];

test('the shared dialog frame has a neutral complete ownership closure without the timeline shell', () => {
	const visited = new Set<string>();
	const pending = [ui + 'AudioEditorDialogShell.tsx'];
	while (pending.length) {
		const module = pending.pop()!;
		if (visited.has(module)) continue;
		visited.add(module);
		assert.equal(chunkGroupForModulePath(module), owner, module);
		for (const dependency of staticRelativeDependencies(readFileSync(module, 'utf8'))) {
			const target = resolveRelativeModule(module, dependency);
			if (target) pending.push(target);
		}
	}
	assert.deepEqual([...visited].map((path) => path.slice(ui.length)).sort(), [...neutralModules].sort());
	for (const module of neutralModules) {
		assert.equal(chunkGroupForModulePath((ui + module).replaceAll('/', '\\')), owner, module);
		assert.notEqual(chunkGroupForModulePath(ui + module + '.foreign'), owner, module);
	}
});

test('the shared dialog header stays with its consumer and its ownership cannot absorb editor themes or privacy routes', () => {
	for (const path of ['DialogHeader.tsx', 'DialogHeader.css', 'index.ts']) {
		assert.equal(chunkGroupForModulePath(`vendor/audacity-design-system/components/src/DialogHeader/${path}`), owner);
	}
	assert.equal(chunkGroupForModulePath(ui + 'DesignSystemRuntime.jsx'), 'editor-shell');
	assert.equal(chunkGroupForModulePath(ui + 'EditorMusicalTimeCodeProvider.tsx'), 'editor-shell');
	assert.notEqual(chunkGroupForModulePath(ui + 'PrivacyPolicyRoute.tsx'), owner);
	assert.notEqual(chunkGroupForModulePath(ui + 'dialogs/PrivacyPolicyDialog.tsx'), owner);
	assert.equal(chunkGroupForModulePath(ui + 'lightscaper/PhotoImportDialog.tsx'), null);
	const group = chunkGroups.find((candidate) => candidate.name === owner);
	assert.ok(group);
	assert.equal(group.priority, 99);
	assert.equal(group.minSize, 0);
	assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false);
});
