/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker,
	downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

for (const opacity of [100, 50]) {
	test(`cut-only picture delivery ${opacity === 100 ? 'retains the neutral report control' : 'reports the authored opacity it omits'}`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await importFiles(editor, [createDeterministicAvFixture('picture-interchange.webm')]);
		const clip = editor.getByRole('group', { name: /^Video clip:/u });
		await clip.focus();
		await clip.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Transform and compositing']);
		const composition = page.getByRole('dialog', { name: 'Transform and compositing', exact: true });
		await composition.getByRole('spinbutton', { name: 'Opacity (%)', exact: true }).fill(String(opacity));
		await composition.getByRole('button', { name: 'Apply', exact: true }).click();
		await composition.getByRole('button', { name: 'Close', exact: true }).click();
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
		const timeline = JSON.parse(Buffer.from(await downloadBytes(await downloading)).toString('utf8'));
		const clips = timeline.tracks.children.filter(track => track.kind === 'Video').flatMap(track => track.children)
			.filter(child => child.OTIO_SCHEMA === 'Clip.1');
		expect(clips).toHaveLength(1);
		expect(clips[0].effects ?? []).toEqual([]);
		await chooseCommandAction(page, editor, 'File', 'Delivery Report');
		const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		const warnings = report.locator('[data-severity="warning"]').filter({ hasText: /opacity/u });
		await expect(warnings).toHaveCount(opacity === 100 ? 0 : 1);
		await report.getByRole('button', { name: 'Close', exact: true }).last().click();
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Transform and compositing']);
		await expect(page.getByRole('dialog', { name: 'Transform and compositing', exact: true })
			.getByRole('spinbutton', { name: 'Opacity (%)', exact: true })).toHaveValue(String(opacity));
	});
}
