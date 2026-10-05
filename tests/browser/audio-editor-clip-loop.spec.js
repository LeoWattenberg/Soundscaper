import { expect, test, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

async function selectClip(clip) {
	await clip.locator('.clip-header').click();
}

async function beginDrag(page, handle, delta) {
	const bounds = await handle.boundingBox();
	expect(bounds).not.toBeNull();
	const x = bounds.x + bounds.width / 2;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + delta, y, { steps: 5 });
}

async function drag(page, handle, delta) {
	await beginDrag(page, handle, delta);
	await page.mouse.up();
}

async function expectNativeTrimPosition(clip) {
	const trim = await clip.getByRole('button', { name: 'Trim right edge', exact: true }).boundingBox();
	const clock = await clip.getByRole('button', { name: 'Stretch right edge', exact: true }).boundingBox();
	expect(trim).not.toBeNull();
	expect(clock).not.toBeNull();
	expect(trim.x + trim.width / 2).toBeCloseTo(clock.x + clock.width / 2, 1);
}

function patternedTone() {
	const fixture = createWavFixture({ name: 'loop-pattern.wav', frequency: 440, channelCount: 1 });
	const frames = (fixture.buffer.length - 44) / 2;
	for (let frame = 0; frame < frames; frame++) {
		const offset = 44 + frame * 2;
		const gain = frame < frames * 0.6 ? 0.35 : 1;
		fixture.buffer.writeInt16LE(Math.round(fixture.buffer.readInt16LE(offset) * gain), offset);
	}
	return fixture;
}

async function waveformRepeatProfile(waveform) {
	return waveform.evaluate(canvas => {
		const maximum = canvas.__kwWaveformPlan?.channels[0]?.maximum;
		if (!maximum?.length) return null;
		return Array.from({ length: 4 }, (_, repeat) => [0.25, 0.8].map(position => {
			const column = Math.min(maximum.length - 1, Math.floor((repeat + position) * maximum.length / 4));
			return maximum[column];
		}));
	});
}

test.describe('clip looping', () => {
	registerAudioEditorHooks();
	test('shows the loop icon beneath the clock whenever the clip is selected, without a menu toggle', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await selectClip(clip);
		const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
		await expect(loop).toBeVisible();
		await expect(loop).toContainText('\uEF1F');
		const clock = await clip.getByRole('button', { name: 'Stretch right edge', exact: true }).boundingBox();
		expect((await loop.boundingBox()).y).toBeGreaterThan(clock.y + clock.height);
		await expectNativeTrimPosition(clip);
		await clip.locator('.clip-header').click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Loop clip', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await clip.click({ position: { x: 30, y: 50 } });
		await expect(loop).toHaveCount(0);
		await selectClip(clip);
		await expect(loop).toBeVisible();
	});

	test('keeps ordinary trim behavior and placement until the loop handle extends past one repetition', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await selectClip(clip);
		const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
		const initial = Number(await loop.getAttribute('aria-valuenow'));
		const width = (await clip.locator('.clip-display').boundingBox()).width;
		await expectNativeTrimPosition(clip);
		await drag(page, clip.getByRole('button', { name: 'Trim right edge', exact: true }), -width / 2);
		await expect.poll(async () => Number(await loop.getAttribute('aria-valuenow'))).toBeCloseTo(initial / 2, 3);
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(0);
		await expectNativeTrimPosition(clip);
		await loop.press('ArrowRight');
		await expect.poll(async () => Number(await loop.getAttribute('aria-valuenow'))).toBeCloseTo(initial, 3);
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
	});

	test('snaps repetitions, trims the loop period while preserving total length, and undoes each drag', async ({ page }, testInfo) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await selectClip(clip);
		const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
		await expect(loop).toBeVisible();
		const initialLength = Number(await loop.getAttribute('aria-valuenow'));
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

	test('returns to native trim placement and length changes after dragging four repetitions back to one', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 900 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await selectClip(clip);
		const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
		const initial = Number(await loop.getAttribute('aria-valuenow'));
		const width = (await clip.locator('.clip-display').boundingBox()).width;
		// Give the native left handle room inside the timeline instead of the track controls.
		const initialX = (await clip.boundingBox()).x;
		await drag(page, clip.locator('.clip-header'), width);
		await expect.poll(async () => (await clip.boundingBox()).x).toBeGreaterThan(initialX + width / 2);
		await drag(page, loop, width * 3 + 1);
		await expect(loop).toHaveAttribute('aria-valuenow', String(initial * 4));
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(3);
		await drag(page, loop, -width * 3);
		await expect(loop).toHaveAttribute('aria-valuenow', String(initial));
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(0);
		await expectNativeTrimPosition(clip);
		await drag(page, clip.getByRole('button', { name: 'Trim right edge', exact: true }), -width / 2);
		await expect.poll(async () => Number(await loop.getAttribute('aria-valuenow'))).toBeCloseTo(initial / 2, 3);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(loop).toHaveAttribute('aria-valuenow', String(initial));
		await drag(page, clip.getByRole('button', { name: 'Trim left edge', exact: true }), width / 4);
		await expect.poll(async () => Number(await loop.getAttribute('aria-valuenow'))).toBeCloseTo(initial * 0.75, 3);
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(0);
		await expectNativeTrimPosition(clip);
	});

	test('supports keyboard resizing, cancellation, partial repeats and returning to one repetition', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await selectClip(clip);
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
		await loop.press('Shift+ArrowLeft');
		await loop.press('ArrowLeft');
		await expect(loop).toHaveAttribute('aria-valuenow', String(initial));
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(0);
		await expectNativeTrimPosition(clip);
	});

	test('preserves repeated waveform content and repeat count throughout a stretch preview', async ({ page }, testInfo) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 1920, height: 900 });
		const fixture = patternedTone();
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [fixture]);
		const clip = clipByName(editor, fixture.name);
		await selectClip(clip);
		const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
		for (let repeat = 1; repeat < 4; repeat++) await loop.press('ArrowRight');
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(3);
		const waveform = clip.locator('canvas.clip-body__waveform');
		await expect.poll(() => waveformRepeatProfile(waveform)).not.toBeNull();
		const initialLength = Number(await loop.getAttribute('aria-valuenow'));
		const width = (await clip.locator('.clip-display').boundingBox()).width;
		await beginDrag(page, clip.getByRole('button', { name: 'Stretch right edge', exact: true }), width);
		await expect.poll(async () => Number(await loop.getAttribute('aria-valuenow'))).toBeCloseTo(initialLength * 2, 3);
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(3);
		const boundaryRatios = await clip.evaluate(element => {
			const display = element.querySelector('.clip-display').getBoundingClientRect();
			return [...element.querySelectorAll('[data-loop-boundary-frame]')].map(marker => (marker.getBoundingClientRect().x - display.x) / display.width);
		});
		for (let boundary = 0; boundary < boundaryRatios.length; boundary++) expect(boundaryRatios[boundary]).toBeCloseTo((boundary + 1) / 4, 2);
		const during = await waveformRepeatProfile(waveform);
		for (const [low, high] of during) {
			expect(low).toBeGreaterThan(0.08);
			expect(high).toBeGreaterThan(low * 2);
			expect(low).toBeCloseTo(during[0][0], 2);
			expect(high).toBeCloseTo(during[0][1], 2);
		}
		await clip.screenshot({ path: testInfo.outputPath('loop-stretch-preview.png') });
		await page.mouse.up();
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(3);
		await expect.poll(async () => {
			const committed = await waveformRepeatProfile(waveform);
			return committed && committed.every((pair, repeat) => pair.every((value, phase) => Math.abs(value - during[repeat][phase]) < 0.01));
		}).toBe(true);
		expect(errors).toEqual([]);
	});

	test('exports repeated audio at its original speed through the offline renderer', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await selectClip(clip);
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
