/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCustomChannelMapping,
	chooseDropdown,
	clipByName,
	closeDialog,
	collectClientErrors,
	commitInput,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	openClipProperties,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('inspector helper workflows', () => {
	registerAudioEditorHooks();

	test('rejects and commits clip gain and pitch through Clip properties', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));

		const gain = properties.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true });
		await commitInput(gain, '25');
		await expect(properties.getByRole('alert')).toHaveText('Invalid gain value.');
		await commitInput(gain, '-6');
		await expect(properties.getByRole('alert')).toHaveCount(0);
		await expect(gain).toHaveValue('-6.00');

		let pitch = properties.getByRole('spinbutton', {
			name: 'Pitch (semitones, −12 to +12)', exact: true,
		});
		await commitInput(pitch, '13');
		await expect(properties.getByRole('alert')).toHaveText(
			'Clip pitch must be between −12 and +12 semitones.',
		);
		await commitInput(pitch, '1.25');
		await expect(properties.getByRole('alert')).toHaveCount(0);
		await expect(pitch).toHaveValue('1.25');

		await chooseDropdown(page, properties.locator('[data-clip-pitch-unit]'), 'Percent change');
		pitch = properties.getByRole('spinbutton', {
			name: 'Pitch (percent, −50 to +100)', exact: true,
		});
		await expect(pitch).toHaveValue('7.487');
		await commitInput(pitch, '10');
		await expect(properties.getByRole('alert')).toHaveCount(0);
		await expect(pitch).toHaveValue('10.000');

		await closeDialog(properties);
		expect(errors).toEqual([]);
	});

	test('validates imported channel mappings and metadata before downloading a WAV', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		let downloads = 0;
		page.on('download', () => { downloads += 1; });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const dialog = await openExportDialog(page, editor);

		await importDeliveryPreset(page, dialog, {
			id: 'coverage-missing-matrix',
			label: 'Missing matrix',
			channelMapping: 'custom',
		});
		await chooseDeliveryPreset(page, dialog, 'Missing matrix (custom)');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(dialog.getByRole('alert')).toHaveText(
			'Custom channel mapping requires a JSON channel matrix.',
		);

		await importDeliveryPreset(page, dialog, {
			id: 'coverage-wrong-matrix-shape',
			label: 'Wrong matrix shape',
			channelMapping: { channel: 1 },
		});
		await chooseDeliveryPreset(page, dialog, 'Wrong matrix shape (custom)');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(page.getByText(
			/custom channel mapping .*?(?:channels array|output channels)/iu,
		)).toBeVisible();

		await chooseCustomChannelMapping(page, dialog, {
			outputs: 1,
			routes: (input) => input === 0,
		});
		await setAdditionalMetadata(page, dialog, '{');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(dialog.getByRole('alert')).toHaveText(
			'Additional metadata (JSON) must be valid JSON.',
		);
		await setAdditionalMetadata(page, dialog, '[]');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(dialog.getByRole('alert')).toHaveText(
			'Additional metadata (JSON) must be a JSON object.',
		);
		expect(downloads).toBe(0);

		await setAdditionalMetadata(page, dialog, '{"producer":"Ada","session":7}');
		const started = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = await started;
		expect(download.suggestedFilename()).toMatch(/\.wav$/u);
		const bytes = await downloadBytes(download);
		expect(new TextDecoder('latin1').decode(bytes.subarray(0, 4))).toBe('RIFF');
		expect(downloads).toBe(1);
		expect(errors).toEqual([]);
	});
});

async function importDeliveryPreset(page, dialog, { id, label, channelMapping }) {
	const chooserPromise = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	const chooser = await chooserPromise;
	await chooser.setFiles({
		name: `${id}.json`,
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify({
			schemaVersion: 1,
			presets: [{
				schemaVersion: 1,
				id,
				label,
				kind: 'audio',
				format: 'wav',
				settings: { channelMapping },
				licensingRowId: null,
				fallbackPresetId: null,
			}],
		})),
	});
}

async function chooseDeliveryPreset(page, dialog, name) {
	const trigger = dialog.getByRole('button', { name: 'Preset', exact: true });
	await trigger.click();
	await page.getByRole('option', { name, exact: true }).click();
	await expect(trigger).toContainText(name);
}

async function setAdditionalMetadata(page, exportDialog, value) {
	await exportDialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadata = page.getByRole('dialog', { name: 'Metadata', exact: true });
	await expect(metadata).toBeVisible();
	const details = metadata.locator('details').filter({ hasText: 'Additional metadata (JSON)' });
	if (await details.getAttribute('open') === null) await details.locator('summary').click();
	await details.getByRole('textbox', { name: 'Additional metadata (JSON)', exact: true }).fill(value);
	await metadata.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(exportDialog).toBeVisible();
}
