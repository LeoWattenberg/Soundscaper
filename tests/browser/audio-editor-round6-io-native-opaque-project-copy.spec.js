/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

let archive;
let originalId;
test.beforeAll(async ({ browser }) => {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await disableNativeSavePicker(page);
		const soundscaper = await bootEditor(page, '/embed/en/');
		await importFiles(soundscaper, [toneA]);
		originalId = await soundscaper.getAttribute('data-project-id');
		const exporting = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, soundscaper);
		archive = await readFile(await (await exporting).path());
	} finally { await context.close(); }
});

for (const desktop of [false, true]) {
	test(`Framescaper saves an unchanged ordinary Soundscaper project from the ${desktop ? 'native' : 'browser'} picker`, async ({ page: recipient }) => {
		await disableNativeSavePicker(recipient);
		const native = desktop ? await installNativeCaptionSidecar(recipient, 'ordinary.sscape', archive, { saveName: 'copy.fscape' }) : null;
		try {
			const framescaper = await bootEditor(recipient, '/framescaper/embed/en/');
			if (native) await chooseFileAction(recipient, framescaper, 'Open');
			else await framescaper.locator('[data-aup4-input]').setInputFiles({
				name: 'ordinary.sscape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: archive,
			});
			await expect(framescaper).toHaveAttribute('data-project-id', originalId);
			await expect(framescaper).toHaveAttribute('data-edit-block-reason', 'read-only');
			if (native) await expect.poll(() => native.releases.length).toBe(1);
			const copying = native ? null : recipient.waitForEvent('download');
			await chooseExportProjectFileAction(recipient, framescaper);
			if (native) await expect.poll(async () => await native.savedBytes().catch(() => null)).toEqual(archive);
			else {
				const copied = await copying;
				expect(copied.suggestedFilename()).toMatch(/\.fscape$/u);
				expect(await readFile(await copied.path())).toEqual(archive);
			}
		} finally { await native?.close(); }
	});
}
