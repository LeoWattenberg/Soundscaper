/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('clearing an existing routing level does not silently replace its authored quiet feed with unity', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('combobox', { name: 'Output: browser-mono-tone', exact: true }).selectOption({ label: 'Group bus 1' });
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const bus = await graph.locator('[data-routing-node^="mixer-node:"]').getAttribute('data-routing-node');
	await graph.locator(`[data-routing-edge="assignment:${bus}:master"]`).click();
	let inspector = graph.locator('[data-routing-inspector="edge"]');
	await inspector.getByLabel('Level (dB)', { exact: true }).fill('-12');
	await inspector.getByLabel('Level (dB)', { exact: true }).press('Tab');
	await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
	await expect(inspector).toContainText('-12 dB');
	await closeWorkspacePanel(editor, 'mixer');
	const before = await exportSamples(page, editor);
	const rms = samples => Math.sqrt(samples.slice(4_800, 14_400).reduce((sum, sample) => sum + sample * sample, 0) / 9_600);
	expect(rms(before)).toBeGreaterThan(0.04);
	expect(rms(before)).toBeLessThan(0.05);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	if (await graph.count() === 0) await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	await graph.locator(`[data-routing-edge="assignment:${bus}:master"]`).click();
	inspector = graph.locator('[data-routing-inspector="edge"]');
	const level = inspector.getByLabel('Level (dB)', { exact: true });
	await level.focus();
	await level.press('ControlOrMeta+A');
	await level.press('Backspace');
	await level.press('Tab');
	await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
	await closeWorkspacePanel(editor, 'mixer');
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(before.length);
	expect(rms(after) / rms(before)).toBeCloseTo(1, 3);
});
