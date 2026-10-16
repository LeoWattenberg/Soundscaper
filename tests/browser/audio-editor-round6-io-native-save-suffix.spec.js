/* SPDX-License-Identifier: AGPL-3.0-only */

import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js/index-native.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, chooseNestedCommandAction, commitInput } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

for (const title of ['Ordinary programme', 'Ordinary programme '.repeat(9) + 'Mixdown', '東京での録音'.repeat(20)]) test(`native Save and Open preserve a ${title.length} character project title`, async ({ page }) => {
	const native = await installNativeCaptionSidecar(page, 'ordinary.srt', '', { saveName: 'choice.fscape', saveSuggestedName: true, openSavedFile: true });
	try {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
		await commitInput(dialog.locator('[data-project-name-input] input'), title);
		await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
		await expect(editor.locator('[data-project-name]')).toHaveText(title);
		const id = await editor.getAttribute('data-project-id');
		await chooseExportProjectFileAction(page, editor);
		await expect.poll(() => native.saveChoices.length).toBe(1);
		await expect.poll(async () => (await native.savedBytes().catch(() => null))?.byteLength ?? 0).toBeGreaterThan(0);
		const reader = new ZipReader(new Uint8ArrayReader(await native.savedBytes()));
		try {
			const entry = (await reader.getEntries()).find((item) => item.filename === 'project.json');
			expect(entry).toBeDefined();
			const project = JSON.parse(await entry.getData(new TextWriter()));
			expect(project.title).toBe(title);
			expect(project.id).toBe(id);
		} finally { await reader.close(); }
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', id);
		const draftId = await editor.getAttribute('data-project-id');
		await test.info().attach('native-save-default.json', { body: JSON.stringify(native.saveChoices), contentType: 'application/json' });
		await chooseFileAction(page, editor, 'Open');
		await expect.poll(() => native.calls.length).toBe(1);
		const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
		await expect(collision).toBeVisible();
		await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', draftId);
		await expect(editor.locator('[data-project-name]')).toContainText(title);
		await expect(editor.locator('[data-project-name]')).toContainText('copy');
		expect(native.saveChoices[0].defaultPath).toMatch(/\.fscape$/u);
	} finally { await native.close(); }
});
