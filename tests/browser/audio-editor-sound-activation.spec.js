/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper sound-activated recording', () => {
	registerAudioEditorHooks();

	test('keeps its action in Record options and settings in the cog flyout', async ({ page, browserName }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		let options = page.getByRole('dialog', { name: 'Record options', exact: true });
		await expect(options.getByRole('button', { name: 'Sound-activated recording', exact: true })).toBeEnabled();
		await expect(options.getByRole('button', { name: 'Set activation level' })).toHaveCount(0);
		await expect(options.getByRole('button', { name: 'Record to new track' })).toBeVisible();
		await expect(options.getByRole('button', { name: 'Timed recording' })).toBeVisible();
		await expect(options.getByRole('checkbox', { name: 'Lead-in time' })).toBeVisible();
		await expect(options.getByRole('checkbox', { name: 'Monitor input' })).toBeVisible();
		await options.getByRole('button', { name: 'Sound activation', exact: true }).click();

		const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
		const panel = settings.locator('[data-sound-activation-settings]');
		const threshold = panel.getByRole('slider', { name: 'Activation threshold', exact: true });
		const hysteresis = panel.getByRole('slider', { name: 'Release hysteresis', exact: true });
		const hold = panel.locator('[data-sound-activation-hold] input');
		await expect(panel).toBeVisible();
		await expect(panel.getByRole('switch')).toHaveCount(0);
		await threshold.focus();
		await page.keyboard.press('ArrowRight');
		await expectCommittedSetting(panel, 'data-sound-activation-threshold-db', '-39');
		await hysteresis.focus();
		await page.keyboard.press('ArrowRight');
		await expectCommittedSetting(panel, 'data-sound-activation-hysteresis-db', '7');
		await hold.fill('260');
		await hold.blur();
		await expectCommittedSetting(panel, 'data-sound-activation-hold-milliseconds', '260');
		await threshold.focus();
		await page.keyboard.press('Escape');
		await expect(settings).toBeHidden();
		await expect(options).toBeVisible();
		await expect(options.getByRole('button', { name: 'Sound activation', exact: true })).toBeFocused();
		await options.getByRole('button', { name: 'Sound activation', exact: true }).click();
		await expect(settings).toBeVisible();

		await assertNoSeriousAxeViolations(page, '[data-sound-activation-settings]');
		if (browserName === 'chromium') {
			await page.emulateMedia({ forcedColors: 'active' });
			await expect(panel).toHaveCSS('forced-color-adjust', 'none');
			await page.emulateMedia({ forcedColors: 'none' });
		}
		await page.reload();
		editor = await waitForEditor(page);
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		options = page.getByRole('dialog', { name: 'Record options', exact: true });
		await options.getByRole('button', { name: 'Sound activation', exact: true }).click();
		const restored = page.getByRole('dialog', { name: 'Sound activation', exact: true });
		await expect(restored.getByRole('slider', { name: 'Activation threshold' })).toHaveValue('-39');
		await expect(restored.getByRole('slider', { name: 'Release hysteresis' })).toHaveValue('7');
		await expect(restored.locator('[data-sound-activation-hold] input')).toHaveValue('260');
		expect(errors).toEqual([]);
	});

	test('starts sound activation from the flyout while R starts ordinary recording', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
				enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'fixture', label: 'Fixture microphone' }],
				getUserMedia: async () => {
					const context = new AudioContext();
					const destination = context.createMediaStreamDestination();
					const oscillator = context.createOscillator();
					oscillator.connect(destination);
					oscillator.start();
					await context.resume();
					const [track] = destination.stream.getAudioTracks();
					const getSettings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', { configurable: true,
						value: () => ({ ...getSettings(), channelCount: destination.channelCount, sampleRate: context.sampleRate }) });
					return destination.stream;
				},
			} });
		});
		const editor = await bootEditor(page, '/embed/en/');
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Sound-activated recording', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		await page.keyboard.press('r');
		await expect(record).toHaveAttribute('aria-label', 'Pause recording');
		await record.click();
		await expect(record).toHaveAttribute('aria-label', 'Resume recording');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});

	test('keeps Soundscaper-only controls out of Framescaper preferences', async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(editor.getByRole('button', { name: 'Record options', exact: true })).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Playback\/Recording$/u }).click();
		await expect(preferences.locator('[data-sound-activation-settings]')).toHaveCount(0);
	});
});

async function expectCommittedSetting(panel, attribute, value) {
	await expect(panel).toHaveAttribute(attribute, value);
	await expect(panel).toHaveAttribute('data-sound-activation-pending', 'false');
}
