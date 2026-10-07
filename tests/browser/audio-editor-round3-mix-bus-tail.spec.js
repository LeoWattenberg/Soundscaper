/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeEffectsPanel, commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Mix and Render retains the complete tail through two serial group effects', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	for (let index = 0; index < 2; index++) await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('combobox', { name: /^Output:/u }).nth(1).selectOption({ label: 'Group bus 1' });
	for (let index = 0; index < 2; index++) {
		await mixer.locator('.kw-audio-editor__mixer-channel--group').nth(index)
			.getByRole('button', { name: 'Select effect', exact: true }).first().click();
		const panel = editor.locator('[data-workspace-panel="effects"]');
		await expect(panel).toBeVisible();
		await addRackEffect(page, panel, 'track', 'Feedback delay');
		const host = page.locator('[data-effects-window-host]').last();
		const delay = host.getByRole('dialog', { name: 'Feedback delay', exact: true });
		for (const [parameter, value] of Object.entries({ time: '0.5', feedback: '0', mix: '1' })) {
			await commitInput(delay.locator(`[data-effect-param="${parameter}"] input`), value);
		}
		await delay.getByRole('button', { name: 'Close', exact: true }).click();
		await closeEffectsPanel(panel);
	}
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const secondId = (await graph.locator('[data-routing-node^="mixer-node:"]').last().getAttribute('data-routing-node')).slice('mixer-node:'.length);
	await graph.getByRole('button', { name: /^assignment connection from Group: Group bus 1 to Master,/u }).click();
	const connection = graph.getByRole('complementary', { name: 'Connection inspector', exact: true });
	await connection.locator('select[name="destination"]').selectOption(JSON.stringify({ kind: 'mixer-node', id: secondId }));
	await connection.getByRole('button', { name: 'Save connection', exact: true }).click();
	await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection rewired');
	await clipByName(editor, monoTone.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
	const dialog = page.locator('[data-mix-render-dialog]');
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
	await properties.getByText('Media settings', { exact: true }).click();
	await expect(properties.locator('[data-clip-field="durationFrame"] .timecode__display')).toHaveText('00h00m01.800s');
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(86_400);
	const lastVoice = samples.slice(72_000, 81_600);
	expect(Math.sqrt(lastVoice.reduce((sum, sample) => sum + sample * sample, 0) / lastVoice.length)).toBeGreaterThan(0.1);
});
