/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clickClipInterior, clipByName, collectClientErrors,
	importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const frame = async (playhead) => Number(await playhead.getAttribute('aria-valuenow'));
const playOptions = (editor) => editor.locator('[data-transport="play"]').getByRole('button', { name: /options$/u });
const menuItem = (menu, label) => menu.getByRole('menuitem').filter({ has: menu.page().locator('.context-menu-item-label', { hasText: new RegExp(`^${label}$`, 'u') }) });

test.describe('transport audition shortcuts', () => {
	registerAudioEditorHooks();

	test('C previews and P resumes a gap without an edit, and X stops at the audible position', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		const y = box.y + box.height * 0.55;
		await page.mouse.move(box.x + box.width * 0.3, y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.55, y, { steps: 6 });
		await page.mouse.up();
		const selection = editor.locator('[data-time-selection-overlay]').first();
		await expect(selection).toBeVisible();
		const selectionStyle = await selection.getAttribute('style');
		const selectionStart = await frame(playhead);
		const undo = editor.getByRole('button', { name: 'Undo', exact: true });
		const undoDisabled = await undo.isDisabled();
		await playOptions(editor).click();
		const menu = page.getByRole('menu', { name: 'Play options', exact: true });
		await expect(menuItem(menu, 'Cut preview').locator('.context-menu-item-shortcut')).toHaveText('C');
		await expect(menuItem(menu, 'Play/Stop and set cursor').locator('.context-menu-item-shortcut')).toHaveText('X');
		await expect(menuItem(menu, 'Pause').locator('.context-menu-item-shortcut')).toHaveText('P');
		await page.keyboard.press('Escape');
		await page.keyboard.press('c');
		await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(() => frame(playhead)).toBeLessThan(selectionStart);
		await page.keyboard.press('p');
		await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		const paused = await frame(playhead);
		await page.waitForTimeout(100);
		expect(await frame(playhead)).toBe(paused);
		await page.keyboard.press('p');
		await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(selection).toHaveAttribute('style', selectionStyle);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		expect(await undo.isDisabled()).toBe(undoDisabled);
		await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play', exact: true })).toBeVisible();

		await clickClipInterior(page, clip, 0.2);
		const cursorStart = await frame(playhead);
		await page.keyboard.press('x');
		await expect.poll(() => frame(playhead)).toBeGreaterThan(cursorStart + 1_000);
		await page.keyboard.press('x');
		await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		const stopped = await frame(playhead);
		expect(stopped).toBeGreaterThan(cursorStart + 1_000);
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(0);
		await page.waitForTimeout(100);
		expect(await frame(playhead)).toBe(stopped);
		expect(errors).toEqual([]);
	});

	test('P pauses and resumes recording, and the Record pause menu displays the same shortcut', async ({ page }) => {
		await page.addInitScript(() => {
			const mediaDevices = {
				enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'fixture', label: 'Fixture microphone' }],
				getUserMedia: async () => {
					const context = new AudioContext();
					const destination = context.createMediaStreamDestination();
					const oscillator = context.createOscillator();
					oscillator.frequency.value = 330;
					oscillator.connect(destination);
					oscillator.start();
					await context.resume();
					const [track] = destination.stream.getAudioTracks();
					const getSettings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', {
						configurable: true,
						value: () => ({ ...getSettings(), channelCount: destination.channelCount, sampleRate: context.sampleRate }),
					});
					return destination.stream;
				},
			};
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await record.click();
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		let menu = page.getByRole('dialog', { name: 'Record options', exact: true });
		await expect(menu.getByRole('button', { name: 'Pause recording' })).toHaveCount(0);
		await expect(menu.getByRole('button', { name: 'Resume recording' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await record.click();
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		menu = page.getByRole('dialog', { name: 'Record options', exact: true });
		await expect(menu.getByRole('button', { name: 'Pause recording' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		expect(errors).toEqual([]);
	});
});
