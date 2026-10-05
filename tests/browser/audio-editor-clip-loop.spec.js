import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

async function toggleLoop(page, clip) {
	await clip.locator('.clip-header').click();
	await clip.locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Loop clip', exact: true }).click();
}

async function drag(page, handle, delta) {
	const bounds = await handle.boundingBox();
	expect(bounds).not.toBeNull();
	const x = bounds.x + bounds.width / 2;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + delta, y, { steps: 5 });
	await page.mouse.up();
}

test.describe('clip looping', () => {
	registerAudioEditorHooks();
	test('opts in through the clip menu, snaps repetitions, trims the period, and undoes each drag', async ({ page }, testInfo) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await expect(clip.getByRole('slider', { name: 'Looped clip length' })).toHaveCount(0);
		await toggleLoop(page, clip);
		const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
		await expect(loop).toBeVisible();
		const initialLength = Number(await loop.getAttribute('aria-valuenow'));
		const clockBounds = await clip.getByRole('button', { name: 'Stretch right edge', exact: true }).boundingBox();
		expect((await loop.boundingBox()).y).toBeGreaterThan(clockBounds.y + clockBounds.height);
		const width = (await clip.locator('.clip-display').boundingBox()).width;
		await drag(page, loop, width + 1);
		await expect(loop).toHaveAttribute('aria-valuenow', String(initialLength * 2));
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
		const overallLength = await clip.getAttribute('aria-label');
		await drag(page, clip.getByRole('button', { name: 'Trim right edge', exact: true }), -width / 2);
		await expect(clip).toHaveAttribute('aria-label', overallLength);
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(3);
		await clip.screenshot({ path: testInfo.outputPath('clip-loop.png') });
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(loop).toHaveAttribute('aria-valuenow', String(initialLength));
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(loop).toHaveAttribute('aria-valuenow', String(initialLength * 2));
		expect(errors).toEqual([]);
	});

	test('supports keyboard resizing, cancellation, partial repeats and disabling looping', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await toggleLoop(page, clip);
		const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
		const initial = Number(await loop.getAttribute('aria-valuenow'));
		await loop.focus();
		await loop.press('ArrowRight');
		await expect(loop).toHaveAttribute('aria-valuenow', String(initial * 2));
		await loop.press('Shift+ArrowRight');
		await expect(loop).toHaveAttribute('aria-valuenow', String(initial * 2 + 0.01));
		const length = await loop.getAttribute('aria-valuenow');
		const bounds = await loop.boundingBox();
		await page.mouse.move(bounds.x + 5, bounds.y + 5);
		await page.mouse.down();
		await page.mouse.move(bounds.x + 35, bounds.y + 5);
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect(loop).toHaveAttribute('aria-valuenow', length);
		await toggleLoop(page, clip);
		await expect(loop).toHaveCount(0);
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(0);
	});

	test('exports repeated audio at its original speed through the offline renderer', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await toggleLoop(page, clip);
		await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		const dialog = await openExportDialog(page, editor);
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20000 });
		const bytes = await readDownloadBytes(page, link);
		const result = await page.evaluate(async data => {
			const context = new AudioContext();
			try {
				const decoded = await context.decodeAudioData(new Uint8Array(data).buffer);
				const samples = decoded.getChannelData(0);
				const period = Math.round(0.8 * decoded.sampleRate);
				let maximumDifference = 0;
				for (let frame = Math.round(0.1 * decoded.sampleRate); frame < Math.round(0.6 * decoded.sampleRate); frame++) {
					maximumDifference = Math.max(maximumDifference, Math.abs(samples[frame] - samples[frame + period]));
				}
				return { duration: decoded.duration, maximumDifference };
			} finally { await context.close(); }
		}, Array.from(bytes));
		expect(result.duration).toBeCloseTo(1.6, 4);
		expect(result.maximumDifference).toBeLessThan(0.001);
	});
});
