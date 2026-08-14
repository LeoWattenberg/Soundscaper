/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import {
	createFramescaperV18Format2Scape,
	framescaperV18Format2Expectation as expectedArchive,
} from './fixtures/framescaper-v18-format2-scape.js';

test.describe('Framescaper selected-web Scape preservation boundary', () => {
	registerAudioEditorHooks();

	test('V19 refuses a desktop-only V18 format-2 archive without replacing the project', async ({ page }) => {
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		const originalProjectId = await editor.getAttribute('data-project-id');
		const input = editor.locator('[data-aup4-input]');
		const fixedArchive = await createFramescaperV18Format2Scape();

		await input.setInputFiles(fixedArchive);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'error');
		await expect(editor.locator('[data-status]')).toContainText(
			'Unsupported .scape format version: 2.',
		);
		await expect(editor).toHaveAttribute('data-project-id', originalProjectId);
		await expect(editor.getByRole('tab', { name: expectedArchive.projectTitle, exact: true })).toHaveCount(0);
		await expect(page.getByRole('dialog', { name: 'Project features unavailable' })).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});
