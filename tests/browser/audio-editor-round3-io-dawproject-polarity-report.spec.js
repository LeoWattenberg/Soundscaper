/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties,
} from './audio-editor-test-helpers.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

test('DAWproject reports the authored polarity inversion it cannot retain', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
	await properties.getByText('Media settings', { exact: true }).click();
	await properties.getByRole('checkbox', { name: 'Invert', exact: true }).check();
	await closeClipProperties(properties);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const archive = await readDawprojectArchive(new Blob([await downloadBytes(await downloading)]));
	try { expect(archive.projectXml).toContain('<Audio'); } finally { await archive.close(); }
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-delivery-report]')).toContainText('inverted');
	await expect(report.locator('[data-severity="warning"]')).toContainText('without');
});
