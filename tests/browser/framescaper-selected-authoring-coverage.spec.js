/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clickClipInterior,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

const UI_TIMEOUT = 60_000;
const UI_OPTIONS = { timeout: UI_TIMEOUT };

test.describe('Framescaper selected authoring coverage', () => {
	test.describe.configure({ timeout: 240_000 });

	test.beforeEach(async ({ page }) => {
		page.setDefaultTimeout(UI_TIMEOUT);
	});

	test('moves linked audio with an applied and removed dissolve', async ({ browserName, page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('linked-dissolve.webm')], UI_OPTIONS);
		let videoClips = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClips).toHaveCount(1, UI_OPTIONS);

		const splitTool = editor.getByRole('button', { name: 'Split tool', exact: true });
		await splitTool.click();
		await clickClipInterior(page, videoClips.first(), 0.5);
		await splitTool.click();
		videoClips = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClips).toHaveCount(2, UI_OPTIONS);
		await videoClips.first().press('Enter');

		await chooseNestedCommandAction(page, editor, 'Effect', [
			EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoTransitions'],
			EDITOR_ENGLISH_COPY['ui.framescaperMenus.addDissolveTransition'],
		], UI_OPTIONS);
		const dialog = page.getByRole('dialog', { name: 'Dissolve Transition', exact: true });
		const pair = dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true });
		await expect(pair).toContainText('linked A/V', UI_OPTIONS);
		const applyDissolve = dialog.getByRole('button', { name: 'Apply dissolve', exact: true });
		await applyDissolve.click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', UI_OPTIONS);
		await applyDissolve.click();
		await expect(dialog.getByRole('status')).toHaveText(
			'The selected dissolve already has that duration.', UI_OPTIONS,
		);
		await dialog.getByRole('button', { name: 'Remove dissolve', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', UI_OPTIONS);
		await expect(dialog.getByRole('button', { name: 'Remove dissolve', exact: true })).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden(UI_OPTIONS);

		await clickClipInterior(page, videoClips.nth(1), 0.5);
		await videoClips.first().press('Enter');
		await chooseNestedCommandAction(
			page,
			editor,
			'Effect',
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.freezeVideo']],
			UI_OPTIONS,
		);
		let freeze = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
		await freeze.getByRole('button', { name: 'Capture authenticated rendered frame', exact: true }).click();
		await expect(freeze.getByRole('status')).toHaveText(
			'The playhead is outside the selected video.', UI_OPTIONS,
		);
		await page.keyboard.press('Escape');
		if (browserName === 'webkit') {
			// Playwright WebKit rejects the IndexedDB Blob write that persists the
			// captured canvas PNG. The dissolve and out-of-range freeze contracts
			// above remain portable; exact freeze persistence is qualified elsewhere.
			expect(clientErrors).toEqual([]);
			return;
		}
		await clickClipInterior(page, videoClips.first(), 0.5);
		await videoClips.first().press('Enter');
		await chooseNestedCommandAction(
			page,
			editor,
			'Effect',
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.freezeVideo']],
			UI_OPTIONS,
		);
		freeze = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
		const playheadText = await freeze.locator('[data-framescaper-authoring-freeze-playhead]').textContent();
		const playheadSample = playheadText?.match(/\d+$/u)?.[0];
		expect(playheadSample).toBeTruthy();
		await expect(editor.locator('[data-video-preview]')).toHaveAttribute(
			'data-video-preview-evaluated-timeline-sample', playheadSample, UI_OPTIONS,
		);
		await freeze.getByRole('button', { name: 'Capture authenticated rendered frame', exact: true }).click();
		await expect(freeze.getByRole('status')).toHaveText('Exact playhead freeze created.', UI_OPTIONS);
		await page.keyboard.press('Escape');
		const frozen = editor.getByRole('group', { name: /^Video clip:.*Freeze/u });
		await expect(frozen).toHaveCount(1, UI_OPTIONS);
		await frozen.press('Enter');
		await chooseNestedCommandAction(
			page,
			editor,
			'Effect',
			[EDITOR_ENGLISH_COPY['ui.framescaperMenus.editVideoMaskMatte']],
			UI_OPTIONS,
		);
		const mask = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await expect(mask.getByRole('combobox', { name: 'Attached mask', exact: true }))
			.toHaveValue('', UI_OPTIONS);
		expect(clientErrors).toEqual([]);
	});

	test('retains a mask that another visual presentation still references', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const addSolid = async () => chooseNestedCommandAction(page, editor, 'Generate', [
			'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoSolid'],
		], UI_OPTIONS);
		await addSolid();
		let solids = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
		await expect(solids).toHaveCount(1, UI_OPTIONS);
		const firstId = await solids.first().getAttribute('data-clip-id');
		expect(firstId).toBeTruthy();
		await solids.first().press('Enter');

		await chooseNestedCommandAction(page, editor, 'Effect', [
			EDITOR_ENGLISH_COPY['ui.framescaperMenus.editVideoMaskMatte'],
		], UI_OPTIONS);
		let dialog = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await dialog.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', UI_OPTIONS);
		const attached = dialog.getByRole('combobox', { name: 'Attached mask', exact: true });
		const maskId = await attached.inputValue();
		expect(maskId).toBeTruthy();
		await page.keyboard.press('Escape');

		await addSolid();
		solids = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
		await expect(solids).toHaveCount(2, UI_OPTIONS);
		const secondId = await solids.nth(1).getAttribute('data-clip-id');
		expect(secondId).toBeTruthy();
		await chooseNestedCommandAction(page, editor, 'Effect', [
			'Video Finishing', 'Grading & Finishing Presets',
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Grading & Finishing Presets', exact: true });
		const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
		const finishing = JSON.parse(await document.inputValue());
		const firstPresentation = finishing.videoVisualPresentations.find(({ owner }) => owner.id === firstId);
		expect(firstPresentation).toBeTruthy();
		finishing.videoVisualPresentations.push({
			...firstPresentation,
			id: 'browser-shared-mask-presentation',
			owner: { kind: 'clip', id: secondId },
		});
		await document.fill(JSON.stringify(finishing, null, '\t'));
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Finishing state updated.', UI_OPTIONS);
		await page.keyboard.press('Escape');

		await solids.first().press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', [
			EDITOR_ENGLISH_COPY['ui.framescaperMenus.editVideoMaskMatte'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await expect(dialog.getByRole('combobox', { name: 'Attached mask', exact: true }))
			.toHaveValue(maskId, UI_OPTIONS);
		await dialog.getByRole('button', { name: 'Remove attachment', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', UI_OPTIONS);
		await page.keyboard.press('Escape');

		await solids.nth(1).press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', [
			EDITOR_ENGLISH_COPY['ui.framescaperMenus.editVideoMaskMatte'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await expect(dialog.getByRole('combobox', { name: 'Attached mask', exact: true }))
			.toHaveValue(maskId, UI_OPTIONS);
		expect(clientErrors).toEqual([]);
	});

	test('authors, reapplies, and removes one finishing preset through menus', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await chooseNestedCommandAction(page, editor, 'Generate', [
			'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoSolid'],
		], UI_OPTIONS);
		const solid = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
		await expect(solid).toBeVisible(UI_OPTIONS);
		await solid.press('Enter');

		await chooseNestedCommandAction(page, editor, 'Effect', [
			'Video Finishing', 'Grading & Finishing Presets',
		], UI_OPTIONS);
		let dialog = page.getByRole('dialog', { name: 'Grading & Finishing Presets', exact: true });
		await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).fill(JSON.stringify({
			videoVisualPresentations: [],
			videoFinishingPresets: [{
				schemaVersion: 1,
				kind: 'video-finishing-preset',
				id: 'browser-finish',
				name: 'Browser finishing preset',
				template: { enabled: true, opacity: 0.5, blendMode: 'screen', grade: null },
			}],
		}, null, '\t'));
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Finishing state updated.', UI_OPTIONS);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden(UI_OPTIONS);

		await chooseNestedCommandAction(page, editor, 'Generate', [
			'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.saveVideoVisualPreset'],
		], UI_OPTIONS);
		dialog = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		const presets = dialog.getByRole('combobox', { name: 'Saved finishing preset', exact: true });
		await presets.selectOption({ label: 'Browser finishing preset' });
		const apply = dialog.getByRole('button', { name: 'Apply as fresh presentation', exact: true });
		await apply.click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', UI_OPTIONS);
		await apply.click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', UI_OPTIONS);
		await dialog.getByRole('button', { name: 'Remove finishing preset', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', UI_OPTIONS);
		await expect(presets.getByRole('option', { name: 'Browser finishing preset', exact: true }))
			.toHaveCount(0);
		expect(clientErrors).toEqual([]);
	});

	test('discloses every selected-state prerequisite in an empty project', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const dialogs = [
			['Tracks', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoAdjustmentLayer']],
				'Selected Video Adjustment Layer', 'Select one timeline video clip first.'],
			['Effect', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.editVideoMaskMatte']],
				'Selected Mask / Matte', 'Select one timeline visual clip first.'],
			['Effect', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.freezeVideo']],
				'Freeze Selected Video', 'Select one timeline video clip first.'],
			['Effect', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoTransitions'],
				EDITOR_ENGLISH_COPY['ui.framescaperMenus.addDissolveTransition']],
			'Dissolve Transition', 'Select one clip from an unlocked video track containing an adjacent pair.'],
		];
		for (const [menu, path, title, prerequisite] of dialogs) {
			await chooseNestedCommandAction(page, editor, menu, path, UI_OPTIONS);
			const dialog = page.getByRole('dialog', { name: title, exact: true });
			await expect(dialog.getByRole('alert')).toHaveText(prerequisite, UI_OPTIONS);
			await page.keyboard.press('Escape');
			await expect(dialog).toBeHidden(UI_OPTIONS);
		}

		await chooseNestedCommandAction(page, editor, 'Generate', [
			'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.saveVideoVisualPreset'],
		], UI_OPTIONS);
		const presets = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		await expect(presets.getByRole('button', { name: 'Save selected generator preset', exact: true }))
			.toBeDisabled();
		await expect(presets.getByRole('button', { name: 'Apply as fresh presentation', exact: true }))
			.toBeDisabled();
		expect(clientErrors).toEqual([]);
	});
});
