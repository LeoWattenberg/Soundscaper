/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

const text = '1\n00:00:00,100 --> 00:00:00,500\nA normal caption\n\n';

for (const cancelled of [false, true]) test(`Caption Tracks distinguishes a native ${cancelled ? 'cancelled' : 'completed'} sidecar save`, async ({ page }) => {
	const native = await installNativeCaptionSidecar(page, 'dialogue.srt', text, {
		saveName: 'captions.srt', cancelSave: cancelled,
	});
	try {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		await dialog.getByRole('button', { name: 'Choose sidecar file', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('dialogue.srt: No interchange losses.');
		const prior = await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue();
		await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
		await expect.poll(() => native.saveChoices.length).toBe(1);
		if (cancelled) await expect(native.savedBytes()).rejects.toThrow(/ENOENT/u);
		await expect(dialog.getByRole('status')).toHaveText(cancelled ? 'Caption export cancelled.' : '2 interchange losses recorded.');
		if (!cancelled) expect((await native.savedBytes()).toString('utf8')).toContain('A normal caption');
		expect(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue()).toBe(prior);
		await expect(dialog.getByRole('button', { name: 'Export selected track', exact: true })).toBeEnabled();
		await expect(dialog.getByRole('alert')).toHaveCount(0);
	} finally { await native.close(); }
});
