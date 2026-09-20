/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clickClipInterior,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

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

		await editor.getByRole('menuitem', { name: 'Effect', exact: true }).click();
		const effect = page.getByRole('menu', { name: 'Effect', exact: true });
		await expect(effect.getByRole('menuitem', { name: /^Video Transitions/u })).toBeVisible();
		await expect(effect.getByRole('menuitem', { name: /^Edit Video Mask\/Matte/u })).toBeVisible();
		await expect(effect.getByRole('menuitem', { name: /^Freeze Video/u })).toBeVisible();
		await expect(editor.getByRole('button', {
			name: /Add (?:Still|Title|Text|Shape|Solid|Video Adjustment Layer)/u,
		})).toHaveCount(0);
	});

	test('authors every generator and honors cancel or selection in the image picker', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName !== 'chromium', 'The nightly browser coverage surface is Chromium.');
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const generators = [
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle'], 'Title'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoText'], 'Text'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoShape'], 'Shape'],
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoSolid'], 'Solid'],
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

		await dialog.getByRole('combobox', { name: 'Shape', exact: true }).selectOption('line');
		await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('0.25');
		await dialog.getByRole('button', { name: 'Update attached mask', exact: true }).click();
		await expect(status).toHaveText('video mask/matte graph nodes[0].shape is unsupported.', UI_OPTIONS);
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
