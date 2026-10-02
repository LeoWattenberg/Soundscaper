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
		const left = (await marker.boundingBox()).x;
		await marker.press('Shift+ArrowRight');
		await expect(marker).toHaveAttribute('data-source-sample', sample);
		await expect.poll(async () => (await marker.boundingBox()).x).toBeGreaterThan(left);
		await marker.press('Delete');
		await expect(marker).toHaveCount(0);
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
		await panel.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(() => ruler.getAttribute('aria-valuenow')).not.toBe('0');
		const mainTransport = editor.locator('.kw-audio-editor__transport');
		await mainTransport.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(mainTransport.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(mainTransport.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(ruler).toHaveAttribute('aria-valuenow', '0');
		expect(errors).toEqual([]);
	});
});
