/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

for (const desktop of [false, true]) {
	test(`Generate imports and reopens the same ordinary ${desktop ? 'native picker' : 'browser'} PNG`, async ({ page }) => {
		const png = createPngFixture(16);
		// This helper delegates to the actual native chooser, read capability store
		// and protocol for any ordinary file; its original name reflects its first use.
		const native = desktop ? await installNativeCaptionSidecar(page, 'poster.png', png) : null;
		try {
			const editor = await bootEditor(page, '/framescaper/en/');
			const projectId = await editor.getAttribute('data-project-id');
			const chooser = native ? null : page.waitForEvent('filechooser');
			await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
			if (chooser) await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: png });
			const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
			await expect(clip).toBeVisible();
			await expect(clip.locator('[data-product-visual-thumbnail]')).toHaveCount(1);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			if (native) await expect.poll(() => native.releases.length).toBe(1);
			await page.reload();
			await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
			await expect(editor).toHaveAttribute('data-project-id', projectId);
			await expect(clip).toBeVisible();
			await expect(clip.locator('[data-product-visual-thumbnail]')).toHaveCount(1);
		} finally { await native?.close(); }
	});
}
