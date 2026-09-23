/* SPDX-License-Identifier: AGPL-3.0-only */

import { darkTheme } from '../../vendor/audacity-design-system/tokens/src/themes/dark.v2.ts';
import { lightTheme } from '../../vendor/audacity-design-system/tokens/src/themes/light.v2.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('desktop Preferences opens General and manages the display-only FFmpeg location', async ({ page }) => {
	await installDesktopFfmpegFixture(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const general = preferences.getByRole('tab', { name: /General$/u });
	await expect(preferences.getByRole('tab').first()).toHaveText(/General$/u);
	await expect(general).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('group', { name: 'Language', exact: true })).toBeVisible();
	const panel = preferences.locator('[data-external-ffmpeg-preference="true"]');
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'unconfigured');
	await expect(panel.getByLabel('FFmpeg location', { exact: true })).toHaveValue('No location selected');

	await panel.getByRole('button', { name: 'Browse', exact: true }).click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'ready');
	await expect(panel.getByLabel('FFmpeg location', { exact: true })).toHaveValue('/fixture/bin/ffmpeg');
	await expect(panel).toContainText('FFmpeg 9.0.1 is ready.');
	await panel.getByRole('button', { name: 'Clear', exact: true }).click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'unconfigured');
	await panel.getByRole('button', { name: 'Install', exact: true }).click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'ready');
	await panel.getByRole('button', { name: 'Rescan', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__externalFfmpegCalls)).toEqual([
		'get', 'choose', 'clear', 'install', 'rescan',
	]);

	await preferences.getByRole('tab', { name: /Appearance$/u }).click();
	await expect(preferences.getByRole('group', { name: 'Language', exact: true })).toHaveCount(0);
});

test('browser Preferences opens General without the desktop-only FFmpeg location', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('tab').first()).toHaveText(/General$/u);
	await expect(preferences.getByRole('tab', { name: /General$/u })).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('group', { name: 'Language', exact: true })).toBeVisible();
	await expect(preferences.locator('[data-external-ffmpeg-preference="true"]')).toHaveCount(0);
});

test('Track Display opens Waveform settings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const track = editor.locator('[data-track-row]').first();
	await chooseTrackMenuAction(page, editor, track, ['Display', 'Waveform settings']);

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const waveform = preferences.getByRole('tab', { name: /Waveform$/u });
	await expect(waveform).toHaveAttribute('aria-selected', 'true');
	const settings = preferences.locator('[data-waveform-visualization-settings]');
	await expect(settings.getByRole('spinbutton', { name: 'Low/mid crossover (Hz)', exact: true }))
		.toHaveValue('250');
	await expect(settings.getByRole('spinbutton', { name: 'Mid/high crossover (Hz)', exact: true }))
		.toHaveValue('4000');
});

for (const mode of ['Light', 'Dark']) {
	test(`${mode} Appearance uses flat sections, separators and design-system checkboxes`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const editor = await bootEditor(page, '/embed/en/');
		await page.emulateMedia({ colorScheme: mode.toLowerCase() });
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Appearance$/u }).click();
		await preferences.getByRole('radio', { name: mode, exact: true }).check();
		await expect(page.locator('html')).toHaveAttribute('data-theme', mode.toLowerCase());

		const theme = preferences.getByRole('heading', { name: 'Theme', exact: true }).locator('..');
		const clipStyle = preferences.getByRole('heading', { name: 'Clip style', exact: true }).locator('..');
		for (const section of [theme, clipStyle]) {
			await expect(section).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
			await expect(section).toHaveCSS('border-width', '0px');
			await expect(section).toHaveCSS('border-radius', '0px');
		}
		const separator = theme.locator('xpath=following-sibling::*[1]');
		await expect(separator).toHaveAttribute('role', 'separator');
		await expect(separator).toBeVisible();
		const palette = mode === 'Dark' ? darkTheme : lightTheme;
		const separatorColor = `rgb(${[1, 3, 5].map((offset) =>
			Number.parseInt(palette.border.onElevated.slice(offset, offset + 2), 16)).join(', ')})`;
		expect(await separator.evaluate((node) => {
			const line = getComputedStyle(node, '::after');
			return { height: line.height, color: line.backgroundColor };
		})).toEqual({ height: '1px', color: separatorColor });

		const checkbox = preferences.getByRole('checkbox', { name: 'Follow system theme', exact: true });
		await expect(checkbox).not.toBeChecked();
		await expect(checkbox).toHaveCSS('border-width', '0px');
		await expect(checkbox).toHaveCSS('outline-style', 'none');
		await preferences.screenshot({ path: testInfo.outputPath(`appearance-${mode}.png`) });
		const idleFill = await checkbox.evaluate((node) => getComputedStyle(node).backgroundColor);
		await checkbox.hover();
		await expect(checkbox).toHaveCSS('border-width', '0px');
		await expect(checkbox).not.toHaveCSS('background-color', idleFill);
		await page.mouse.move(0, 0);
		await page.keyboard.press('Tab');
		await checkbox.focus();
		await expect(checkbox).not.toHaveCSS('box-shadow', 'none');
		await page.keyboard.press('Space');
		await expect(checkbox).toBeChecked();
		await expect(checkbox.locator('.checkbox__icon')).toBeVisible();
		await expect(checkbox).toHaveCSS('border-width', '0px');
		await expect(checkbox).toHaveCSS('background-color', idleFill);
		await page.keyboard.press('Space');
		await expect(checkbox).not.toBeChecked();
	});
}

test('Program start chooses what the next session opens with', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const programStart = preferences.getByRole('radiogroup', { name: 'Program start', exact: true });
	await expect(programStart).toHaveAttribute('data-program-start', 'continue-last-session');
	await expect(programStart.getByRole('radio', { name: 'Continue last session', exact: true })).toBeChecked();

	await programStart.getByRole('radio', { name: 'Start with new project', exact: true }).check();
	await expect(programStart).toHaveAttribute('data-program-start', 'new-project');

	// The attribute mirrors the stored preference, so reopening the dialog is
	// what proves the choice reached the controller rather than the checkbox.
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await expect(preferences.getByRole('radiogroup', { name: 'Program start', exact: true }))
		.toHaveAttribute('data-program-start', 'new-project');
});

test("the Effects page rearranges the Effect menu the way Audacity's does", async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	let menu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(menu.getByRole('menuitem', { name: /^Volume and compression/u })).toBeVisible();
	await page.keyboard.press('Escape');

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	const organization = preferences.getByRole('group', { name: 'Effect menu organization', exact: true });
	await chooseDropdown(page, organization, 'Sort by effect name');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();

	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	menu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(menu.getByRole('menuitem', { name: /^Volume and compression/u })).toHaveCount(0);
	const amplify = menu.getByRole('menuitem', { name: /^Amplify(?: —|$)/u });
	await expect(amplify).toBeVisible();
	await expect(amplify).toBeDisabled();
	await page.keyboard.press('Escape');
});

async function installDesktopFfmpegFixture(page) {
	await page.addInitScript(() => {
		const calls = [];
		const status = (state, overrides = {}) => Object.freeze({
			state,
			location: null,
			version: null,
			detail: '',
			canInstall: state === 'unconfigured',
			canBrowse: true,
			canClear: state === 'ready',
			...overrides,
		});
		const ready = () => status('ready', {
			location: '/fixture/bin/ffmpeg',
			version: '9.0.1',
			detail: 'Fixture capability probes passed.',
		});
		Object.defineProperty(globalThis, '__externalFfmpegCalls', {
			configurable: true,
			value: calls,
		});
		const bridge = Object.freeze({
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			setLocale: async () => undefined,
			onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			getExternalFfmpegStatus: async () => { calls.push('get'); return status('unconfigured'); },
			chooseExternalFfmpeg: async () => { calls.push('choose'); return ready(); },
			clearExternalFfmpeg: async () => { calls.push('clear'); return status('unconfigured'); },
			installExternalFfmpeg: async () => { calls.push('install'); return ready(); },
			rescanExternalFfmpeg: async () => { calls.push('rescan'); return ready(); },
		});
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true,
			value: Object.freeze({ v1: bridge }),
		});
	});
}
