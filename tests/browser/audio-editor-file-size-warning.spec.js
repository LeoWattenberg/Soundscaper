/* SPDX-License-Identifier: AGPL-3.0-only */

import { aup4NativeRichFixture, expect, test } from './audio-editor-test-fixtures.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { bootEditor, chooseFileAction, getMenuItem, openNestedCommandMenu, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');

test.describe('overridable file size warnings', () => {
	registerAudioEditorHooks();
	for (const [productId, path] of [['soundscaper', '/embed/en/']]) {
		test(`${productId} cancels or continues an oversized project from the File menu`, async ({ page }) => {
			test.setTimeout(60_000);
			await page.addInitScript(() => {
				const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
				// Exercise admission with a valid small database; allocating a GiB is unnecessary.
				Object.defineProperty(File.prototype, 'size', { configurable: true, get() {
					return this.name === 'large-warning.aup4' ? 1024 ** 3 : size.call(this);
				} });
			});
			const editor = await bootEditor(page, path);
			const originalProject = await editor.getAttribute('data-project-id');
			const open = async () => {
				const chooser = page.waitForEvent('filechooser');
				await chooseFileAction(page, editor, 'Open');
				await (await chooser).setFiles({ name: 'large-warning.aup4', mimeType: 'application/x-audacity-project', buffer: Buffer.from(aup4NativeRichFixture()) });
			};
			await open();
			const warning = page.getByRole('dialog', { name: 'Large file warning' });
			await expect(warning).toBeVisible();
			await expect(warning).toContainText('large-warning.aup4');
			await expect(warning).toContainText('1 GiB');
			await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(warning).toHaveCount(0);
			await expect(editor).toHaveAttribute('data-project-id', originalProject);
			await expect(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
			await open();
			await expect(warning).toBeVisible();
			await warning.getByRole('button', { name: 'Continue', exact: true }).click();
			await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
			await expect(warning).toHaveCount(0);
			await expect(editor).not.toHaveAttribute('data-project-id', originalProject);
		});
	}

	test('framescaper cancels or continues an oversized image from Generate', async ({ page }) => {
		test.setTimeout(60_000);
		await page.addInitScript(() => {
			globalThis.__sizeWarningActive = true;
			const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
			Object.defineProperty(File.prototype, 'size', { configurable: true, get() {
				return this.name === 'large-warning.png' && globalThis.__sizeWarningActive ? 65 * 1024 ** 2 : size.call(this);
			} });
		});
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const originalProject = await editor.getAttribute('data-project-id');
		const open = async () => {
			const choosing = page.waitForEvent('filechooser');
			const generate = await openNestedCommandMenu(page, editor, 'Generate', []);
			await getMenuItem(generate, EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']).click();
			await (await choosing).setFiles({ name: 'large-warning.png', mimeType: 'image/png', buffer: PNG });
		};
		await open();
		const warning = page.getByRole('dialog', { name: 'Large file warning' });
		await expect(warning).toBeVisible();
		await expect(warning).toContainText('large-warning.png');
		await expect(warning).toContainText('65 MiB');
		await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(warning).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-project-id', originalProject);
		await expect(editor.locator('[data-clip-kind="image"]')).toHaveCount(0);
		await expect(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
		await open();
		await expect(warning).toBeVisible();
		// The declaration exercises admission; the normal decoder verifies the small fixture bytes.
		await page.evaluate(() => { globalThis.__sizeWarningActive = false; });
		await warning.getByRole('button', { name: 'Continue', exact: true }).click();
		await expect(warning).toHaveCount(0);
		await expect(editor.locator('[data-clip-kind="image"]')).toHaveCount(1, { timeout: 30_000 });
		await expect(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
	});
});
