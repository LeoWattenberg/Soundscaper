/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

test('DAWproject delivers an ordinary loop extension as repeated content at its original speed', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const archive = await readDawprojectArchive(new Blob([await downloadBytes(await downloading)]));
	try {
		const delivered = /<Clip\b[^>]*>/u.exec(archive.projectXml)?.[0];
		expect(delivered).toMatch(/\bloopStart="0"/u);
		expect(delivered).toMatch(/\bloopEnd="0\.8"/u);
		expect(delivered).toMatch(/\bduration="1\.6"/u);
		expect(archive.projectXml).not.toContain('<Warps');
	} finally { await archive.close(); }
});
