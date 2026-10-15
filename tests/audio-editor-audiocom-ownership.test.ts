/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('audio.com presentation, controller and full copy load only with the optional panel', () => {
	for (const path of [
		'src/common/editor/ui/workspace/AudiocomPanel.tsx',
		'src/common/editor/ui/workspace/AudiocomPanelContainer.tsx',
		'src/common/editor/ui/workspace/AudiocomLink.tsx',
		'src/common/editor/ui/workspace/AudiocomUploadArea.tsx',
		'src/common/editor/ui/workspace/AudiocomPublishDialog.tsx',
		'src/common/editor/ui/workspace/AudiocomProjectArchives.tsx',
		'src/common/editor/ui/audio-editor-design-system/06a-panels-audiocom.css',
		'src/common/editor/controller/import/audiocom-panel-session.ts',
		'src/common/editor/controller/import/internal/audiocom-panel-session.ts',
		'src/common/editor/controller/import/internal/audiocom-api-client.ts',
		'src/common/editor/controller/import/internal/audiocom-upload-queue.ts',
		'src/common/editor/controller/import/internal/audiocom-provider.ts',
		'src/common/editor/controller/import/audiocom-project-archives.ts',
		'src/common/editor/controller/import/internal/audiocom-project-archives.ts',
		'src/common/editor/controller/import/internal/audiocom-project-archive-client.ts',
		'src/common/i18n/audiocom-copy.ts',
	]) {
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces', path);
		assert.equal(chunkGroupForModulePath(`/workspace/${path}`), 'editor-optional-surfaces', path);
	}
	assert.equal(chunkGroupForModulePath('src/common/i18n/editor-audiocom-inventory-copy.ts'), 'editor-copy');
	assert.equal(chunkGroupForModulePath('/workspace/src/common/i18n/editor-audiocom-inventory-copy.ts'), 'editor-copy');
});
