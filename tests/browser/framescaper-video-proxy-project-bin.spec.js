/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	collectClientErrors,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

test('Project Bin video menu lazily opens proxies for the clicked source', async ({ page }) => {
	test.setTimeout(120_000);
	await installPinnedFfmpegRuntimeRoutes(page);
	const clientErrors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles([
		createDeterministicAvFixture('project-bin-proxy-first.webm'),
		createDeterministicAvFixture('project-bin-proxy-second.webm'),
	]);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	const cards = editor.locator('[data-project-bin-item]');
	await expect(cards).toHaveCount(2);
	await expect.poll(() => loadedProxyDialogChunks(page)).toEqual([]);

	await cards.nth(1).getByRole('button', { name: /More file actions:/u }).click();
	const proxyMenuItem = page.getByRole('menuitem', { name: 'Video proxies…', exact: true });
	await expect(proxyMenuItem).toBeVisible();
	await proxyMenuItem.press('Enter');

	const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await expect(dialog).toBeVisible();
	const selectedSource = dialog.getByRole('combobox', { name: 'Video source', exact: true });
	await expect(selectedSource.locator('option:checked')).toContainText('project-bin-proxy-second.webm');
	await expect.poll(() => loadedProxyDialogChunks(page)).not.toEqual([]);
	await assertNoSeriousAxeViolations(page, '[data-video-proxy-dialog]');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(clientErrors).toEqual([]);
});

async function loadedProxyDialogChunks(page) {
	return page.evaluate(() => performance.getEntriesByType('resource')
		.map(({ name }) => name)
		.filter((name) => name.includes('FramescaperVideoProxyDialog')));
}
