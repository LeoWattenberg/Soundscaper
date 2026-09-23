/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, clipByName,
	collectClientErrors, importFiles, registerAudioEditorHooks, setDocumentTheme,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

registerAudioEditorHooks();

test('ordinary waveforms keep dark traces on colored clip bodies', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	for (const theme of ['light', 'dark']) {
		await setDocumentTheme(page, theme);
		const backgrounds = [];
		for (const color of ['Red', 'Green']) {
			await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
			await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Clip color/ }).hover();
			await page.getByRole('menuitem', { name: color, exact: true }).click();
			backgrounds.push(await clip.locator('.clip-body').evaluate((element) => getComputedStyle(element).backgroundColor));
			const trace = await clip.locator('canvas.clip-body__waveform').evaluate((canvas) => (
				Array.from(canvas.getContext('2d').getImageData(20, Math.floor(canvas.height / 4) - 3, 1, 1).data)
			));
			expect(trace[3]).toBe(255);
			expect(Math.max(...trace.slice(0, 3))).toBeLessThan(80);
		}
		expect(backgrounds[0]).not.toBe(backgrounds[1]);
	}
});

test('frequency views retain neutral clip bodies across skins, themes, and clip colors', async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const body = clip.locator('.clip-body');
	for (const skin of ['default', 'high-contrast', 'sakura', 'lilac', 'techno']) {
		await page.evaluate((skin) => {
			history.replaceState(null, '', `?useskin=${skin}`);
			window.dispatchEvent(new PopStateEvent('popstate'));
		}, skin);
		await expect(editor).toHaveAttribute('data-editor-skin', skin);
		for (const theme of ['light', 'dark']) {
			await setDocumentTheme(page, theme);
			for (const mode of ['3-band waveform', 'Rainbow waveform']) {
				await chooseTrackMenuAction(page, editor, track, ['Display', mode]);
				await expect(clip.locator('canvas.clip-body__waveform')).toHaveAttribute('data-waveform-source', 'frequency-analysis');
				const backgrounds = [];
				for (const color of ['Red', 'Green']) {
					await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
					await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Clip color/ }).hover();
					await page.getByRole('menuitem', { name: color, exact: true }).click();
					await expect(body).toHaveAttribute('data-color', color.toLowerCase());
					backgrounds.push(await body.evaluate((element) => getComputedStyle(element).backgroundColor));
				}
				expect(backgrounds[0]).toBe(backgrounds[1]);
				const rgb = backgrounds[0].match(/[\d.]+/gu).map(Number).slice(0, 3);
				expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThanOrEqual(20);
				if (theme === 'dark') expect(Math.max(...rgb)).toBeLessThan(80);
				else expect(Math.min(...rgb)).toBeGreaterThan(200);
			}
			await page.screenshot({ path: testInfo.outputPath(`frequency-${skin}-${theme}.png`) });
		}
	}
	expect(errors).toEqual([]);
});

test('zoom keeps painted waveforms and switches 3-band to ordinary samples', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const tone = createWavFixture({ name: 'zoom-display.wav', frequency: 440, duration: 8 });
	await importFiles(editor, [tone]);
	const clip = clipByName(editor, tone.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const waveform = clip.locator('canvas.clip-body__waveform');
	const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
	const zoomOut = editor.getByRole('button', { name: 'Zoom out', exact: true });
	for (const mode of ['Waveform', '3-band waveform', 'Rainbow waveform']) {
		await chooseTrackMenuAction(page, editor, track, ['Display', mode]);
		await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');
		await waveform.evaluate((canvas) => {
			const state = { running: true, frames: 0, blankFrames: 0 };
			globalThis.__waveformZoomFrames = state;
			const sample = () => {
				if (!state.running) return;
				const current = canvas.closest('[data-clip-id]')?.querySelector('canvas.clip-body__waveform');
				if (current?.width > 4 && current.height > 4) {
					const context = current.getContext('2d');
					const row = context.getImageData(0, Math.floor(current.height / 4), current.width, 1).data;
					state.frames++;
					if (!row.some((value, index) => index % 4 === 3 && value > 0)) state.blankFrames++;
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});
		for (let step = 0; step < 9; step++) await zoomIn.click();
		if (mode === '3-band waveform') {
			await expect(waveform).toHaveAttribute('data-waveform-mode', /connecting-dots|stem/u);
			await expect(waveform).toHaveAttribute('data-waveform-source', 'pcm');
			await expect(waveform).not.toHaveAttribute('data-frequency-waveform-mode');
		}
		for (let step = 0; step < 9; step++) await zoomOut.click();
		await expect(waveform).toHaveAttribute('data-waveform-mode', 'summary');
		const frames = await page.evaluate(() => {
			const state = globalThis.__waveformZoomFrames;
			state.running = false;
			return state;
		});
		expect(frames.frames).toBeGreaterThan(0);
		expect(frames.blankFrames, `${mode}: ${JSON.stringify(frames)}`).toBe(0);
	}
	expect(errors).toEqual([]);
});

test('track display combines half-wave and RMS with a frequency view', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await chooseTrackMenuAction(page, editor, track, ['Display', '3-band waveform']);
	await chooseTrackMenuAction(page, editor, track, ['Display', 'Half-wave']);
	await expect(track).toHaveAttribute('data-display-mode', 'waveform-three-band');
	await expect(clip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	const waveform = clip.locator('canvas.clip-body__waveform');
	const withoutRms = await waveform.evaluate(waveformChecksum);
	await chooseTrackMenuAction(page, editor, track, ['Display', 'Show RMS in waveform']);
	await expect.poll(() => waveform.evaluate(waveformChecksum)).not.toBe(withoutRms);
	await chooseTrackMenuAction(page, editor, track, ['Display', 'Show RMS in waveform']);
	await expect.poll(() => waveform.evaluate(waveformChecksum)).toBe(withoutRms);
	await chooseTrackMenuAction(page, editor, track, ['Display', 'Half-wave']);
	await expect(clip.locator('.clip-body')).not.toHaveAttribute('data-half-wave');
	await expect(clip.locator('canvas.clip-body__waveform')).toHaveAttribute('data-frequency-waveform-mode', 'waveform-three-band');
});

test('Track display owns all six default views and persists the choice', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	let preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Appearance$/u }).click();
	await expect(preferences.getByRole('group', { name: 'Default view', exact: true })).toHaveCount(0);
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const defaults = preferences.getByRole('group', { name: 'Default view', exact: true });
	for (const view of ['Spectrogram', 'Multi-view', 'Half-wave', '3-band waveform', 'Waveform', 'Rainbow waveform']) {
		await chooseDropdown(page, defaults, view);
	}
	editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await expect(clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]'))
		.toHaveAttribute('data-display-mode', 'waveform-rainbow');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	await expect(preferences.getByRole('group', { name: 'Default view', exact: true }).getByRole('button'))
		.toContainText('Rainbow waveform');
});

function waveformChecksum(canvas) {
	const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
	let checksum = 2_166_136_261;
	for (const value of pixels) checksum = Math.imul(checksum ^ value, 16_777_619) >>> 0;
	return checksum;
}
