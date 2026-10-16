/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { openFramescaperSourcePropertiesFromBin } from './helpers/framescaper-source-properties.js';

test('keyboard Re-read source keeps its Source properties action focused after the ordinary read completes', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	const video = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
	await editor.locator('[data-project-bin-input]').setInputFiles([video.file]);
	const name = video.file.name.replace(/\.[^.]+$/u, '');
	await expect(editor.getByRole('button', { name: `More file actions: ${name}`, exact: true })).toBeVisible();
	const properties = await openFramescaperSourcePropertiesFromBin(page, editor, name);
	const reread = properties.getByRole('button', { name: 'Re-read source', exact: true });
	await reread.focus();
	await reread.press('Enter');
	await expect(properties.locator('[data-source-reprobe-outcome]')).toHaveAttribute(
		'data-source-reprobe-outcome', 'unchanged', { timeout: 60_000 });
	await expect(reread).toBeFocused();
	await reread.press('Enter');
	await expect(reread).toBeEnabled({ timeout: 60_000 });
	await expect(reread).toBeFocused();
});
