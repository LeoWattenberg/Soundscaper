/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { chooseClipMediaSetting, expectClipGain, setClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { bootEditor, clipByName, closeDialog, disableNativeSavePicker, importFiles, openClipProperties, openExportDialog } from './audio-editor-test-helpers.js';

test('a later explicit clip gain edit survives an in-progress normalization', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const recording = createWavFixture({ name: 'long-room-tone.wav', frequency: 440,
		duration: 30, channelCount: 1, channelAmplitudes: [0.1] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await holdNextNativeRender(page);
	try {
		await chooseClipMediaSetting(properties, 'Normalize to −1 dBFS');
		await expect.poll(() => page.evaluate(() => window.__round5NormalizationRenderPending === true)).toBe(true);
		await setClipGain(properties, -6);
		await expectClipGain(properties, -6);
		await page.evaluate(() => window.__round5ReleaseNormalizationRender());
		const exporting = await openExportDialog(page, editor);
		await exporting.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(exporting.locator('[data-export-download]')).toBeVisible({ timeout: 30_000 });
		await closeDialog(exporting);
		await expectClipGain(properties, -6);
	} finally {
		await page.evaluate(() => window.__round5ReleaseNormalizationRender?.());
	}
});

// Hold the first real browser render's result while the user edits through the
// menu. The race remains explicit even when native rendering finishes quickly.
async function holdNextNativeRender(page) {
	await page.evaluate(() => {
		const prototype = OfflineAudioContext.prototype;
		const startRendering = prototype.startRendering;
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		window.__round5ReleaseNormalizationRender = () => { release(); prototype.startRendering = startRendering; };
		prototype.startRendering = function (...args) {
			prototype.startRendering = startRendering;
			window.__round5NormalizationRenderPending = true;
			return startRendering.apply(this, args).then(async buffer => { await gate; return buffer; });
		};
	});
}
