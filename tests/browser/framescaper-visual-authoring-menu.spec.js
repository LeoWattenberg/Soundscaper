/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { clipByName } from './audio-editor-clip-locators.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clickClipInterior,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

const CFR_VIDEO = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==',
	'base64',
);
const UI_TIMEOUT = 60_000;
const UI_OPTIONS = { timeout: UI_TIMEOUT };

test.describe('Framescaper visual authoring menus', () => {
	test.describe.configure({ timeout: 180_000 });

	test.beforeEach(async ({ page }) => {
		page.setDefaultTimeout(UI_TIMEOUT);
	});

	test('owns visual authoring only through existing menus', async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');

		await editor.getByRole('menuitem', { name: 'Tracks', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Tracks', exact: true })
			.getByRole('menuitem', { name: /^Add Video Adjustment Layer/u })).toBeVisible();
		await page.keyboard.press('Escape');

		await editor.getByRole('menuitem', { name: 'Generate', exact: true }).click();
		await expect(page.getByRole('menu', { name: 'Generate', exact: true })
			.getByRole('menuitem', { name: /^Video Generators/u })).toBeVisible();
		await page.keyboard.press('Escape');

		await editor.getByRole('menuitem', { name: 'Effect', exact: true }).click();
		const effect = page.getByRole('menu', { name: 'Effect', exact: true });
		await expect(effect.getByRole('menuitem', { name: /^Video Transitions/u })).toBeVisible();
		await expect(effect.getByRole('menuitem', { name: /^Edit Video Mask\/Matte/u })).toBeVisible();
		await expect(effect.getByRole('menuitem', { name: /^Freeze Video/u })).toBeVisible();
		await expect(editor.getByRole('button', {
			name: /Add (?:Still|Title|Text|Shape|Solid|Test Image|Noise|Sound Visualizer|Video Adjustment Layer)/u,
		})).toHaveCount(0);
	});

	test('authors every generator and checks the image picker in Chromium', async ({
		browserName,
		page,
	}) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const generators = [
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle'], 'Title'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoText'], 'Text'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoShape'], 'Shape'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoSolid'], 'Solid'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTestImage'], 'Test Image'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoNoise'], 'Noise'],
		];
		for (const [action, clipName] of generators) {
			await chooseNestedCommandAction(
				page, editor, 'Generate', ['Video Generators', action], UI_OPTIONS,
			);
			const clip = editor.getByRole('group', {
				name: `Video clip: ${clipName}`, exact: true,
			});
			await expect(clip).toHaveCount(1, UI_OPTIONS);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', UI_OPTIONS);
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(clip).toHaveCount(0, UI_OPTIONS);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', UI_OPTIONS);
		}
		if (browserName !== 'chromium') {
			expect(clientErrors).toEqual([]);
			return;
		}

		let choosingFile = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(
			page,
			editor,
			'Generate',
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']],
			UI_OPTIONS,
		);
		await (await choosingFile).setFiles([]);
		await expect(editor.getByRole('group', { name: /^Image clip:/u })).toHaveCount(0);

		choosingFile = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(
			page,
			editor,
			'Generate',
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']],
			UI_OPTIONS,
		);
		await (await choosingFile).setFiles({
			name: 'menu-poster.png', mimeType: 'image/png', buffer: PNG,
		});
		await expect(editor.getByRole('group', {
			name: 'Image clip: menu-poster', exact: true,
		})).toBeVisible(UI_OPTIONS);
		expect(clientErrors).toEqual([]);
	});

	test('edits generated test images and noise through the selected visual inspector', async ({
		browserName, page,
	}) => {
		await installWebkitPreviewFrameDigest(page, browserName);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		test.skip(!await page.evaluate(hasWebGl2Capability), 'The exact visual preview requires WebGL2.');
		await chooseNestedCommandAction(page, editor, 'Generate', [
			'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTestImage'],
		], UI_OPTIONS);
		const image = editor.getByRole('group', { name: 'Video clip: Test Image', exact: true });
		await expect(image).toBeVisible(UI_OPTIONS);
		await image.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', [
			'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
		], UI_OPTIONS);
		let dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await dialog.getByRole('combobox', { name: 'Pattern', exact: true }).selectOption('alignment-grid');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.', UI_OPTIONS);
		await page.keyboard.press('Escape');

		await chooseNestedCommandAction(page, editor, 'Generate', [
			'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoNoise'],
		], UI_OPTIONS);
		const noise = editor.getByRole('group', { name: 'Video clip: Noise', exact: true });
		await expect(noise).toBeVisible(UI_OPTIONS);
		const noiseId = await noise.getAttribute('data-clip-id');
		expect(noiseId).toBeTruthy();
		await noise.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', [
			'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await dialog.getByRole('combobox', { name: 'Noise mode', exact: true }).selectOption('color');
		await dialog.getByRole('spinbutton', { name: 'Grain size (pixels)', exact: true }).fill('16');
		await dialog.getByRole('spinbutton', { name: 'Seed', exact: true }).fill('42');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.', UI_OPTIONS);
		await page.keyboard.press('Escape');
		const preview = editor.locator('[data-video-preview]');
		await seekFramescaperTimecode(page, editor, '00:00:05:00');
		await expectExactVisualizerFrame(preview);
		await expect.poll(async () => (await preview.getAttribute('data-active-clip-ids'))
			?.split(' ').includes(noiseId), UI_OPTIONS).toBe(true);
		const firstSample = await preview.getAttribute('data-video-preview-evaluated-timeline-sample');
		const firstDigest = await previewDigest(editor, browserName);
		await seekFramescaperTimecode(page, editor, '00:00:05:01');
		await expectExactVisualizerFrame(preview);
		await expect(preview).not.toHaveAttribute('data-video-preview-evaluated-timeline-sample', firstSample, UI_OPTIONS);
		await expect.poll(() => previewDigest(editor, browserName), {
			timeout: 10_000, intervals: [100, 250, 500],
		}).not.toBe(firstDigest);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', UI_OPTIONS);

		await page.reload();
		const restored = page.locator('[data-audio-editor]');
		await expect(restored).toHaveAttribute('data-audio-editor-bound', 'true', UI_OPTIONS);
		await restored.getByRole('group', { name: 'Video clip: Test Image', exact: true }).press('Enter');
		await chooseNestedCommandAction(page, restored, 'Effect', [
			'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await expect(dialog.getByRole('combobox', { name: 'Pattern', exact: true }))
			.toHaveValue('alignment-grid');
		await page.keyboard.press('Escape');

		await restored.getByRole('group', { name: 'Video clip: Noise', exact: true }).press('Enter');
		await chooseNestedCommandAction(page, restored, 'Effect', [
			'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await expect(dialog.getByRole('combobox', { name: 'Noise mode', exact: true })).toHaveValue('color');
		await expect(dialog.getByRole('spinbutton', { name: 'Grain size (pixels)', exact: true }))
			.toHaveValue('16');
		await expect(dialog.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('42');
		expect(clientErrors).toEqual([]);
	});

	test('configures a menu-authored sound visualizer for a chosen audio source', async ({ page, browserName }) => {
		test.setTimeout(300_000);
		await installWebkitPreviewFrameDigest(page, browserName);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		test.skip(!await page.evaluate(hasWebGl2Capability), 'The exact visual preview requires WebGL2.');
		await importFiles(editor, [changingToneFixture()]);
		await expect(editor).toHaveAttribute('data-clip-count', '1', UI_OPTIONS);
		await chooseNestedCommandAction(page, editor, 'Generate', [
			'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addSoundVisualizer'],
		], UI_OPTIONS);
		const visualizer = editor.getByRole('group', { name: 'Video clip: Sound Visualizer', exact: true });
		await expect(visualizer).toBeVisible(UI_OPTIONS);
		const visualizerId = await visualizer.getAttribute('data-clip-id');
		expect(visualizerId).toBeTruthy();
		await visualizer.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', [
			'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
		], UI_OPTIONS);
		let dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await expect(dialog).toBeVisible(UI_OPTIONS);
		await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('spectrum');
		await dialog.getByRole('spinbutton', { name: 'View window (seconds)', exact: true }).fill('0.25');
		await dialog.getByRole('textbox', { name: 'Foreground RGBA color', exact: true }).fill('#19c7ffff');
		const source = dialog.getByRole('group', { name: 'Audio sources', exact: true }).getByRole('checkbox').first();
		await expect(source).toBeVisible(UI_OPTIONS);
		await source.check();
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.', UI_OPTIONS);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden(UI_OPTIONS);
		const preview = editor.locator('[data-video-preview]');
		await seekFramescaperTimecode(page, editor, '00:00:00:12');
		await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '19200', UI_OPTIONS);
		await expectExactVisualizerFrame(preview);
		const firstDigest = await previewDigest(editor, browserName);
		expect(firstDigest).not.toBeNull();
		await seekFramescaperTimecode(page, editor, '00:00:02:00');
		await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '96000', UI_OPTIONS);
		await expectExactVisualizerFrame(preview);
		await expect.poll(() => previewDigest(editor, browserName), {
			timeout: 10_000, intervals: [100, 250, 500],
		}).not.toBe(firstDigest);
		// The shared Firefox transport currently never reaches Pause after Play in this environment.
		if (browserName !== 'firefox') {
			await seekFramescaperTimecode(page, editor, '00:00:00:00');
			await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '0', UI_OPTIONS);
			await editor.getByRole('button', { name: 'Play', exact: true }).click();
			await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible(UI_OPTIONS);
			await expect.poll(() => preview.getAttribute('data-video-preview-evaluated-timeline-sample'), {
				timeout: 10_000,
			}).not.toBe('0');
			await expect.poll(async () => (await preview.getAttribute('data-active-clip-ids'))
				?.split(' ').includes(visualizerId), UI_OPTIONS).toBe(true);
			const liveFirstDigest = await previewDigest(editor, browserName);
			await expect.poll(() => previewDigest(editor, browserName), { timeout: 10_000, intervals: [250, 500] })
				.not.toBe(liveFirstDigest);
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', UI_OPTIONS);
		await page.reload();
		const restored = page.locator('[data-audio-editor]');
		await expect(restored).toHaveAttribute('data-audio-editor-bound', 'true', UI_OPTIONS);
		await restored.locator(`[data-clip-id="${visualizerId}"]`).first().press('Enter');
		await chooseNestedCommandAction(page, restored, 'Effect', [
			'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await expect(dialog.getByRole('combobox', { name: 'Visualization', exact: true })).toHaveValue('spectrum');
		await expect(dialog.getByRole('spinbutton', { name: 'View window (seconds)', exact: true })).toHaveValue('0.25');
		await expect(dialog.getByRole('textbox', { name: 'Foreground RGBA color', exact: true })).toHaveValue('#19c7ffff');
		await expect(dialog.getByRole('group', { name: 'Audio sources', exact: true })
			.getByRole('checkbox').first()).toBeChecked();
		await page.keyboard.press('Escape');
		const audio = clipByName(restored, 'visualizer-audio.wav');
		await expect(audio).toBeVisible(UI_OPTIONS);
		await audio.locator('.clip-header').click();
		await restored.getByRole('region', { name: 'Timeline', exact: true }).first().press('Delete');
		await expect(audio).toHaveCount(0, UI_OPTIONS);
		await restored.locator(`[data-clip-id="${visualizerId}"]`).first().press('Enter');
		await chooseNestedCommandAction(page, restored, 'Effect', [
			'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		const audioSources = dialog.getByRole('group', { name: 'Audio sources', exact: true });
		await expect(audioSources.getByRole('checkbox')).toHaveCount(0);
		await expect(audioSources).toContainText('The selected source has no clip in this sequence.');
		await audioSources.getByRole('button', { name: 'Follow nearest audio clip', exact: true }).click();
		await expect(audioSources.getByRole('button', { name: 'Follow nearest audio clip', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.', UI_OPTIONS);
		expect(clientErrors).toEqual([]);
	});

	test('validates, creates, exercises updates, and removes a selected mask and visual preset', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName !== 'chromium', 'The nightly browser coverage surface is Chromium.');
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await chooseNestedCommandAction(
			page,
			editor,
			'Generate',
			['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoSolid']],
			UI_OPTIONS,
		);
		const solid = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
		await expect(solid).toBeVisible(UI_OPTIONS);
		await solid.press('Enter');

		await chooseNestedCommandAction(
			page,
			editor,
			'Effect',
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.editVideoMaskMatte']],
			UI_OPTIONS,
		);
		let dialog = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await expect(dialog).toBeVisible(UI_OPTIONS);
		const status = dialog.getByRole('status');
		const width = dialog.getByRole('spinbutton', { name: 'Width', exact: true });
		await width.fill('0');
		await dialog.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
		await expect(status).toHaveText('mask width is outside its finite bound.', UI_OPTIONS);

		await width.fill('0.5');
		await dialog.getByRole('combobox', { name: 'Shape', exact: true }).selectOption('ellipse');
		await dialog.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
		await expect(status).toHaveText('Selected authored state applied.', UI_OPTIONS);
		await expect(dialog.getByRole('button', { name: 'Update attached mask', exact: true }))
			.toBeVisible(UI_OPTIONS);

		await expect(dialog.getByRole('combobox', { name: 'Shape', exact: true }).locator('option'))
			.toHaveText(['Rectangle', 'Ellipse']);
		await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('0');
		await dialog.getByRole('button', { name: 'Update attached mask', exact: true }).click();
		await expect(status).toHaveText('mask height is outside its finite bound.', UI_OPTIONS);
		await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('0.25');
		await dialog.getByRole('combobox', { name: 'Shape', exact: true }).selectOption('rectangle');
		await dialog.getByRole('button', { name: 'Update attached mask', exact: true }).click();
		await expect(status).toHaveText(
			'A finishing visual presentation command must mutate state; no-op commands are unsupported.',
			UI_OPTIONS,
		);
		await dialog.getByRole('button', { name: 'Remove attachment', exact: true }).click();
		await expect(status).toHaveText('Selected authored state removed.', UI_OPTIONS);
		await expect(dialog.getByRole('button', { name: 'Remove attachment', exact: true })).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden(UI_OPTIONS);

		await chooseNestedCommandAction(
			page,
			editor,
			'Generate',
			['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.saveVideoVisualPreset']],
			UI_OPTIONS,
		);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		await expect(dialog).toBeVisible(UI_OPTIONS);
		const presetName = dialog.getByRole('textbox', { name: 'Preset name', exact: true });
		await presetName.fill('');
		await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText(
			'visual preset name must be canonical safe text.', UI_OPTIONS,
		);
		await presetName.fill('Browser visual preset');
		await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.', UI_OPTIONS);
		await expect(dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true })
			.getByRole('option', { name: 'Browser visual preset', exact: true })).toHaveCount(1);
		await page.keyboard.press('Escape');

		await chooseNestedCommandAction(
			page,
			editor,
			'Generate',
			['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']],
			UI_OPTIONS,
		);
		const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
		await expect(title).toBeVisible(UI_OPTIONS);
		await title.press('Enter');
		await chooseNestedCommandAction(
			page,
			editor,
			'Generate',
			['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.saveVideoVisualPreset']],
			UI_OPTIONS,
		);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		const presets = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
		await presets.selectOption({ label: 'Browser visual preset' });
		await dialog.getByRole('button', { name: 'Apply to selected generator', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', UI_OPTIONS);
		await dialog.getByRole('button', { name: 'Remove visual preset', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', UI_OPTIONS);
		await expect(presets.getByRole('option', { name: 'Browser visual preset', exact: true })).toHaveCount(0);
		expect(clientErrors).toEqual([]);
	});

	test('validates and edits an adjustment, then applies and removes an exact dissolve', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName !== 'chromium', 'The nightly browser coverage surface is Chromium.');
		test.setTimeout(240_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [CFR_VIDEO.file], UI_OPTIONS);
		let videoClips = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClips).toHaveCount(1, UI_OPTIONS);
		await videoClips.first().press('Enter');

		await chooseNestedCommandAction(
			page,
			editor,
			'Tracks',
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoAdjustmentLayer']],
			UI_OPTIONS,
		);
		let dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
		const brightness = dialog.getByRole('spinbutton', { name: 'Brightness', exact: true });
		await brightness.fill('2');
		await dialog.getByRole('button', { name: 'Apply adjustment', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText(
			'adjustment brightness is outside its finite bound.', UI_OPTIONS,
		);
		await brightness.fill('0.25');
		await dialog.getByRole('button', { name: 'Apply adjustment', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Update adjustment', exact: true }))
			.toBeVisible(UI_OPTIONS);
		await brightness.fill('0.5');
		await dialog.getByRole('button', { name: 'Update adjustment', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', UI_OPTIONS);
		await dialog.getByRole('button', { name: 'Remove adjustment', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', UI_OPTIONS);
		await expect(dialog.getByRole('button', { name: 'Remove adjustment', exact: true })).toBeDisabled();
		await page.keyboard.press('Escape');

		const splitTool = editor.getByRole('button', { name: 'Split tool', exact: true });
		await splitTool.click();
		await clickClipInterior(page, videoClips.first(), 0.5);
		await splitTool.click();
		videoClips = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClips).toHaveCount(2, UI_OPTIONS);
		await videoClips.first().press('Enter');
		await chooseNestedCommandAction(
			page,
			editor,
			'Effect',
			[
				EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoTransitions'],
				EDITOR_ENGLISH_COPY['ui.framescaperMenus.addDissolveTransition'],
			],
			UI_OPTIONS,
		);
		dialog = page.getByRole('dialog', { name: 'Dissolve Transition', exact: true });
		await expect(dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true }))
			.toBeVisible(UI_OPTIONS);
		await dialog.getByRole('button', { name: 'Apply dissolve', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', UI_OPTIONS);
		await expect(dialog.getByRole('button', { name: 'Remove dissolve', exact: true })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Remove dissolve', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', UI_OPTIONS);
		await expect(dialog.getByRole('button', { name: 'Remove dissolve', exact: true })).toBeDisabled();
		expect(clientErrors).toEqual([]);
	});
});

async function installWebkitPreviewFrameDigest(page, browserName) {
	// WebKit screenshots can retain the previous WebGL frame when drawing buffers are discarded.
	// Hash the presented framebuffer after each draw to verify visible animation there.
	if (browserName !== 'webkit') return;
	await page.addInitScript(() => {
		if (typeof WebGL2RenderingContext === 'undefined') return;
		window.__framescaperPreviewFrameDigest = null;
		const nativeDraw = WebGL2RenderingContext.prototype.drawArrays;
		WebGL2RenderingContext.prototype.drawArrays = function (...args) {
			const result = nativeDraw.apply(this, args);
			if (this.canvas instanceof HTMLCanvasElement
				&& this.canvas.matches('[data-video-preview-canvas]')
				&& this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
				const pixels = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
				this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight,
					this.RGBA, this.UNSIGNED_BYTE, pixels);
				let hash = 2166136261;
				for (let index = 0; index < pixels.length; index += 64) {
					for (let component = 0; component < 4; component += 1) {
						hash = Math.imul(hash ^ pixels[index + component], 16777619);
					}
				}
				window.__framescaperPreviewFrameDigest = hash >>> 0;
			}
			return result;
		};
	});
}

async function expectExactVisualizerFrame(preview) {
	await expect.poll(() => preview.evaluate((element) => {
		const requested = Number(element.dataset.videoPreviewVisualRequestedCount || 0);
		const consumed = Number(element.dataset.videoPreviewVisualConsumedCount || 0);
		return {
			pending: element.dataset.videoPreviewVisualPending,
			error: element.dataset.videoPreviewVisualError,
			omitted: element.dataset.videoPreviewVisualOmittedCount,
			exact: requested >= 1 && consumed === requested,
		};
	}), UI_OPTIONS).toMatchObject({ pending: 'false', error: '', omitted: '0', exact: true });
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', UI_OPTIONS);
}

async function previewDigest(editor, browserName) {
	if (browserName === 'webkit') {
		return editor.evaluate(() => window.__framescaperPreviewFrameDigest);
	}
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toBeVisible(UI_OPTIONS);
	return createHash('sha256').update(await preview.screenshot()).digest('hex');
}

function changingToneFixture() {
	const sampleRate = 48_000;
	const frameCount = sampleRate * 5;
	const buffer = Buffer.alloc(44 + frameCount * 2);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + frameCount * 2, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * 2, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(frameCount * 2, 40);
	for (let frame = 0; frame < frameCount; frame += 1) {
		const frequency = frame < sampleRate * 1.5 ? 220 : 880;
		buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 12_000), 44 + frame * 2);
	}
	return { name: 'visualizer-audio.wav', mimeType: 'audio/wav', buffer };
}
