/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties, resolveBrowserProductTestUrl, waitForEditor } from './audio-editor-test-helpers.js';

test('a read-only tab can audition its recording through Clip properties', async ({ page, context }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'source-audition.wav', frequency: 750, duration: 5, channelCount: 1 })]);
	const properties = await openClipProperties(page, editor, clipByName(editor, 'source-audition.wav'));
	const source = properties.locator('[data-clip-source-editor]');
	await expect(source.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront();
		const play = source.getByRole('button', { name: 'Play', exact: true });
		await expect(play).toBeEnabled();
		await expect(source.getByRole('button', { name: 'Trim source start', exact: true })).toBeDisabled();
		await play.click();
		await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await source.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(source.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	} finally { await other.close(); }
});
