/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('direct numeric entry stays with the editor-shell controls that import it', () => {
	for (const file of ['ManualValueDialog/ManualValueDialog.tsx', 'ManualValueDialog/manual-value.ts', 'Dialog/Dialog.tsx']) {
		assert.equal(chunkGroupForModulePath(`vendor/audacity-design-system/components/src/${file}`), 'editor-shell-design-components');
	}
});

test('optional speed UI and its vendor component share one lazy owner without a shell initialization cycle', () => {
	for (const file of ['src/common/editor/ui/toolbar/PlaybackSpeedToolbarControl.tsx',
		'vendor/audacity-design-system/components/src/VarispeedControl/VarispeedControl.tsx']) {
		assert.equal(chunkGroupForModulePath(file), 'editor-varispeed-control');
	}
});
