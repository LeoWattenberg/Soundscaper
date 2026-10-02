/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createWavFixture,
	expect,
	readFile,
	test,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	closeClipProperties, closeDialog,
	collectClientErrors,
	commitInput,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('analysis and Nyquist dialog coverage', () => {
	registerAudioEditorHooks();

	test('opens the populated delivery report after measuring loudness', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({
			name: 'loudness-measurement.wav', frequency: 440, duration: 0.08, channelCount: 1,
		})]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');

		await chooseCommandAction(page, editor, 'Analyze', 'Measure loudness');
		const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report).toBeVisible({ timeout: 20_000 });
		await expect(report.locator('[data-delivery-report]')).toContainText('loudness-measurement');
		await expect(report.locator('[data-delivery-report]')).toContainText(/The selection was measured;/u);
		expect(errors).toEqual([]);
	});

	test('runs, presents, and exports every interactive analysis report', async ({ page }) => {
		test.setTimeout(120_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const fixture = clippedTone();
		await importFiles(editor, [fixture]);
		const properties = await openClipProperties(page, editor, clipByName(editor, fixture.name));
		await properties.getByText('Normalize', { exact: true }).click();
		await commitInput(properties.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true }), '24');
		await closeClipProperties(properties);
		await chooseCommandAction(page, editor, 'Select', 'Select all');

		const analysis = await openAnalysis(page, editor, 'Analyze selection', 'levels');
		await expect(analysis.locator('[data-analysis-value="peak"]')).not.toHaveText('−∞ dBFS', {
			timeout: 20_000,
		});
		await expect(analysis.locator('[data-analysis-scope]')).toHaveAttribute('data-analysis-scope', 'master', {
			timeout: 20_000,
		});
		await exportReport(page, analysis, /analysis\.json$/u);
		await closeDialog(analysis);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
		await chooseCommandAction(page, editor, 'Analyze', 'Repeat last analyzer');
		const repeated = page.getByRole('dialog', { name: 'Analyze selection', exact: true });
		await expect(repeated).toHaveAttribute('data-analysis-repeat', 'true');
		await expect(repeated.locator('[data-analysis-value="peak"]')).not.toHaveText('−∞ dBFS', {
			timeout: 20_000,
		});
		await closeDialog(repeated);

		const spectrum = await openAnalysis(page, editor, 'Plot spectrum', 'spectrum');
		const spectrumReport = spectrum.locator('[data-analysis-report="spectrum"]');
		await expect(spectrumReport).toBeVisible({ timeout: 20_000 });
		await expect(spectrumReport).toContainText('Hz');
		await expect(spectrum.locator('[data-analysis-value]')).toHaveCount(0);
		await exportReport(page, spectrum, /analysis\.json$/u);
		await closeDialog(spectrum);

		const clipping = await openAnalysis(page, editor, 'Find clipping', 'clipping');
		const clippingReport = clipping.locator('[data-analysis-report="clipping"]');
		await expect(clippingReport).toBeVisible({ timeout: 20_000 });
		await expect(clippingReport.getByRole('listitem')).not.toHaveCount(0);
		await expect(clipping.locator('[data-analysis-value]')).toHaveCount(0);
		await exportReport(page, clipping, /analysis\.json$/u);
		await closeDialog(clipping);

		await selectTimelineRange(page, editor, 35, 145);
		const contrast = await openAnalysis(page, editor, 'Contrast', 'contrast');
		await contrast.getByRole('button', { name: 'Measure foreground', exact: true }).click();
		await expect(contrast.locator('[data-analysis-report="contrast"]')).toBeVisible({ timeout: 20_000 });
		await contrast.getByRole('button', { name: 'Measure background', exact: true }).click();
		const contrastReport = contrast.locator('[data-analysis-report="contrast"]');
		await expect(contrastReport).toContainText('Difference', { timeout: 20_000 });
		await expect(contrastReport.getByRole('status')).toBeVisible();
		await expect(contrast.locator('[data-analysis-value]')).toHaveCount(0);
		await exportReport(page, contrast, /analysis\.json$/u);
		await closeDialog(contrast);

		expect(errors).toEqual([]);
	});

	test('uses prompt and bundled Nyquist controls, preview, output, and reset', async ({ page }) => {
		test.setTimeout(150_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({
			name: 'nyquist-dialog-coverage.wav', frequency: 440, duration: 0.08, channelCount: 1,
		})]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');

		await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
		let dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
		await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('sal');
		await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('lisp');
		await dialog.getByRole('checkbox', { name: 'Show debug output', exact: true }).check();
		await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('42');
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('42', {
			timeout: 20_000,
		});
		const stopPreview = dialog.getByRole('button', { name: 'Stop preview', exact: true });
		if (await stopPreview.isVisible()) await stopPreview.click();
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		await expect(dialog.getByRole('checkbox', { name: 'Show debug output', exact: true })).not.toBeChecked();
		await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('"coverage message"');
		await dialog.getByRole('button', { name: 'Run', exact: true }).click();
		await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('coverage message', {
			timeout: 20_000,
		});
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

		await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Rhythm Track']);
		dialog = page.getByRole('dialog', { name: 'Rhythm Track', exact: true });
		await expect(dialog).toContainText("Set 'Number of bars' to zero");
		await dialog.getByRole('spinbutton', { name: /^Tempo \(bpm\)/u }).fill('300');
		await dialog.getByRole('spinbutton', { name: /^Number of bars/u }).fill('1');
		await dialog.getByRole('combobox', { name: 'Beat sound', exact: true }).selectOption({ label: 'Ping (short)' });
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText(/frames, \d+ channel/u, {
			timeout: 30_000,
		});
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

		await chooseNestedCommandAction(page, editor, 'Analyze', ['Nyquist', 'Label Sounds']);
		dialog = page.getByRole('dialog', { name: 'Label Sounds', exact: true });
		await dialog.getByRole('textbox', { name: 'Label text', exact: true }).fill('Coverage label');
		await dialog.getByRole('combobox', { name: 'Label type', exact: true }).selectOption({ label: 'Point before sound' });
		await dialog.getByRole('spinbutton', { name: 'Minimum silence duration', exact: true }).fill('0.01');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText(/label\(s\)/u, {
			timeout: 30_000,
		});
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

		expect(errors).toEqual([]);
	});
});

function clippedTone() {
	const sampleRate = 48_000;
	const frameCount = 4_800;
	const buffer = Buffer.alloc(44 + frameCount * 4);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(buffer.length - 8, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(3, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * 4, 28);
	buffer.writeUInt16LE(4, 32);
	buffer.writeUInt16LE(32, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(frameCount * 4, 40);
	for (let frame = 0; frame < frameCount; frame += 1) {
		const sample = frame < 8 ? 1.25 : Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.25;
		buffer.writeFloatLE(sample, 44 + frame * 4);
	}
	return { name: 'analysis-clipped.wav', mimeType: 'audio/wav', buffer };
}

async function openAnalysis(page, editor, command, mode) {
	await chooseCommandAction(page, editor, 'Analyze', command);
	const dialog = page.getByRole('dialog', { name: command, exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('data-analysis-mode', mode);
	return dialog;
}

async function exportReport(page, panel, fileName) {
	const downloadPromise = page.waitForEvent('download');
	await panel.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(fileName);
	const path = await download.path();
	expect(path).not.toBeNull();
	expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1);
}

async function selectTimelineRange(page, editor, start, end) {
	const ruler = editor.locator('[data-ruler-interaction]');
	const box = await ruler.boundingBox();
	expect(box).not.toBeNull();
	const y = box.y + box.height * 0.8;
	await page.mouse.move(box.x + start, y);
	await page.mouse.down();
	await page.mouse.move(box.x + end, y, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).not.toHaveCount(0);
}
