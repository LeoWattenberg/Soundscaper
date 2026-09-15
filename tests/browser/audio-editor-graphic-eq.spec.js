import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	clipByName, closeDialog, collectClientErrors, effectSourcePeak, importFiles,
	openEffectsForTrack, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

const tone = createWavFixture({ name: 'graphic-eq-1khz.wav', frequency: 1000, duration: 1 });
const frequencies = [20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
	800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

async function bandAt(dialog, frequency, gain) {
	const slider = dialog.getByRole('slider', { name: `${frequency} Hz`, exact: true });
	await slider.scrollIntoViewIfNeeded();
	const box = await slider.boundingBox();
	expect(box).not.toBeNull();
	return { x: box.x + box.width / 2, y: box.y + (20 - gain) / 40 * box.height };
}

async function sweep(page, start, finish, steps = 1) {
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(finish.x, finish.y, { steps });
	await page.mouse.up();
}

test.describe('Audacity Graphic EQ fader bank', () => {
	registerAudioEditorHooks();

	test('aligns all mixer faders with their bands and paints across them with cancellation and reset', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [tone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Graphic EQ']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await expect(dialog.getByRole('slider')).toHaveCount(31);
		for (const frequency of frequencies) {
			const slider = dialog.getByRole('slider', { name: `${frequency} Hz`, exact: true });
			await expect(slider).toHaveAttribute('aria-orientation', 'vertical');
			const alignment = await slider.evaluate((element) => {
				const label = element.parentElement.querySelector('span').getBoundingClientRect();
				const fader = element.getBoundingClientRect();
				return { offset: Math.abs(label.x + label.width / 2 - fader.x - fader.width / 2), mixer: element.classList.contains('mixer-fader') };
			});
			expect(alignment.mixer).toBe(true);
			expect(alignment.offset).toBeLessThan(1);
		}
		const at20 = await bandAt(dialog, 20, 10);
		const at50 = await bandAt(dialog, 50, -10);
		await sweep(page, at20, at50);
		for (const [index, frequency] of frequencies.slice(0, 5).entries()) {
			await expect(dialog.getByRole('slider', { name: `${frequency} Hz`, exact: true })).toHaveAttribute('aria-valuenow', String(10 - index * 5));
		}
		await expect(dialog.getByRole('slider', { name: '63 Hz', exact: true })).toHaveAttribute('aria-valuenow', '0');
		await page.mouse.move(at20.x, at20.y); await page.mouse.down();
		await page.mouse.move(at50.x, at20.y);
		await page.keyboard.press('Escape'); await page.mouse.up();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('slider', { name: '50 Hz', exact: true })).toHaveAttribute('aria-valuenow', '-10');
		await page.mouse.move(at20.x + 16, at20.y); await page.mouse.down();
		await page.mouse.move(at50.x, at20.y);
		await page.keyboard.press('Escape'); await page.mouse.up();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('slider', { name: '50 Hz', exact: true })).toHaveAttribute('aria-valuenow', '-10');
		await page.mouse.dblclick(at50.x, at50.y);
		await expect(dialog.getByRole('slider', { name: '50 Hz', exact: true })).toHaveAttribute('aria-valuenow', '0');
		await dialog.getByRole('button', { name: 'Invert', exact: true }).click();
		await expect(dialog.getByRole('slider', { name: '20 Hz', exact: true })).toHaveAttribute('aria-valuenow', '-10');
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		const oneKhz = dialog.getByRole('slider', { name: '1000 Hz', exact: true });
		await oneKhz.focus(); await page.keyboard.press('ArrowUp');
		await expect(oneKhz).toHaveAttribute('aria-valuenow', '1');
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		const at1k = await bandAt(dialog, 1000, 6);
		await page.mouse.click(at1k.x, at1k.y);
		await expect(oneKhz).toHaveAttribute('aria-valuenow', '6');
		await expect(dialog.getByRole('slider', { name: '800 Hz', exact: true })).toHaveAttribute('aria-valuenow', '0');
		await expect(dialog.getByRole('slider', { name: '1250 Hz', exact: true })).toHaveAttribute('aria-valuenow', '0');
		await dialog.getByRole('button', { name: 'Interpolation', exact: true }).click();
		await page.getByRole('option', { name: 'Cosine', exact: true }).click();
		await dialog.screenshot({ path: 'test-results/graphic-eq-dialog.png' });
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		// Audacity's sampled cosine envelope gives 5.917160393252566 dB at
		// 1 kHz for this +6 dB band, before the Blackman FIR window.
		await expect.poll(() => effectSourcePeak(page, 'Graphic EQ')).toBeCloseTo(0.35 * 10 ** (5.917160393252566 / 20), 3);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, tone.name)).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('persists every painted rack band and cancels a later sweep', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [tone]);
		let panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Graphic EQ');
		let dialog = page.getByRole('dialog', { name: 'Graphic EQ', exact: true });
		const start = await bandAt(dialog, 800, -6);
		const finish = await bandAt(dialog, 1600, -6);
		await sweep(page, start, finish);
		for (const frequency of [800, 1000, 1250, 1600]) {
			await expect(dialog.getByRole('slider', { name: `${frequency} Hz`, exact: true })).toHaveAttribute('aria-valuenow', '-6');
		}
		await page.mouse.move(start.x, start.y); await page.mouse.down();
		await page.mouse.move(finish.x, start.y - 60);
		await page.keyboard.press('Escape'); await page.mouse.up();
		await closeDialog(dialog);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		await panel.getByRole('group', { name: 'Graphic EQ', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Graphic EQ', exact: true });
		for (const frequency of [800, 1000, 1250, 1600]) {
			await expect(dialog.getByRole('slider', { name: `${frequency} Hz`, exact: true })).toHaveAttribute('aria-valuenow', '-6');
		}
		expect(errors).toEqual([]);
	});
});
