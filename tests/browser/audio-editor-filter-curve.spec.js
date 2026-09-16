import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	clipByName, closeDialog, collectClientErrors, commitInput, effectSourceMetadata, effectSourcePeak, importFiles,
	openEffectsForTrack, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

async function openCurve(page, editor) {
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Filter Curve EQ']);
	return page.getByRole('dialog', { name: 'Apply effect', exact: true });
}

async function curveBox(dialog) {
	const graph = dialog.getByRole('group', { name: 'Equalization curve', exact: true });
	await expect(graph).toBeVisible();
	const box = await graph.boundingBox();
	expect(box).not.toBeNull();
	return {
		graph,
		at: (x, y) => ({ x: box.x + (56 + x * 568) / 640 * box.width, y: box.y + (16 + y * 244) / 300 * box.height }),
	};
}

async function clickPoint(page, at) {
	await page.mouse.click(at.x, at.y);
}

async function curveGain(graph) {
	const label = await graph.getByRole('button').getAttribute('aria-label');
	const gain = Number(label?.match(/, (-?[\d.]+) dB$/)?.[1]);
	expect(Number.isFinite(gain)).toBe(true);
	return gain;
}

test.describe('Audacity Filter Curve EQ', () => {
	registerAudioEditorHooks();

	test('displays full-width presets, axis scales and FIR response without overflowing curve text', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const dialog = await openCurve(page, editor);
		const { graph } = await curveBox(dialog);
		const curve = graph.getByRole('img', { name: 'Drawn curve', exact: true });
		await expect(graph.getByRole('img', { name: 'Actual filter response', exact: true })).toHaveCount(1);
		await expect(graph).toContainText('24k');
		const contentWidth = await graph.evaluate((element) => element.parentElement.getBoundingClientRect().width);
		const graphWidth = (await graph.boundingBox()).width;
		expect(graphWidth / contentWidth).toBeGreaterThan(0.9);
		await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
		await page.getByRole('option', { name: 'Bass Cut', exact: true }).click();
		await expect(graph.getByRole('img', { name: 'Actual filter response', exact: true })).toBeVisible();
		const coordinates = (await curve.getAttribute('points')).split(' ');
		expect(Number(coordinates[0].split(',')[0])).toBe(56);
		expect(Number(coordinates.at(-1).split(',')[0])).toBe(624);
		const logLine = await curve.getAttribute('points');
		await dialog.getByRole('checkbox', { name: 'Linear frequency scale', exact: true }).check();
		await expect(curve).not.toHaveAttribute('points', logLine);
		await expect(graph).toContainText('0');
		await dialog.getByText('Curve points (Hz:dB)', { exact: true }).first().click();
		const textbox = dialog.getByRole('textbox', { name: 'Curve points (Hz:dB)', exact: true });
		await expect(textbox).toBeVisible();
		await commitInput(textbox, '20:-80, 50:-80, 80:-20, 150:0');
		const minimum = dialog.getByRole('spinbutton', { name: 'Minimum gain (dB)', exact: true });
		await minimum.fill('');
		await minimum.pressSequentially('-90');
		await minimum.press('Tab');
		await expect(graph).toContainText('-90');
		const height = await textbox.evaluate((input) => ({ input: input.getBoundingClientRect().height, wrapper: input.parentElement.getBoundingClientRect().height }));
		expect(height.wrapper).toBeGreaterThanOrEqual(height.input);
		await dialog.screenshot({ path: 'test-results/filter-curve-dialog.png' });
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('adds, drags, cancels and deletes curve points, then applies and undoes the EQ', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const originalSources = await effectSourceMetadata(page);
		const dialog = await openCurve(page, editor);
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		const { graph, at } = await curveBox(dialog);
		await expect(graph.getByRole('button')).toHaveCount(0);
		await clickPoint(page, at(0.4, 0.3));
		await expect(graph.getByRole('button')).toHaveCount(1);
		// Firefox rounds pointer coordinates to pixels, shifting the gain slightly.
		await expect.poll(() => curveGain(graph)).toBeCloseTo(12, 0);
		const start = at(0.4, 0.3);
		await page.mouse.move(start.x, start.y); await page.mouse.down();
		const moved = at(0.5, 0.4);
		await page.mouse.move(moved.x, moved.y); await page.mouse.up();
		await expect.poll(() => curveGain(graph)).toBeCloseTo(6, 0);
		const movedGain = await curveGain(graph);
		const movedLabel = await graph.getByRole('button').getAttribute('aria-label');
		await page.mouse.move(moved.x, moved.y); await page.mouse.down();
		const preview = at(0.7, 0.2);
		await page.mouse.move(preview.x, preview.y);
		await page.keyboard.press('Escape'); await page.mouse.up();
		await expect(dialog).toBeVisible();
		const restored = graph.getByRole('button');
		await expect(restored).toHaveAttribute('aria-label', movedLabel);
		await restored.focus(); await page.keyboard.press('ArrowUp');
		await expect.poll(() => curveGain(graph)).toBeCloseTo(movedGain + 0.1, 10);
		await page.keyboard.press('Delete');
		await expect(graph.getByRole('button')).toHaveCount(0);
		await clickPoint(page, at(0.4, 0.3));
		await page.mouse.move(start.x, start.y); await page.mouse.down();
		const outside = at(0.4, -0.04);
		await page.mouse.move(outside.x, outside.y); await page.mouse.up();
		await expect(graph.getByRole('button')).toHaveCount(0);
		await clickPoint(page, at(0.5, 0.4));
		await expect(graph.getByRole('button')).toHaveCount(1);
		await expect.poll(() => curveGain(graph)).toBeCloseTo(6, 0);
		const invertedGain = -await curveGain(graph);
		await dialog.getByRole('button', { name: 'Invert', exact: true }).click();
		await expect.poll(() => curveGain(graph)).toBeCloseTo(invertedGain, 10);
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		await expect.poll(async () => (await effectSourceMetadata(page)).length).toBeGreaterThan(originalSources.length);
		await expect.poll(() => effectSourcePeak(page, 'Filter Curve EQ')).toBeCloseTo(0.35 * 10 ** (invertedGain / 20), 2);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('persists graphical edits in a realtime rack', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Filter Curve EQ');
		let dialog = page.getByRole('dialog', { name: 'Filter Curve EQ', exact: true });
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		const { graph, at } = await curveBox(dialog);
		await clickPoint(page, at(0.4, 0.7));
		await expect(graph.getByRole('button')).toHaveCount(1);
		await expect.poll(() => curveGain(graph)).toBeCloseTo(-12, 0);
		const pointLabel = await graph.getByRole('button').getAttribute('aria-label');
		await closeDialog(dialog);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		await panel.getByRole('group', { name: 'Filter Curve EQ', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Filter Curve EQ', exact: true });
		await expect(dialog.getByRole('group', { name: 'Equalization curve', exact: true }).getByRole('button'))
			.toHaveAttribute('aria-label', pointLabel);
		expect(errors).toEqual([]);
	});
});
