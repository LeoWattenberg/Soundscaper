import {
	expect,
	longTone,
	test,
} from './audio-editor-test-fixtures.js';
import {
	addRackEffect,
	bootEditor,
	chooseDropdown,
	chooseNestedCommandAction,
	closeDialog,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio I/O signal routing', () => {
	registerAudioEditorHooks();

	test('renders matching signal through group and send buses with a realtime effect', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const mixer = editor.locator('[data-mixer-panel]');
		await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
		await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();

		const output = mixer.getByRole('combobox', { name: /^Output:/u }).last();
		await output.selectOption({ label: 'Group bus 1' });
		const sendLevel = mixer.getByRole('slider', { name: /^Send level:/u }).last();
		await sendLevel.press('End');
		for (let step = 0; step < 12; step += 1) await sendLevel.press('ArrowDown');
		await expect(sendLevel).toHaveAttribute('aria-valuenow', '0');

		await mixer.locator('.kw-audio-editor__mixer-channel--group .mixer-effect--empty .mixer-effect__dropdown')
			.first().click();
		const effectsPanel = page.locator('.audio-editor-effects-overlay');
		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		const invert = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert', exact: true });
		await expect(invert).toBeVisible();

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => {
			const [group, send, master] = await Promise.all([
				mixerSignalLevel(mixer, 'group'),
				mixerSignalLevel(mixer, 'send'),
				mixerSignalLevel(mixer, 'master'),
			]);
			return group > 20 && send > 20 && master < 1;
		}, { message: 'realtime group and send buses should carry signal while Invert cancels the master' }).toBe(true);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		const cancelledPeak = await exportWavPeak(page, editor);
		await invert.getByRole('button', { name: 'Disable effect', exact: true }).click();
		const dryPeak = await exportWavPeak(page, editor);
		expect(cancelledPeak).toBeLessThan(0.001);
		expect(dryPeak).toBeGreaterThan(0.25);
		expect(dryPeak).toBeGreaterThan(cancelledPeak * 100);
		expect(errors).toEqual([]);
	});
});

async function mixerSignalLevel(mixer, scope) {
	const fill = mixer.locator(`.kw-audio-editor__mixer-channel--${scope} .mixer-channel__meter-fill`).first();
	const top = Number.parseFloat((await fill.getAttribute('style'))?.match(/top:\s*([\d.]+)%/u)?.[1] ?? '100');
	return 100 - top;
}

async function exportWavPeak(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const downloadPromise = page.waitForEvent('download');
	await link.click();
	const peak = wavPeak(await downloadBytes(await downloadPromise));
	await closeDialog(dialog);
	return peak;
}

function wavPeak(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const id = new TextDecoder('ascii').decode(bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		if (id === 'data') {
			let maximum = 0;
			for (let sample = offset + 8; sample + 2 < offset + 8 + size; sample += 3) {
				let value = bytes[sample] | (bytes[sample + 1] << 8) | (bytes[sample + 2] << 16);
				if (value & 0x800000) value |= 0xff000000;
				maximum = Math.max(maximum, Math.abs(value / 0x800000));
			}
			return maximum;
		}
		offset += 8 + size + (size & 1);
	}
	return 0;
}
