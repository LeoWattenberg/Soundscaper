/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
} from './audio-editor-test-helpers.js';

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
	await expect(menu.getByRole('menuitem', { name: 'Amplify', exact: true })).toBeVisible();
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
