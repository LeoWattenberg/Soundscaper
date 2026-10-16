/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('compound-meter ruler keeps bar labels readable after ordinary Zoom out commands', async ({ page }) => {
	await page.addInitScript(() => {
		const labels = new WeakMap();
		const fillRect = CanvasRenderingContext2D.prototype.fillRect;
		const fillText = CanvasRenderingContext2D.prototype.fillText;
		CanvasRenderingContext2D.prototype.fillRect = function (...args) {
			if (args[0] === 0 && args[1] === 0) labels.set(this.canvas, []);
			return Reflect.apply(fillRect, this, args);
		};
		CanvasRenderingContext2D.prototype.fillText = function (...args) {
			const entries = labels.get(this.canvas) ?? [];
			entries.push({ text: String(args[0]), x: args[1], width: this.measureText(String(args[0])).width });
			labels.set(this.canvas, entries);
			return Reflect.apply(fillText, this, args);
		};
		window.__round7RulerLabels = canvas => labels.get(canvas) ?? [];
	});
	const editor = await bootEditor(page, '/en/');
	await editor.getByRole('button', { name: 'Fullscreen', exact: true }).click();
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'minute recording.wav', duration: 60, channelCount: 1 })]);
	await editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true }).fill('6');
	const denominator = editor.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true });
	await denominator.fill('8');
	await denominator.blur();
	const ruler = editor.locator('[data-ruler]');
	await ruler.press('Shift+F10');
	await page.locator('.timeline-ruler-context-menu').getByRole('menuitem', { name: 'Beats & measures', exact: true }).click();
	const canvas = editor.locator('[data-musical-map-ruler]');
	await expect(canvas).toHaveCount(1);
	const drawn = () => canvas.evaluate(element => window.__round7RulerLabels(element).filter(label => /^\d+$/u.test(label.text)));
	await expect.poll(async () => (await drawn()).length).toBeGreaterThan(1);
	const healthy = await drawn();
	expect(healthy[1].x - healthy[0].x).toBeGreaterThanOrEqual(60);
	for (let step = 0; step < 6; step += 1) {
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom out']);
	}
	const zoomed = await drawn();
	expect(zoomed.length).toBeGreaterThan(1);
	for (let index = 1; index < zoomed.length; index += 1) {
		expect(zoomed[index].x).toBeGreaterThan(zoomed[index - 1].x + zoomed[index - 1].width);
		expect(zoomed[index].x - zoomed[index - 1].x).toBeGreaterThanOrEqual(60);
	}
});
