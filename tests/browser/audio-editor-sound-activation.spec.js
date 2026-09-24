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
		await expect(options.getByRole('button', { name: 'Record loop into takes' })).toBeVisible();
		await expect(options.getByRole('button', { name: 'Timed recording' })).toBeVisible();
		await expect(options.getByRole('checkbox', { name: 'Lead-in time' })).toBeVisible();
		await expect(options.getByRole('checkbox', { name: 'Monitor input' })).toBeVisible();
		await expectRecordFlyoutRows(options);
		const settingsButton = options.getByRole('button', { name: 'Sound activation', exact: true });
		await settingsButton.click();

		const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
		const panel = settings.locator('[data-sound-activation-settings]');
		const threshold = panel.getByRole('slider', { name: 'Activation threshold', exact: true });
		const hysteresis = panel.getByRole('slider', { name: 'Release hysteresis', exact: true });
		const hold = panel.locator('[data-sound-activation-hold] input');
		const timestamps = panel.getByRole('checkbox', { name: 'Add timestamps', exact: true });
		await expect(panel).toBeVisible();
		await expect(timestamps).not.toBeChecked();
		const emptyStatus = panel.locator('.kw-audio-editor-sound-activation__status');
		await expect(emptyStatus).toHaveCSS('border-inline-start-width', '0px');
		const emptyStatusBox = await emptyStatus.boundingBox();
		expect(emptyStatusBox).not.toBeNull();
		expect(emptyStatusBox.width).toBeLessThanOrEqual(1);
		expect(emptyStatusBox.height).toBeLessThanOrEqual(1);
		await expect(settingsButton).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(settings).toBeHidden();
		await expect(options).toBeVisible();
		await settingsButton.click();
		await expect(settings).toBeVisible();
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
		await timestamps.click();
		await expect(timestamps).toBeChecked();
		await expectCommittedSetting(panel, 'data-sound-activation-add-timestamps', 'true');
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
		await expect(restored.getByRole('checkbox', { name: 'Add timestamps', exact: true })).toBeChecked();
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
		const trackCount = Number(await editor.getAttribute('data-track-count'));
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Record to new track', exact: true }).click();
		await expect(editor).toHaveAttribute('data-track-count', String(trackCount + 1));
		await expect(record).toHaveAttribute('aria-label', 'Pause recording');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});

	test('adds one project-time label for each sound activation when timestamps are enabled', async ({ page }) => {
		test.setTimeout(45_000);
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
				enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'fixture', label: 'Fixture microphone' }],
				getUserMedia: async () => {
					const context = new AudioContext();
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					const destination = context.createMediaStreamDestination();
					gain.gain.value = 0;
					oscillator.connect(gain).connect(destination);
					oscillator.start();
					await context.resume();
					globalThis.__soundActivationTestInput = { context, gain };
					const [track] = destination.stream.getAudioTracks();
					const getSettings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', { configurable: true,
						value: () => ({ ...getSettings(), channelCount: 1, sampleRate: context.sampleRate, latency: 0 }) });
					return destination.stream;
				},
			} });
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		const options = page.getByRole('dialog', { name: 'Record options', exact: true });
		await options.getByRole('button', { name: 'Sound activation', exact: true }).click();
		await page.getByRole('dialog', { name: 'Sound activation', exact: true })
			.getByRole('checkbox', { name: 'Add timestamps', exact: true }).click();
		await expectCommittedSetting(page.locator('[data-sound-activation-settings]'),
			'data-sound-activation-add-timestamps', 'true');
		const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
		if (await settings.isVisible()) await page.keyboard.press('Escape');
		if (!(await options.isVisible())) {
			await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		}
		await options.getByRole('button', { name: 'Sound-activated recording', exact: true }).click();
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const pulseEndTime = await page.evaluate(() => {
			const { context, gain } = globalThis.__soundActivationTestInput;
			const startTime = context.currentTime + 0.1;
			// The silent gap exceeds the default 250 ms hold, causing a second trigger.
			gain.gain.setValueAtTime(0.2, startTime);
			gain.gain.setValueAtTime(0, startTime + 0.65);
			gain.gain.setValueAtTime(0.2, startTime + 1.3);
			gain.gain.setValueAtTime(0, startTime + 1.95);
			return startTime + 1.95;
		});
		await expect.poll(() => page.evaluate(() => globalThis.__soundActivationTestInput.context.currentTime))
			.toBeGreaterThan(pulseEndTime + 0.25);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		const labels = editor.locator('[data-label-track] [data-label-id]');
		await expect(labels).toHaveCount(2, { timeout: 20_000 });
		await expect(labels.first()).toHaveAttribute('data-point-label', 'true');
		await expect(labels.last()).toHaveAttribute('data-point-label', 'true');
		const titles = await labels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
		const timestamps = titles.map((title) => title?.match(/\d{2}:\d{2}:\d{2}\.\d{3}/u)?.[0]);
		expect(timestamps).toHaveLength(2);
		for (const timestamp of timestamps) expect(timestamp).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/u);
		expect(timestamps[1] > timestamps[0]).toBe(true);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(labels).toHaveCount(0);
		expect(errors).toEqual([]);
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

async function expectRecordFlyoutRows(options) {
	const rows = [
		['Record to new track', 'Record loop into takes'],
		['Timed recording', 'Sound-activated recording'],
	];
	let previousY = -Infinity;
	for (const [leftName, rightName] of rows) {
		const left = await options.getByRole('button', { name: leftName, exact: true }).boundingBox();
		const right = await options.getByRole('button', { name: rightName, exact: true }).boundingBox();
		expect(left).not.toBeNull();
		expect(right).not.toBeNull();
		expect(Math.abs(left.y - right.y)).toBeLessThan(2);
		expect(left.x + left.width).toBeLessThan(right.x);
		expect(left.y).toBeGreaterThan(previousY);
		previousY = left.y;
	}
	const leadIn = await options.getByRole('checkbox', { name: 'Lead-in time' }).boundingBox();
	const monitor = await options.getByRole('checkbox', { name: 'Monitor input' }).boundingBox();
	expect(Math.abs(leadIn.y - monitor.y)).toBeLessThan(2);
	expect(leadIn.x).toBeLessThan(monitor.x);
	expect(leadIn.y).toBeGreaterThan(previousY);
	for (const name of ['Lead-in time', 'Monitor input']) {
		const checkbox = options.getByRole('checkbox', { name, exact: true });
		const row = checkbox.locator('..');
		await expect(row).toHaveCSS('border-top-width', '0px');
		await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		expect(await checkbox.evaluate((node) => node.closest('button'))).toBeNull();
	}
}
