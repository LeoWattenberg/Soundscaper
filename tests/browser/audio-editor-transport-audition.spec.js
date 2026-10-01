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

	test('Play options close when their trigger is activated again', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const trigger = playOptions(editor);
		const menu = page.getByRole('menu', { name: 'Play options', exact: true });

		await trigger.click();
		await expect(menu).toBeVisible();
		await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect(menu).toHaveCount(0);

		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(menu).toBeVisible();
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(menu).toHaveCount(0);
	});

	test('W plays the selection and Stop returns to its nonzero start', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		const y = box.y + box.height * 0.55;
		await page.mouse.move(box.x + box.width * 0.2, y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.4, y, { steps: 6 });
		await page.mouse.up();
		const selection = editor.locator('[data-time-selection-overlay]').first();
		await expect(selection).toBeVisible();
		const selectionStyle = await selection.getAttribute('style');
		const selectionStart = await frame(playhead);
		expect(selectionStart).toBeGreaterThan(0);
		await playOptions(editor).click();
		const menu = page.getByRole('menu', { name: 'Play options', exact: true });
		await expect(menuItem(menu, 'Play selection').locator('.context-menu-item-shortcut')).toHaveText('W');
		await page.keyboard.press('Escape');
		await page.keyboard.press('w');
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(() => frame(playhead)).toBeGreaterThan(selectionStart + 1_000);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect.poll(() => frame(playhead)).toBe(selectionStart);
		await expect(selection).toHaveAttribute('style', selectionStyle);

		await page.keyboard.press('w');
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(selection).toHaveAttribute('style', selectionStyle);
		expect(errors).toEqual([]);
	});

	for (const stopWith of ['Stop button', 'Space']) {
		test(`${stopWith} returns to the current playback start`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [longTone]);
			const clip = clipByName(editor, longTone.name);
			const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
			for (const position of [0.2, 0.4]) {
				await clickClipInterior(page, clip, position);
				const start = await frame(playhead);
				expect(start).toBeGreaterThan(0);
				await page.keyboard.press('Space');
				await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
				await expect.poll(() => frame(playhead)).toBeGreaterThan(start + 1_000);
				if (stopWith === 'Stop button') await editor.getByRole('button', { name: 'Stop', exact: true }).click();
				else await page.keyboard.press('Space');
				await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
				await expect.poll(() => frame(playhead)).toBe(start);
			}
			expect(errors).toEqual([]);
		});
	}

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

	test('P pauses and resumes recording, and the Play menu displays the same shortcut', async ({ page }) => {
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
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => frame(playhead)).toBeGreaterThan(48_000);
		await page.keyboard.press('p');
		await expect(record).toHaveAccessibleName('Resume recording');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		let menu = page.getByRole('dialog', { name: 'Record options', exact: true });
		await expect(menu.getByRole('button', { name: 'Pause recording' })).toHaveCount(0);
		await expect(menu.getByRole('button', { name: 'Resume recording' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await playOptions(editor).click();
		let playMenu = page.getByRole('menu', { name: 'Play options', exact: true });
		await expect(menuItem(playMenu, 'Resume recording').locator('.context-menu-item-shortcut')).toHaveText('P');
		await page.keyboard.press('Escape');
		const paused = await frame(playhead);
		await page.keyboard.press('p');
		await expect(record).toHaveAccessibleName('Pause recording');
		await expect.poll(() => frame(playhead)).toBeGreaterThan(paused + 48_000);
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		menu = page.getByRole('dialog', { name: 'Record options', exact: true });
		await expect(menu.getByRole('button', { name: 'Pause recording' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await playOptions(editor).click();
		playMenu = page.getByRole('menu', { name: 'Pause options', exact: true });
		await expect(menuItem(playMenu, 'Pause recording').locator('.context-menu-item-shortcut')).toHaveText('P');
		await page.keyboard.press('Escape');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		expect(errors).toEqual([]);
	});
});
