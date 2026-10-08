/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, clipByName,
	collectClientErrors, getMenuItem, importFiles, openNestedCommandMenu,
	registerAudioEditorHooks, setDocumentTheme,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

registerAudioEditorHooks();

test('ordinary waveforms keep dark traces on colored clip bodies', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	// Base and selected body colors from the committed Audacity light/dark themes.
	const expectedBodies = {
		light: { Red: ['rgb(255, 148, 150)', 'rgb(255, 220, 230)'], Green: ['rgb(124, 205, 112)', 'rgb(176, 255, 194)'] },
		dark: { Red: ['rgb(246, 178, 178)', 'rgb(255, 218, 218)'], Green: ['rgb(170, 216, 155)', 'rgb(198, 255, 179)'] },
	};
	for (const theme of ['light', 'dark']) {
		await setDocumentTheme(page, theme);
		for (const color of ['Red', 'Green']) {
			await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
			await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Clip color/ }).hover();
			await page.getByRole('menuitem', { name: color, exact: true }).click();
			const body = clip.locator('.clip-body');
			const selected = await body.evaluate((element) => element.classList.contains('clip-body--selected'));
			await expect(body).toHaveCSS('background-color', expectedBodies[theme][color][selected ? 1 : 0]);
			const trace = await clip.locator('canvas.clip-body__waveform').evaluate((canvas) => (
				Array.from(canvas.getContext('2d').getImageData(20, Math.floor(canvas.height / 4) - 3, 1, 1).data)
			));
			expect(trace[3]).toBe(255);
			expect(Math.max(...trace.slice(0, 3))).toBeLessThan(80);
		}
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
				await chooseTrackMenuAction(page, editor, track, ['Track visualization', mode]);
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
		await chooseTrackMenuAction(page, editor, track, ['Track visualization', mode]);
		await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');
		await waveform.evaluate((canvas) => {
			const state = { running: true, frames: 0, blankFrames: 0 };
			globalThis.__waveformZoomFrames = state;
			const sample = () => {
				if (!state.running) return;
				const current = canvas.closest('[data-clip-id]')?.querySelector('canvas.clip-body__waveform');
				if (current?.width > 4 && current.height > 4) {
					const context = current.getContext('2d');
					// Probe both channel bodies away from their zero lines: a center
					// line surviving an otherwise blank redraw must not satisfy this.
					const channelPainted = [0, 1].map((channel) => {
						const top = Math.floor(current.height * channel / 2);
						const row = context.getImageData(0, top + Math.floor(current.height / 4) - 3, current.width, 1).data;
						// The fixture has headroom. Compare its empty top margin too,
						// so selection shading cannot masquerade as waveform pixels.
						const background = context.getImageData(0, top + 3, current.width, 1).data;
						return row.some((alpha, index) => index % 4 === 3 && alpha > 0
							&& (alpha !== background[index] || row[index - 1] !== background[index - 1]
								|| row[index - 2] !== background[index - 2] || row[index - 3] !== background[index - 3]));
					});
					state.frames++;
					if (channelPainted.includes(false)) state.blankFrames++;
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
	await chooseTrackMenuAction(page, editor, track, ['Track visualization', '3-band waveform']);
	await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Half-wave']);
	await expect(track).toHaveAttribute('data-display-mode', 'waveform-three-band');
	await expect(clip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	const waveform = clip.locator('canvas.clip-body__waveform');
	await expect(waveform).toHaveAttribute('data-frequency-waveform-mode', 'waveform-three-band');
	await expect(waveform).not.toHaveAttribute('data-waveform-pending');
	const withoutRms = await waveform.evaluate(waveformChecksum);
	await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Show RMS in waveform']);
	await expect.poll(() => waveform.evaluate(waveformChecksum)).not.toBe(withoutRms);
	const withRms = await waveform.evaluate(waveformChecksum);
	await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Show RMS in waveform']);
	await expect.poll(() => waveform.evaluate(waveformChecksum)).not.toBe(withRms);
	await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Half-wave']);
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

test('Waveform preferences share RMS with View and persist ruler and half-wave defaults', async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 1000 });
	let editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const waveform = clip.locator('canvas.clip-body__waveform');
	await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');
	await expect(waveform).not.toHaveAttribute('data-waveform-pending');
	const beforeRulerZoom = await waveform.evaluate(waveformChecksum);
	await track.locator('[data-track-ruler]').click({ button: 'right', position: { x: 20, y: 70 } });
	const rulerMenu = page.locator('.audio-editor-ruler-flyout');
	await rulerMenu.getByRole('button', { name: 'Zoom in', exact: true }).click();
	await expect(track.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-zoom', '1');
	await page.keyboard.press('Escape');
	await expect(rulerMenu).toBeHidden();
	// The ruler updates before its animation-frame canvas redraw.
	await expect.poll(() => waveform.evaluate(waveformChecksum)).not.toBe(beforeRulerZoom);
	const withoutRms = await waveform.evaluate(waveformChecksum);
	let preferences = await openTrackDisplayPreferences(page, editor);
	await expect(preferences.getByRole('heading', { name: '3-band waveform', exact: true })).toBeVisible();
	await expect(preferences.getByRole('heading', { name: 'Frequency visualization', exact: true })).toHaveCount(0);
	await expect(preferences.getByText('Choose the crossover frequencies used by 3-band waveforms.', { exact: true }))
		.toHaveCount(0);
	const waveformSection = preferences.getByRole('heading', { name: 'Waveform', exact: true }).locator('..');
	const defaultView = preferences.getByRole('group', { name: 'Default view', exact: true });
	await chooseDropdown(page, defaultView, 'Half-wave');
	const halfWaveDefault = waveformSection.getByRole('checkbox', { name: 'Half-wave', exact: true });
	await expect(halfWaveDefault).toHaveAttribute('aria-checked', 'true');
	await expect(clip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	await halfWaveDefault.click();
	await expect(defaultView.getByRole('button')).toContainText('Waveform');
	await expect(clip.locator('.clip-body')).not.toHaveAttribute('data-half-wave');
	const rms = waveformSection.getByRole('checkbox', { name: 'Show RMS', exact: true });
	await expect(rms).toHaveAttribute('aria-checked', 'false');
	await rms.click();
	await closeTrackDisplayPreferences(preferences);
	await expect.poll(() => waveform.evaluate(waveformChecksum)).not.toBe(withoutRms);
	const view = await openNestedCommandMenu(page, editor, 'View', []);
	await expect(getMenuItem(view, 'RMS in waveform')).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'View', 'RMS in waveform');
	await expect.poll(() => waveform.evaluate(waveformChecksum)).toBe(withoutRms);
	preferences = await openTrackDisplayPreferences(page, editor);
	await expect(preferences.getByRole('checkbox', { name: 'Show RMS', exact: true }))
		.toHaveAttribute('aria-checked', 'false');
	await preferences.getByRole('checkbox', { name: 'Show RMS', exact: true }).click();
	const formats = preferences.getByRole('group', { name: 'Ruler format', exact: true });
	for (const [label, format, scale] of [
		['Linear amp', 'linear-amp', 'linear'],
		['Linear dB', 'linear-db', 'linear'],
		['Logarithmic dB', 'logarithmic-db', 'db'],
	]) {
		await chooseDropdown(page, formats, label);
		await expect(track.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-format', format);
		await expect(track.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-zoom', '1');
		await expect(waveform).toHaveAttribute('data-waveform-amplitude-scale', scale);
	}
	await preferences.getByRole('checkbox', { name: 'Half-wave', exact: true }).click();
	await expect(clip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	await closeTrackDisplayPreferences(preferences);

	editor = await bootEditor(page, '/embed/en/');
	preferences = await openTrackDisplayPreferences(page, editor);
	await expect(preferences.getByRole('checkbox', { name: 'Show RMS', exact: true }))
		.toHaveAttribute('aria-checked', 'true');
	await expect(preferences.getByRole('checkbox', { name: 'Half-wave', exact: true }))
		.toHaveAttribute('aria-checked', 'true');
	await expect(preferences.getByRole('group', { name: 'Ruler format', exact: true }).getByRole('button'))
		.toContainText('Logarithmic dB');
	await closeTrackDisplayPreferences(preferences);
	const newTone = createWavFixture({ name: 'waveform-preferences-reloaded.wav', frequency: 330 });
	await importFiles(editor, [newTone]);
	const newClip = clipByName(editor, newTone.name);
	await expect(newClip.locator('xpath=ancestor::div[@data-track-row]').locator('[data-track-ruler]'))
		.toHaveAttribute('data-ruler-format', 'logarithmic-db');
	await expect(newClip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	await expect(newClip.locator('canvas.clip-body__waveform')).toHaveAttribute('data-waveform-amplitude-scale', 'db');
});

test('Waveform preferences preserve individual ruler, half-wave and RMS overrides', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const editor = await bootEditor(page, '/embed/en/');
	const overriddenTone = createWavFixture({ name: 'waveform-track-override.wav', frequency: 330 });
	await importFiles(editor, [toneA, overriddenTone]);
	const defaultClip = clipByName(editor, toneA.name);
	const overrideClip = clipByName(editor, overriddenTone.name);
	const overrideTrack = overrideClip.locator('xpath=ancestor::div[@data-track-row]');
	await overrideTrack.locator('[data-track-ruler]').click({ button: 'right', position: { x: 20, y: 70 } });
	const rulerMenu = page.locator('.audio-editor-ruler-flyout');
	await rulerMenu.getByRole('radio', { name: 'Linear (amp)', exact: true }).click();
	const halfWave = rulerMenu.getByRole('checkbox', { name: 'Half wave', exact: true });
	await halfWave.click();
	await halfWave.click();
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, overrideTrack, ['Track visualization', 'Show RMS in waveform']);
	await chooseTrackMenuAction(page, editor, overrideTrack, ['Track visualization', 'Show RMS in waveform']);
	const overrideWaveform = overrideClip.locator('canvas.clip-body__waveform');
	const overrideChecksum = await overrideWaveform.evaluate(waveformChecksum);
	const preferences = await openTrackDisplayPreferences(page, editor);
	await preferences.getByRole('checkbox', { name: 'Show RMS', exact: true }).click();
	await preferences.getByRole('checkbox', { name: 'Half-wave', exact: true }).click();
	await chooseDropdown(page, preferences.getByRole('group', { name: 'Ruler format', exact: true }), 'Logarithmic dB');
	await closeTrackDisplayPreferences(preferences);
	await expect(defaultClip.locator('xpath=ancestor::div[@data-track-row]').locator('[data-track-ruler]'))
		.toHaveAttribute('data-ruler-format', 'logarithmic-db');
	await expect(defaultClip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	await expect(defaultClip.locator('canvas.clip-body__waveform')).toHaveAttribute('data-waveform-amplitude-scale', 'db');
	await expect(overrideTrack.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-format', 'linear-amp');
	await expect(overrideClip.locator('.clip-body')).not.toHaveAttribute('data-half-wave');
	await expect(overrideWaveform).toHaveAttribute('data-waveform-amplitude-scale', 'linear');
	await expect.poll(() => overrideWaveform.evaluate(waveformChecksum)).toBe(overrideChecksum);
});

async function openTrackDisplayPreferences(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	return preferences;
}

async function closeTrackDisplayPreferences(preferences) {
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
}

function waveformChecksum(canvas) {
	const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
	let checksum = 2_166_136_261;
	for (const value of pixels) checksum = Math.imul(checksum ^ value, 16_777_619) >>> 0;
	return checksum;
}
