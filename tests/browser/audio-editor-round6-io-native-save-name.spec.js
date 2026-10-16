/* SPDX-License-Identifier: AGPL-3.0-only */

import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js/index-native.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction, commitInput } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

for (const title of ['東京での録音', '東京での録音'.repeat(12)]) test(`native project Save accepts its valid ${Buffer.byteLength(title + '.fscape')} byte default filename`, async ({ page }) => {
	const native = await installNativeCaptionSidecar(page, 'ordinary.srt', '', { saveName: 'choice.fscape', saveSuggestedName: true });
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
		expect(native.saveChoices[0].defaultPath).toBe(`${title}.fscape`);
		expect(Buffer.byteLength(native.saveChoices[0].defaultPath)).toBeLessThanOrEqual(255);
		await expect.poll(async () => (await native.savedBytes().catch(() => null))?.byteLength ?? 0).toBeGreaterThan(0);
		const reader = new ZipReader(new Uint8ArrayReader(await native.savedBytes()));
		try {
			const entries = await reader.getEntries();
			const entry = entries.find((item) => item.filename === 'project.json');
			expect(entry).toBeDefined();
			const project = JSON.parse(await entry.getData(new TextWriter()));
			expect(project.title).toBe(title);
			expect(project.id).toBe(id);
		} finally { await reader.close(); }
		await expect(editor.locator('[data-project-name]')).toHaveText(title);
	} finally { await native.close(); }
});
