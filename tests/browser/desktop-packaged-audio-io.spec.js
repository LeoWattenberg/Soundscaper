/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/nightly-packaged-electron.js';
import {
	firstLaunchSetupSeedValue,
	firstLaunchSetupStorageKey,
} from '../../src/common/editor/ui/first-launch-setup.ts';

const PACKAGED_RUNTIME = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS === '1';
const WORKSPACE_SETUP = Object.freeze({
	key: firstLaunchSetupStorageKey('soundscaper'),
	value: firstLaunchSetupSeedValue(),
});

test.describe('packaged Soundscaper audio devices', () => {
	test.skip(!PACKAGED_RUNTIME, 'Runs only from the packaged Electron collection.');

	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.metadata.productId !== 'soundscaper', 'Soundscaper owns audio recording.');
		await page.evaluate(({ key, value }) => localStorage.setItem(key, value), WORKSPACE_SETUP);
		await waitForReadyEditor(page);
	});

	test('enumerates, selects, and records from native Electron audio devices', async ({ page }) => {
		const capabilities = await page.evaluate(() => ({
			bridgeAvailable: typeof globalThis.scapeDesktop?.v1?.getEnvironment === 'function',
			enumerateDevices: typeof navigator.mediaDevices?.enumerateDevices,
			getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
			setSinkId: typeof AudioContext.prototype.setSinkId,
		}));
		expect(capabilities).toEqual({
			bridgeAvailable: true,
			enumerateDevices: 'function',
			getUserMedia: 'function',
			setSinkId: 'function',
		});

		const editor = page.locator('[data-audio-editor]');
		const initialClipCount = Number(await editor.getAttribute('data-clip-count'));
		await openAudioSetup(editor);
		const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await setup.getByRole('button', { name: 'Refresh devices', exact: true }).click();
		const microphone = setup.getByRole('combobox', { name: 'Microphone', exact: true });
		const speakers = setup.getByRole('combobox', { name: 'Speakers', exact: true });
		const microphoneId = await optionValue(microphone, 'Fake Audio Input 1');
		const speakerId = await optionValue(speakers, 'Fake Audio Output 1');

		await microphone.selectOption(microphoneId);
		await speakers.selectOption(speakerId);
		await expect(microphone).toHaveValue(microphoneId);
		await expect(speakers).toHaveValue(speakerId);
		await expect(setup.getByRole('status')).toHaveCount(0);
		await page.keyboard.press('Escape');

		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => Number(await editor
			.getByRole('meter', { name: 'Input level', exact: true })
			.getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(-50);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', String(initialClipCount + 1));

		await openAudioSetup(editor);
		const reopened = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await expect(reopened.getByRole('combobox', { name: 'Microphone', exact: true }))
			.toHaveValue(microphoneId);
		await expect(reopened.getByRole('combobox', { name: 'Speakers', exact: true }))
			.toHaveValue(speakerId);
		await reopened.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('default');
		await reopened.getByRole('combobox', { name: 'Speakers', exact: true }).selectOption('');
		const release = reopened.getByRole('button', { name: 'Disable microphones', exact: true });
		if (await release.isVisible()) await release.click();
		await page.keyboard.press('Escape');
	});
});

async function waitForReadyEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(page.getByRole('progressbar', { name: 'Loading project', exact: true })).toHaveCount(0);
	await dismissWorkspaceOnboarding(page);
	if (!await editor.getAttribute('data-project-id')) {
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
	}
	await expect(editor).not.toHaveAttribute('data-project-id', '');
}

async function dismissWorkspaceOnboarding(page) {
	const onboarding = page.getByRole('dialog', { name: 'Getting started', exact: true });
	if (!await onboarding.isVisible().catch(() => false)) return;
	await onboarding.getByRole('button', { name: 'Soundscaper', exact: true }).click();
	await expect(onboarding).toHaveCount(0);
}

async function openAudioSetup(editor) {
	await editor.locator('[data-action-bar]')
		.getByRole('button', { name: 'Audio setup', exact: true }).click();
	await expect(editor.getByRole('dialog', { name: 'Audio setup', exact: true })).toBeVisible();
}

async function optionValue(select, label) {
	const option = select.locator('option', { hasText: label });
	await expect(option).toHaveCount(1);
	const value = await option.getAttribute('value');
	expect(value).toBeTruthy();
	return value;
}
