/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Audio settings edits the visible Default input after an unsaved offset source is unplugged', async ({ page }) => {
	await page.addInitScript(() => {
		const events = new EventTarget();
		const usbStreams = [];
		let devices = [{ kind: 'audioinput', deviceId: 'usb-offset-mic', groupId: 'usb', label: 'USB offset microphone' }];
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
			enumerateDevices: async () => devices,
			getUserMedia: async ({ audio }) => {
				const usb = audio?.deviceId?.exact === 'usb-offset-mic';
				if (usb && devices.length === 0) throw new DOMException('The microphone is unplugged.', 'NotFoundError');
				const stream = new AudioContext().createMediaStreamDestination().stream;
				if (usb) usbStreams.push(stream);
				return stream;
			},
			addEventListener: events.addEventListener.bind(events),
			removeEventListener: events.removeEventListener.bind(events),
		} });
		globalThis.__unplugOffsetMic = () => {
			devices = [];
			for (const stream of usbStreams) for (const track of stream.getTracks()) track.stop();
			events.dispatchEvent(new Event('devicechange'));
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	await preferences.getByRole('button', { name: 'Refresh devices', exact: true }).click();
	const source = preferences.getByRole('combobox', { name: 'Recording source', exact: true });
	const offset = preferences.getByRole('spinbutton', { name: 'Recording offset (ms)', exact: true });
	await offset.fill('10');
	await offset.press('Tab');
	await source.selectOption('device:usb-offset-mic');
	await expect(offset).toHaveValue('0');
	await page.evaluate(() => globalThis.__unplugOffsetMic());
	await preferences.getByRole('button', { name: 'Refresh devices', exact: true }).click();
	await expect(source.locator('option[value="device:usb-offset-mic"]')).toHaveCount(0);
	await expect(source).toHaveValue('global');
	await expect(offset).toHaveValue('10');
	await offset.fill('25');
	await offset.press('Tab');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	await expect(offset).toHaveValue('25');
	await expect(source.locator('option[value="device:usb-offset-mic"]')).toHaveCount(0);
});

test('desktop FFmpeg Browse can retry a failed native chooser without discarding its configuration', async ({ page }) => {
	await page.addInitScript(() => {
		const ready = { state: 'ready', location: '/fixture/bin/ffmpeg', version: '9.0.1', detail: '',
			canInstall: false, canBrowse: true, canClear: true };
		let attempts = 0;
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			setLocale: async () => undefined,
			onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			getExternalFfmpegStatus: async () => ready,
			chooseExternalFfmpeg: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error('The file chooser could not open.');
				return ready;
			},
			clearExternalFfmpeg: async () => ready,
			rescanExternalFfmpeg: async () => ready,
		} } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const panel = page.getByRole('dialog', { name: 'Editor preferences', exact: true })
		.locator('[data-external-ffmpeg-preference]');
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'ready');
	const browse = panel.getByRole('button', { name: 'Browse', exact: true });
	await browse.click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'error');
	await expect(panel).toContainText('The file chooser could not open.');
	await expect(browse).toBeEnabled();
	await expect(panel.getByLabel('FFmpeg location', { exact: true })).toHaveValue('/fixture/bin/ffmpeg');
	await browse.click();
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'ready');
});

test('closing singleton History with its keyboard menu keeps the playhead keyboard workflow', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'History');
	const panel = editor.locator('[data-workspace-panel="history"]');
	const menu = panel.getByRole('button', { name: 'Panel menu: History', exact: true });
	await menu.focus();
	await menu.press('Enter');
	const context = editor.locator('.kw-audio-editor__workspace-panel-menu[role="menu"]');
	await context.getByRole('menuitem', { name: 'Close', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(panel).toHaveCount(0);
	const playhead = editor.locator('[data-editor-tool-toolbar] [data-time-display] .timecode').first();
	await expect(playhead).toBeFocused();
	await playhead.press('Tab');
	await expect(playhead).not.toBeFocused();
});
