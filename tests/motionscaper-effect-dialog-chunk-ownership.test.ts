/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('Motion shared rack suspense boundary stays with its consumer and lazy parameter owner', () => {
	const directory = 'src/common/editor/ui/inspector/';
	const consumer = chunkGroupForModulePath(`${directory}AudioEditorEffectsOverlay.jsx`);
	assert.equal(consumer, 'editor-effect-dialog-shell');
	for (const module of ['RackEffectDialog.tsx', 'LazyEffectParameterEditor.jsx']) {
		assert.equal(chunkGroupForModulePath(`${directory}${module}`), consumer, module);
	}
	const group = chunkGroups.find(candidate => candidate.name === consumer);
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false, 'own the shared boundary without capturing optional parameter code');
	assert.notEqual(chunkGroupForModulePath(`${directory}EffectParameterEditor.jsx`), consumer);
});
