/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, importFiles } from './audio-editor-test-helpers.js';

test('File Open accepts a normal broadcast WAV with its BWF suffix and no audio MIME association', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = {
		name: 'location-take.bwf', mimeType: 'application/octet-stream',
		buffer: Buffer.from(encodeWav([Float32Array.from({ length: 4_800 }, (_, frame) => (
			0.2 * Math.sin(frame * Math.PI * 880 / 48_000)
		))], { sampleRate: 48_000, bitDepth: 16, bext: { description: 'Location take', timeReference: '0' } })),
	};
	await importFiles(editor, [recording]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const originalId = await editor.getAttribute('data-project-id');
	const opening = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await opening).setFiles(recording);
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originalId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-project-name]')).toContainText('location-take');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
});
