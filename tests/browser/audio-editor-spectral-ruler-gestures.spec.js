import { createWavFixture, expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

const spectralTone = createWavFixture({ name: 'spectral-center-tone.wav', frequency: 512, sampleRate: 8_192, duration: 4, channelCount: 1 });

test('Ctrl and Meta wheel on a waveform ruler change only vertical zoom', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	const track = clipByName(editor, longTone.name).locator('xpath=ancestor::div[@data-track-row]');
	const ruler = track.locator('[data-track-ruler]');
	const waveform = clipByName(editor, longTone.name).locator('canvas.clip-body__waveform');
	await expect(waveform).toHaveAttribute('data-waveform-owner', 'audacity');
	const waveformBefore = await waveformChecksum(waveform);
	const horizontalScale = await editor.locator('[data-timeline]').evaluate(element => element.scrollWidth);
	await ruler.hover();
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, -120);
	await page.keyboard.up('Control');
	await expect(ruler).toHaveAttribute('data-ruler-zoom', '1');
	await expect.poll(() => waveformChecksum(waveform)).not.toBe(waveformBefore);
	await page.keyboard.down('Meta');
	await page.mouse.wheel(0, 120);
	await page.keyboard.up('Meta');
	await expect(ruler).toHaveAttribute('data-ruler-zoom', '0');
	expect(await editor.locator('[data-timeline]').evaluate(element => element.scrollWidth)).toBe(horizontalScale);
	expect(errors).toEqual([]);
});

test('spectral center drag snaps to selected audio and keeps bandwidth; the menu accepts an exact center', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [spectralTone]);
	const track = clipByName(editor, spectralTone.name).locator('xpath=ancestor::div[@data-track-row]');
	await setSpectrogramPreferences(page, editor);
	await track.getByRole('button', { name: 'Track menu', exact: true }).click();
	const display = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Display(?:\s|$)/u });
	await display.focus();
	await page.keyboard.press('ArrowRight');
	await display.getByRole('menu').getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
	await expect(track).toHaveAttribute('data-display-mode', 'spectrogram');
	const clip = clipByName(editor, spectralTone.name);
	await clip.focus();
	await page.keyboard.press('Control+a');
	await openSpectralDialog(page, editor);
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill('100');
	await dialog.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill('300');
	await dialog.getByRole('button', { name: 'Select range', exact: true }).click();
	const center = track.getByRole('slider', { name: 'Spectral selection center-frequency handle', exact: true });
	const minimum = track.getByRole('slider', { name: 'Spectral selection minimum-frequency handle', exact: true });
	const maximum = track.getByRole('slider', { name: 'Spectral selection maximum-frequency handle', exact: true });
	const centerBox = await center.boundingBox();
	const laneBox = await track.locator('[data-track-lane]').boundingBox();
	const bodyTop = Number(await track.locator('[data-track-lane]').getAttribute('data-channel-body-top'));
	await page.mouse.move(centerBox.x + centerBox.width / 2, centerBox.y + centerBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(centerBox.x + centerBox.width / 2, laneBox.y + bodyTop + (laneBox.height - bodyTop) * 0.6, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => Number(await center.getAttribute('aria-valuenow'))).toBeCloseTo(512, 0);
	expect(Number(await maximum.getAttribute('aria-valuenow')) - Number(await minimum.getAttribute('aria-valuenow'))).toBeCloseTo(200, 5);
	await center.focus();
	await page.keyboard.press('ArrowUp');
	await expect.poll(async () => Number(await center.getAttribute('aria-valuenow'))).toBeCloseTo(522, 0);
	await openSpectralDialog(page, editor);
	const centerField = dialog.getByRole('textbox', { name: /^Center frequency \(Hz\)/u });
	await centerField.fill('');
	await centerField.pressSequentially('1000');
	await expect(centerField).toHaveValue('1000');
	await dialog.getByRole('button', { name: 'Select range', exact: true }).click();
	await expect.poll(async () => Number(await center.getAttribute('aria-valuenow'))).toBeCloseTo(1_000, 0);
	expect(Number(await maximum.getAttribute('aria-valuenow')) - Number(await minimum.getAttribute('aria-valuenow'))).toBeCloseTo(200, 5);
	const ruler = track.locator('[data-track-ruler]');
	const horizontalWidth = await editor.locator('[data-timeline]').evaluate(element => element.scrollWidth);
	const rangeBefore = Number(await ruler.getAttribute('data-ruler-frequency-maximum')) - Number(await ruler.getAttribute('data-ruler-frequency-minimum'));
	const rulerBox = await ruler.boundingBox();
	const topFraction = (40 - bodyTop) / (rulerBox.height - bodyTop);
	const pointedFrequency = Number(await ruler.getAttribute('data-ruler-frequency-maximum')) - rangeBefore * topFraction;
	await ruler.hover({ position: { x: 10, y: 40 } });
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, -120);
	await page.keyboard.up('Control');
	await expect.poll(async () => Number(await ruler.getAttribute('data-ruler-frequency-maximum')) - Number(await ruler.getAttribute('data-ruler-frequency-minimum'))).toBeLessThan(rangeBefore);
	const zoomedMinimum = Number(await ruler.getAttribute('data-ruler-frequency-minimum'));
	const zoomedMaximum = Number(await ruler.getAttribute('data-ruler-frequency-maximum'));
	expect(zoomedMaximum - (zoomedMaximum - zoomedMinimum) * topFraction).toBeCloseTo(pointedFrequency, 3);
	await page.mouse.wheel(0, 120);
	await expect.poll(async () => Number(await ruler.getAttribute('data-ruler-frequency-minimum'))).toBeGreaterThan(zoomedMinimum);
	expect(Number(await ruler.getAttribute('data-ruler-frequency-maximum')) - Number(await ruler.getAttribute('data-ruler-frequency-minimum'))).toBeCloseTo(zoomedMaximum - zoomedMinimum, 3);
	expect(await editor.locator('[data-timeline]').evaluate(element => element.scrollWidth)).toBe(horizontalWidth);
	expect(errors).toEqual([]);
});

async function waveformChecksum(waveform) {
	return waveform.evaluate(canvas => {
		const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
		let checksum = 2_166_136_261;
		for (const value of data) checksum = Math.imul(checksum ^ value, 16_777_619) >>> 0;
		return checksum;
	});
}

async function openSpectralDialog(page, editor) {
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
}

async function setSpectrogramPreferences(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const settings = preferences.locator('[data-spectrogram-settings]');
	await settings.getByLabel('Scale', { exact: true }).selectOption('linear');
	await settings.getByLabel('Minimum frequency (Hz)', { exact: true }).fill('0');
	await settings.getByLabel('Maximum frequency (Hz)', { exact: true }).fill('2000');
	await settings.getByLabel('Window size', { exact: true }).selectOption('2048');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
}
