/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks, trackNameText } from './audio-editor-test-helpers.js';
import { captureHarnessState, installCaptureHarness, expectCapturePhase } from './helpers/framescaper-capture-harness.js';

test.describe('Framescaper inputs and transport', () => {
	registerAudioEditorHooks();

	test('combined A/V capture is available through Inputs setup and the default Record control', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page, { persistentQuota: true, videoKind: 'cfr' });
		const editor = await bootEditor(page, '/framescaper/en/');
		await expect(editor.locator('[data-transport="framescaper-record"]').getByRole('button', { name: 'Record', exact: true })).toBeVisible();
		await expect(editor.getByRole('button', { name: 'Add media', exact: true }).and(editor.locator('button'))).toBeVisible();
		await expect(editor.getByText('Drop files', { exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Inputs setup', exact: true }).click();
		const setup = editor.getByRole('dialog', { name: 'Inputs setup', exact: true });
		await expect(setup.getByRole('checkbox', { name: 'Camera', exact: true })).toBeChecked();
		await expect(setup.getByRole('checkbox', { name: 'Microphone', exact: true })).toBeChecked();
		expect((await captureHarnessState(page)).requests).toHaveLength(0);
		await setup.getByRole('button', { name: 'Preview sources', exact: true }).click();
		await expectCapturePhase(setup.locator('[data-framescaper-recording-setup]'), 'previewing');
		await setup.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await setup.getByRole('button', { name: 'Arm capture', exact: true }).click();
		await expectCapturePhase(setup.locator('[data-framescaper-recording-setup]'), 'armed');
		await page.keyboard.press('Escape');
		const record = editor.locator('[data-transport="framescaper-record"]');
		await record.getByRole('button', { name: 'Start capture', exact: true }).click();
		await expect(record).toHaveAttribute('data-capture-active', 'true');
		await expectCapturePhase(editor.locator('[data-framescaper-recording-setup]'), 'recording', 30_000);
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThanOrEqual(3);
		await record.getByRole('button', { name: 'Stop and import', exact: true }).click();
		await expect(editor.locator('[data-video-track]')).toHaveCount(1, { timeout: 60_000 });
		await expect(trackNameText(editor).filter({ hasText: /^Microphone$/u })).toHaveCount(1);
		await expect.poll(async () => (await captureHarnessState(page)).stopCalls).toBe(2);
		await expect(record.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
	});

	test('frame controls match the transport and sit between jump to start and end', async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/en/');
		const controls = editor.locator('[data-workspace-toolbar="transport"]');
		const labels = ['Jump to project start', 'Previous frame', 'Next frame', 'Jump to project end'];
		const buttons = controls.locator('.transport-button');
		const names = await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));
		const indices = labels.map((label) => names.indexOf(label));
		expect(indices.every((index) => index >= 0)).toBe(true);
		expect(indices).toEqual([...indices].sort((left, right) => left - right));
	});
});
