import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	commitInput,
	importFiles,
	openEffectsForTrack,
	openParametricEqSelectionEffect,
	openRackPicker,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

async function pointerDrag(page, locator, delta, { cancel = false, modifier = null } = {}) {
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	if (modifier) await page.keyboard.down(modifier);
	try {
		await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 4 });
		if (cancel) await page.keyboard.press('Escape');
	} finally {
		if (modifier) await page.keyboard.up(modifier);
		await page.mouse.up();
	}
}

test.describe('Parametric EQ graph interactions', () => {
	registerAudioEditorHooks();

	test('paints input and output spectra during realtime rack playback', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const effectsPanel = await openEffectsForTrack(editor, 1);
		await openRackPicker(effectsPanel, 'track');
		const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
		await picker.getByRole('menuitem', { name: 'Parametric EQ', exact: true }).click();

		const eq = page.locator('[data-parametric-eq]');
		await expect(eq).toBeVisible();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		const pause = editor.getByRole('button', { name: 'Pause', exact: true });
		await expect(pause).toBeVisible();
		for (const [source, fill] of [
			['input', 'rgba(82, 155, 255, 0.18)'],
			['output', 'rgba(76, 222, 154, 0.22)'],
		]) {
			const canvas = eq.locator(`.audio-editor-parametric-eq__spectrum--${source}`);
			const expected = await canvas.evaluate((element, color) => {
				const probe = document.createElement('canvas');
				probe.width = probe.height = 1;
				const context = probe.getContext('2d');
				context.fillStyle = color;
				context.fillRect(0, 0, 1, 1);
				return [...context.getImageData(0, 0, 1, 1).data];
			}, fill);
			await expect.poll(async () => canvas.evaluate((element, rgba) => {
				const context = element.getContext('2d');
				const pixels = context.getImageData(0, 0, element.width, element.height).data;
				for (let offset = 0; offset < pixels.length; offset += 4) {
					if (rgba.every((value, index) => pixels[offset + index] === value)) return true;
				}
				return false;
			}, expected), { message: `${source} spectrum should paint its intended color during realtime playback` }).toBe(true);
		}
		await pause.click();
		expect(errors).toEqual([]);
	});

	test('edits bands through graph, keyboard, wheel, inspector, and reset controls', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');

		const dialog = await openParametricEqSelectionEffect(page, editor);
		const eq = dialog.locator('[data-parametric-eq]');
		const graph = eq.getByRole('application', { name: 'Parametric equalizer response', exact: true });
		const handles = eq.locator('.audio-editor-parametric-eq__handle');
		await expect(handles).toHaveCount(4);

		const inputSpectrum = eq.getByLabel('Input spectrum', { exact: true });
		const outputSpectrum = eq.getByLabel('Output spectrum', { exact: true });
		await inputSpectrum.uncheck();
		await outputSpectrum.uncheck();
		await expect(inputSpectrum).not.toBeChecked();
		await expect(outputSpectrum).not.toBeChecked();
		await inputSpectrum.check();
		await outputSpectrum.check();
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		const stopPreview = dialog.getByRole('button', { name: 'Stop preview', exact: true });
		await expect(stopPreview).toBeVisible();
		await page.evaluate(() => new Promise((resolve) => {
			const started = performance.now();
			const afterFrames = (time) => {
				if (time - started >= 80) resolve();
				else requestAnimationFrame(afterFrames);
			};
			requestAnimationFrame(afterFrames);
		}));
		await stopPreview.click();

		await graph.scrollIntoViewIfNeeded();
		const graphBox = await graph.boundingBox();
		expect(graphBox).not.toBeNull();
		await page.mouse.dblclick(
			graphBox.x + graphBox.width * 0.72,
			graphBox.y + graphBox.height * 0.25,
		);
		await expect(handles).toHaveCount(5);
		let selectedHandle = handles.nth(4);
		await expect(selectedHandle).toHaveAttribute('data-selected', 'true');

		const selectedBand = eq.getByRole('region', { name: 'Selected band', exact: true });
		const type = selectedBand.getByRole('combobox', { name: 'Type', exact: true });
		const enabled = selectedBand.getByLabel('Band enabled', { exact: true });
		await type.selectOption('highpass');
		await expect(selectedBand.getByLabel('Gain (dB)', { exact: true })).toHaveCount(0);
		await expect(selectedBand.getByLabel('Q', { exact: true })).toHaveCount(0);
		await selectedBand.getByRole('combobox', { name: 'Slope', exact: true }).selectOption('48');
		await enabled.uncheck();
		await expect(selectedHandle).toHaveAttribute('data-enabled', 'false');
		await type.selectOption('peaking');
		await enabled.check();

		const frequency = selectedBand.getByLabel('Frequency (Hz)', { exact: true });
		const gain = selectedBand.getByLabel('Gain (dB)', { exact: true });
		const q = selectedBand.getByLabel('Q', { exact: true });
		const frequencyBeforeKeys = Number(await frequency.inputValue());
		const gainBeforeKeys = Number(await gain.inputValue());
		await selectedHandle.focus();
		await page.keyboard.press('ArrowRight');
		await expect.poll(async () => Number(await frequency.inputValue())).toBeGreaterThan(frequencyBeforeKeys);
		await page.keyboard.press('Shift+ArrowUp');
		await expect.poll(async () => Number(await gain.inputValue())).toBeGreaterThan(gainBeforeKeys);

		const qBeforeWheel = Number(await q.inputValue());
		await selectedHandle.hover();
		await page.mouse.wheel(0, -120);
		await expect.poll(async () => Number(await q.inputValue())).toBeGreaterThan(qBeforeWheel);

		await type.selectOption('notch');
		const qBeforeNotchKey = Number(await q.inputValue());
		await selectedHandle.focus();
		await page.keyboard.press('ArrowUp');
		await expect.poll(async () => Number(await q.inputValue())).toBeGreaterThan(qBeforeNotchKey);
		await type.selectOption('peaking');

		const frequencyBeforeDrag = Number(await frequency.inputValue());
		const gainBeforeDrag = Number(await gain.inputValue());
		await pointerDrag(page, selectedHandle, { x: 34, y: -24 });
		await expect.poll(async () => Number(await frequency.inputValue())).not.toBe(frequencyBeforeDrag);
		await expect.poll(async () => Number(await gain.inputValue())).not.toBe(gainBeforeDrag);

		const frequencyBeforeFineDrag = Number(await frequency.inputValue());
		await pointerDrag(page, selectedHandle, { x: 28, y: 18 }, { modifier: 'Shift' });
		await expect.poll(async () => Number(await frequency.inputValue())).not.toBe(frequencyBeforeFineDrag);

		const qBeforeDrag = Number(await q.inputValue());
		await pointerDrag(page, selectedHandle, { x: 0, y: -36 }, { modifier: 'Alt' });
		await expect.poll(async () => Number(await q.inputValue())).toBeGreaterThan(qBeforeDrag);

		const frequencyBeforeCancel = Number(await frequency.inputValue());
		const gainBeforeCancel = Number(await gain.inputValue());
		await pointerDrag(page, selectedHandle, { x: -50, y: 30 }, { cancel: true });
		await expect(dialog).toBeVisible();
		await expect.poll(async () => Number(await frequency.inputValue())).toBe(frequencyBeforeCancel);
		await expect.poll(async () => Number(await gain.inputValue())).toBe(gainBeforeCancel);

		await selectedBand.getByRole('button', { name: 'Audition', exact: true }).click();
		await expect(selectedBand.getByRole('button', { name: 'Stop audition', exact: true })).toBeVisible();
		await selectedBand.getByRole('button', { name: 'Stop audition', exact: true }).click();
		await selectedBand.getByRole('button', { name: 'Audition', exact: true }).click();
		await eq.getByRole('button', { name: 'Delete band', exact: true }).click();
		await expect(handles).toHaveCount(4);
		await expect(selectedBand.getByRole('button', { name: 'Audition', exact: true })).toBeVisible();

		await eq.getByRole('button', { name: 'Add band', exact: true }).click();
		await expect(handles).toHaveCount(5);
		selectedHandle = handles.nth(4);
		await commitInput(selectedBand.getByLabel('Gain (dB)', { exact: true }), '7.5');
		await commitInput(selectedBand.getByLabel('Q', { exact: true }), '2.5');
		await selectedBand.getByLabel('Band enabled', { exact: true }).uncheck();

		const output = eq.locator('.audio-editor-parametric-eq__output');
		const outputRange = output.locator('input[type="range"]');
		const outputNumber = output.locator('input[type="number"]');
		await outputRange.focus();
		await page.keyboard.press('ArrowRight');
		await expect.poll(async () => Number(await outputNumber.inputValue())).toBeGreaterThan(0);

		await eq.getByRole('button', { name: 'Reset', exact: true }).click();
		await expect(outputNumber).toHaveValue('0');
		await expect(selectedBand.getByLabel('Gain (dB)', { exact: true })).toHaveValue('0');
		await expect(selectedBand.getByLabel('Q', { exact: true })).toHaveValue('1');
		await expect(selectedBand.getByLabel('Band enabled', { exact: true })).toBeChecked();

		await selectedHandle.focus();
		await page.keyboard.press('Backspace');
		await expect(handles).toHaveCount(4);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		expect(errors).toEqual([]);
	});
});
