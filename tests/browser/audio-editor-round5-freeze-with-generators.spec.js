/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

for (const withTitle of [false, true]) {
	test(`ordinary camera Freeze ${withTitle ? 'with a Title bystander' : 'without a Title'}`, async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact composited Freeze capture requires WebGL2, which this browser environment refuses.');
		test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Exact Freeze PNG persistence requires working IndexedDB Blob storage, which this browser environment refuses.');
		if (withTitle) await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
		await importFiles(editor, [createDeterministicAvFixture('freeze-camera.webm')]);
		await editor.getByRole('group', { name: 'Video clip: freeze-camera', exact: true }).press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video']);
		const dialog = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
		await dialog.locator('[data-framescaper-authoring-freeze]').click();
		await expect(dialog.getByRole('status')).toHaveText('Exact playhead freeze created.');
		if (withTitle) await expect(editor.getByRole('group', { name: 'Video clip: Title', exact: true })).toHaveCount(1);
	});
}
