/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

test.describe('silent video import', () => {
	registerAudioEditorHooks();
	test('imports an MP4 without an audio track', async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [videoRetimePreviewMedia.file]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-status]')).not.toContainText('could not be decoded');
	});
});
