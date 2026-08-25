/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
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

test('browser Preferences keeps Shortcuts as its default and has no General page', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('tab').first()).toHaveText(/Appearance$/u);
	await expect(preferences.getByRole('tab', { name: /Keyboard shortcuts$/u })).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('tab', { name: /General$/u })).toHaveCount(0);
	await expect(preferences.locator('[data-external-ffmpeg-preference="true"]')).toHaveCount(0);
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
