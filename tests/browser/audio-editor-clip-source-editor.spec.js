/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, longTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, clipField, collectClientErrors, importFiles, openClipProperties, registerAudioEditorHooks, chooseNestedCommandAction, chooseCommandAction, projectTimelineSourceNames } from './audio-editor-test-helpers.js';

test.describe('clip source editor', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1440, height: 1000 } });

	test('shows all media, trims without moving the project anchor, and keeps moved markers attached to samples', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const before = await clip.boundingBox();
		const panel = await openClipProperties(page, editor, clip);
		await expect(panel.locator('details[open]')).toHaveCount(0);
		const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
		await expect(waveform).toBeVisible();
		const frames = await waveform.getAttribute('data-source-frame-count');
		const initialSourceIn = await clipField(panel, 'sourceInFrame').inputValue();
		await expect(waveform.locator('canvas').first()).toHaveAttribute('width', /[1-9]\d*/u);
		await panel.getByRole('button', { name: 'Trim source start', exact: true }).press('Shift+ArrowRight');
		await expect(waveform).toHaveAttribute('data-source-frame-count', frames);
		await panel.getByText('Media settings', { exact: true }).click();
		await expect(clipField(panel, 'sourceInFrame')).not.toHaveValue(initialSourceIn);
		await panel.getByText('Media settings', { exact: true }).click();
		expect((await clip.boundingBox()).x).toBeCloseTo(before.x, 0);
		const bounds = await waveform.boundingBox();
		await waveform.click({ position: { x: bounds.width * 0.4, y: 80 }, modifiers: ['Control'] });
		const marker = panel.getByRole('button', { name: 'Stretch marker 1', exact: true });
		await expect(marker).toBeVisible();
		const sample = await marker.getAttribute('data-source-sample');
		await marker.focus();
		await expect(marker).toHaveAttribute('aria-description', /Before marker: 1\.00× \(100%\); After marker: 1\.00× \(100%\)/u);
		const markerBounds = await marker.boundingBox();
		await page.mouse.move(markerBounds.x + markerBounds.width / 2, markerBounds.y + 30);
		await page.mouse.down();
		await page.mouse.move(markerBounds.x + markerBounds.width / 2 + 25, markerBounds.y + 30, { steps: 5 });
		const feedback = panel.locator('.audio-editor-source-stretch-feedback');
		await expect(feedback).toBeVisible();
		await expect(feedback.locator('[data-source-speed="before"]')).toHaveText(/Before marker0\.\d+× \(\d+(?:\.\d+)?%\)/u);
		await expect(feedback.locator('[data-source-speed="after"]')).toHaveText(/After marker1\.\d+× \(\d+(?:\.\d+)?%\)/u);
		await expect(marker).toHaveAttribute('data-source-sample', sample);
		await page.mouse.up();
		const left = (await marker.boundingBox()).x;
		await marker.press('Shift+ArrowRight');
		await expect(marker).toHaveAttribute('data-source-sample', sample);
		await expect.poll(async () => (await marker.boundingBox()).x).toBeGreaterThan(left);
		await marker.press('Delete');
		await expect(marker).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('reuses timeline fade grips, previews waveform fades, and cancels captured drags with Escape', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const panel = await openClipProperties(page, editor, clip);
		const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
		const fadeIn = waveform.getByRole('slider', { name: 'Fade in', exact: true });
		const fadeOut = waveform.getByRole('slider', { name: 'Fade out', exact: true });
		await expect(fadeIn).toHaveAttribute('data-fade-handle', 'in');
		await expect(fadeOut).toHaveAttribute('data-fade-handle', 'out');
		await expect(fadeIn.locator('svg path').first()).toBeVisible();
		const startTrim = panel.getByRole('button', { name: 'Trim source start', exact: true });
		const endTrim = panel.getByRole('button', { name: 'Trim source end', exact: true });
		expect(await startTrim.evaluate(element => getComputedStyle(element).cursor)).toContain('ClipTrimLeft');
		expect(await endTrim.evaluate(element => getComputedStyle(element).cursor)).toContain('ClipTrimRight');
		await fadeIn.press('Shift+ArrowRight');
		const initial = await fadeIn.getAttribute('aria-valuenow');
		const numeric = await clipField(panel, 'fadeInFrame').inputValue();
		const placement = await clip.getAttribute('aria-label');
		const canvas = waveform.locator('[data-source-active="true"] canvas').first();
		const image = () => canvas.evaluate(element => element.toDataURL());
		const before = await image();
		const curve = waveform.locator('path[data-fade-curve="in"]');
		await expect(curve).toHaveAttribute('fill', 'none');
		const curveBefore = await curve.getAttribute('d');
		const grip = await fadeIn.boundingBox();
		await page.mouse.move(grip.x + grip.width / 2, grip.y + 5);
		await page.mouse.down();
		await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + 5, { steps: 5 });
		await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(initial));
		await expect(curve).not.toHaveAttribute('d', curveBefore);
		await expect.poll(image).not.toBe(before);
		await page.keyboard.press('Escape');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', initial);
		await expect(curve).toHaveAttribute('d', curveBefore);
		await expect.poll(image).toBe(before);
		await page.mouse.up();
		await expect(clipField(panel, 'fadeInFrame')).toHaveValue(numeric);
		await expect(clip).toHaveAttribute('aria-label', placement);
		expect(errors).toEqual([]);
	});

	test('keeps painted waveform samples while zooming and panning across unused source media', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
		await panel.getByRole('button', { name: 'Trim source start', exact: true }).press('Shift+ArrowRight');
		await panel.getByRole('button', { name: 'Trim source end', exact: true }).press('Shift+ArrowLeft');
		const ruler = panel.getByRole('slider', { name: 'Source timeline', exact: true });
		const wheel = (deltaY, deltaX = 0, ctrlKey = false) => waveform.evaluate((element, values) => {
			const rect = element.getBoundingClientRect();
			element.dispatchEvent(new WheelEvent('wheel', { ...values, bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + 80 }));
		}, { deltaY, deltaX, ctrlKey });
		for (let step = 0; step < 22; step += 1) {
			const previous = await ruler.getAttribute('aria-valuemax');
			await wheel(-100, 0, true);
			await expect(ruler).not.toHaveAttribute('aria-valuemax', previous);
		}
		const paintedSamples = () => waveform.locator('canvas').evaluateAll(canvases => canvases.reduce((sum, canvas) => {
			if (!canvas.width || !canvas.height) return sum;
			const context = canvas.getContext('2d');
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let painted = 0;
			for (let y = 0; y < canvas.height; y += 1) {
				if (Math.abs(y - canvas.height / 2) < 4) continue;
				for (let x = 0; x < canvas.width; x += 1) if (pixels[(y * canvas.width + x) * 4 + 3] > 0) painted += 1;
			}
			return sum + painted;
		}, 0));
		await expect.poll(paintedSamples).toBeGreaterThan(100);
		await wheel(0, -1000000);
		await expect(ruler).toHaveAttribute('aria-valuemin', '0');
		await expect(waveform.locator('[data-source-active="false"] canvas')).toHaveCount(1);
		await expect.poll(paintedSamples).toBeGreaterThan(100);
		await wheel(0, 1000000);
		await expect(waveform.locator('[data-source-active="false"] canvas')).toHaveCount(1);
		await expect(waveform.locator('[data-source-active="true"]')).toHaveCount(0);
		await expect.poll(paintedSamples).toBeGreaterThan(100);
		await expect(waveform.locator('[data-waveform-error]')).toHaveCount(0);
		await waveform.click({ button: 'right', position: { x: 80, y: 80 } });
		await page.getByRole('menuitem', { name: 'Fit source', exact: true }).click();
		await expect(waveform.getByRole('slider', { name: 'Fade in', exact: true })).toBeVisible();
		await expect(waveform.getByRole('slider', { name: 'Fade out', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('applies a selected source effect to every instance and restores both with undo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const original = clipByName(editor, longTone.name);
		await original.focus(); await original.press('Enter');
		await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
		await expect(clipByName(editor, longTone.name)).toHaveCount(2);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name).last());
		const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
		const bounds = await waveform.boundingBox();
		await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + 80);
		await page.mouse.down();
		await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + 80, { steps: 5 });
		await page.mouse.up();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20000 });
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(async () => (await projectTimelineSourceNames(page, projectId)).filter(name => name?.includes('Invert')).length).toBe(2);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => projectTimelineSourceNames(page, projectId)).toEqual([longTone.name, longTone.name]);
		expect(errors).toEqual([]);
	});

	test('offers ruler modes and gives focused source playback its own transport', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		const vertical = panel.getByRole('region', { name: 'Source vertical ruler', exact: true });
		await vertical.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
		await expect(vertical).toBeVisible();
		const ruler = panel.getByRole('slider', { name: 'Source timeline', exact: true });
		await ruler.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Global time', exact: true }).click();
		await expect(ruler).toHaveAttribute('data-time-origin', 'global');
		await ruler.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Local time', exact: true }).click();
		await expect(ruler).toHaveAttribute('data-time-origin', 'local');
		await panel.getByRole('button', { name: 'Loop selection', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Loop selection', exact: true })).toHaveAttribute('aria-pressed', 'true');
		const propertiesBody = panel.locator('[data-clip-properties-active-clip]');
		await propertiesBody.focus();
		await propertiesBody.press('Space');
		await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(() => ruler.getAttribute('aria-valuenow')).not.toBe('0');
		const mainTransport = editor.locator('.kw-audio-editor__transport');
		await expect(mainTransport.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await propertiesBody.press('Space');
		await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await propertiesBody.press('Space');
		await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await mainTransport.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(mainTransport.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		// Focusing the source transport retires the timeline worklet. Let its
		// coverage checkpoint finish before sending the next mouse gesture.
		const sourcePlay = panel.getByRole('button', { name: 'Play', exact: true });
		await sourcePlay.focus();
		await expect(mainTransport.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		const sourcePosition = await ruler.getAttribute('aria-valuenow');
		await sourcePlay.click();
		await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(mainTransport.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		// The Pause label appears while the audio engine is still starting.
		// Stop the running source after its clock confirms that startup settled.
		await expect.poll(() => ruler.getAttribute('aria-valuenow')).not.toBe(sourcePosition);
		await panel.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(ruler).toHaveAttribute('aria-valuenow', '0');
		expect(errors).toEqual([]);
	});
});
