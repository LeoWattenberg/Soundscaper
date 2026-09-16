/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog,
	collectClientErrors, commitInput, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

async function openSelectionEffect(page, category, name) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', [category, name]);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function expectPaintedGraph(graph) {
	await expect(graph).toBeVisible();
	const drawing = await graph.locator('svg').boundingBox();
	expect(drawing).not.toBeNull();
	expect(drawing.width).toBeGreaterThan(350);
	expect(drawing.height).toBeGreaterThanOrEqual(190);
	const line = graph.locator('svg > path').last();
	await expect(line).toHaveAttribute('d', /^M /u);
	return line;
}

test.describe('Audacity wx effect diagrams', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1600, height: 1000 } });

	test('Legacy Compressor draws both dB rulers and updates its transfer graph from editable values', async ({ page }) => {
		const errors = collectClientErrors(page);
		const dialog = await openSelectionEffect(page, 'Legacy effects', 'Legacy Compressor');
		const graph = dialog.getByRole('img', { name: 'Compression curve', exact: true });
		const line = await expectPaintedGraph(graph);
		for (const label of ['-60 dB', '0 dB']) {
			await expect(graph.getByText(label, { exact: true })).toHaveCount(2);
			await expect(graph.getByText(label, { exact: true }).first()).toBeVisible();
		}
		const before = await line.getAttribute('d');
		await commitInput(dialog.locator('[data-effect-param="thresholdDb"]').getByRole('spinbutton'), '-24');
		await expect(line).not.toHaveAttribute('d', before);
		const afterThreshold = await line.getAttribute('d');
		await commitInput(dialog.locator('[data-effect-param="ratio"]').getByRole('spinbutton'), '4');
		await expect(line).not.toHaveAttribute('d', afterThreshold);
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Classic Filters shows logarithmic frequency rulers and accessible display-range sliders', async ({ page }) => {
		const errors = collectClientErrors(page);
		const dialog = await openSelectionEffect(page, 'Legacy effects', 'Classic Filters');
		const graph = dialog.getByRole('img', { name: 'Actual filter response', exact: true });
		const line = await expectPaintedGraph(graph);
		await expect(graph.getByText('20 Hz', { exact: true })).toBeVisible();
		await expect(graph.getByText('24k Hz', { exact: true })).toBeVisible();
		await expect(graph.getByText('-30 dB', { exact: true })).toBeVisible();
		const before = await line.getAttribute('d');
		await commitInput(dialog.locator('[data-effect-param="cutoffHz"]').getByRole('spinbutton'), '3000');
		await expect(line).not.toHaveAttribute('d', before);
		const maximum = dialog.getByRole('slider', { name: 'Maximum dB', exact: true });
		await maximum.focus();
		await maximum.press('ArrowDown');
		await expect(maximum).toHaveValue('19');
		await expect(graph.getByText('19 dB', { exact: true })).toBeVisible();
		const minimum = dialog.getByRole('slider', { name: 'Minimum dB', exact: true });
		await minimum.focus();
		await minimum.press('ArrowDown');
		await expect(minimum).toHaveValue('-31');
		await expect(graph.getByText('-31 dB', { exact: true })).toBeVisible();
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Auto Duck labels all five envelope markers and follows attenuation and fade input changes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const dialog = await openSelectionEffect(page, 'Volume and compression', 'Auto Duck');
		const graph = dialog.getByRole('img', { name: 'Envelope', exact: true });
		const line = await expectPaintedGraph(graph);
		await expect(graph.locator('[data-audacity-duck-control]')).toHaveCount(5);
		await expect(graph.getByText('-12.0 dB', { exact: true })).toBeVisible();
		const before = await line.getAttribute('d');
		await commitInput(dialog.locator('[data-effect-param="duckAmountDb"]').getByRole('spinbutton'), '-6');
		await expect(graph.getByText('-6.0 dB', { exact: true })).toBeVisible();
		await expect(line).not.toHaveAttribute('d', before);
		await commitInput(dialog.locator('[data-effect-param="innerFadeDown"]').getByRole('spinbutton'), '0.25');
		await expect(graph.locator('[data-audacity-duck-control="innerFadeDown"]')).toContainText('0.25 s');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});
