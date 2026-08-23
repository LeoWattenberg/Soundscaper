/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

test.describe('selected V27 exact visual preview', () => {
	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
	});

	test('menu-authored generator, preset, presentation, and mask change pixels and reopen', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		let editor = await bootEditor(page, '/framescaper/embed/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid…']);
			await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({
				generatorCount: 1, presentationCount: 0, maskCount: 0, presetCount: 0,
			});
			let state = await storedVisualState(page, projectId);
		const firstClipId = state.generatorClipIds[0];
		expect(firstClipId).toBeTruthy();
		await selectAndSeekClip(editor, firstClipId, 0.25, state);
		const preview = editor.locator('[data-video-preview]');
		await expectExactVisualFrame(preview, 1);
		const originalPixels = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));

		let dialog = await openVisualInspector(page, editor);
		await expect(dialog.locator('[data-visual-inspector-opacity]')).toBeFocused();
		await assertNoSeriousAxeViolations(page, '[data-framescaper-v27-visual-inspector]');
		await dialog.locator('[data-visual-inspector-color]').fill('#ff0000ff');
		await dialog.locator('[data-visual-inspector-apply]').click();
		await expect(dialog.getByRole('status')).toContainText('Selected visual updated.');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({
			generatorCount: 1, presentationCount: 1,
		});
		await expectExactVisualFrame(preview, 1);
		const redPixels = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(redPixels).not.toBe(originalPixels);

		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset…']);
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ presetCount: 1 });
		await chooseNestedCommandAction(page, editor, 'Effect', ['Edit Video Mask/Matte…']);
			await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ maskCount: 1 });
		state = await storedVisualState(page, projectId);
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		dialog = await openVisualInspector(page, editor);
		await dialog.locator('[data-visual-inspector-mask]').selectOption(state.maskIds[0]);
		await dialog.locator('[data-visual-inspector-mask-width]').fill('0.5');
		await dialog.locator('[data-visual-inspector-opacity]').fill('0.75');
		await dialog.locator('[data-visual-inspector-apply]').click();
		await expect(dialog.getByRole('status')).toContainText('Selected visual updated.');
		await page.keyboard.press('Escape');
		await expect(preview).toHaveAttribute('data-video-preview-visual-omitted-count', '0');
		await expect(preview).toHaveAttribute('data-video-preview-visual-consumed-node-ids', /mask/u);
		const maskedPixels = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(maskedPixels).not.toBe(redPixels);

		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid…']);
			await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ generatorCount: 2 });
		state = await storedVisualState(page, projectId);
		const secondClipId = state.generatorClipIds.find((id) => id !== firstClipId);
		expect(secondClipId).toBeTruthy();
		await selectAndSeekClip(editor, secondClipId, 0.25, state);
		await expectExactVisualFrame(preview, 1);
		const beforePreset = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		dialog = await openVisualInspector(page, editor);
		const preset = dialog.locator('[data-visual-inspector-preset]');
		await expect(preset).toBeVisible();
		await preset.selectOption({ label: 'Visual Preset' });
		await dialog.locator('[data-visual-inspector-apply]').click();
		await expect(dialog.getByRole('status')).toContainText('Selected visual updated.');
		await page.keyboard.press('Escape');
		await expectExactVisualFrame(preview, 1);
		const afterPreset = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(afterPreset).not.toBe(beforePreset);

		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({
			generatorCount: 2, presentationCount: 2, maskCount: 1, presetCount: 1,
		});
		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		state = await storedVisualState(page, projectId);
		await selectAndSeekClip(editor, secondClipId, 0.25, state);
		await expectExactVisualFrame(editor.locator('[data-video-preview]'), 1);
		expect(await screenshotDigest(editor.locator('[data-video-preview-canvas]'))).toBe(afterPreset);
		expect(clientErrors).toEqual([]);
	});

	test('menu-authored adjustment changes video pixels and freeze holds one authenticated picture', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('v27-preview-execution.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await videoClip.focus();
		await videoClip.press('Enter');
		const preview = editor.locator('[data-video-preview]');
		await expect(preview).toHaveAttribute('data-video-preview-renderer', /^(?:ready|webgl)$/u);
		const beforeAdjustment = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add Video Adjustment Layer…']);
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ adjustmentCount: 1 });
		await expectExactVisualFrame(preview, 1);
		await expect(preview).toHaveAttribute('data-video-preview-requested-effect-count', '1');
		await expect(preview).toHaveAttribute('data-video-preview-omitted-effect-count', '0');
		const afterAdjustment = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(afterAdjustment).not.toBe(beforeAdjustment);

		await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video…']);
			await expect.poll(() => storedVisualState(page, projectId), { timeout: 30_000 })
				.toMatchObject({ freezeCount: 1, stillCount: 1 });
			const state = await storedVisualState(page, projectId);
		const freezeClipId = state.stillClipIds[0];
		expect(freezeClipId).toBeTruthy();
		await selectAndSeekClip(editor, freezeClipId, 0.2, state);
		await expectExactVisualFrame(preview, 2);
		await expect(preview).toHaveAttribute('data-video-preview-active-freeze-node-ids', /video-freeze/u);
		const freezeEarly = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		await selectAndSeekClip(editor, freezeClipId, 0.8, state);
		await expectExactVisualFrame(preview, 2);
		const freezeLate = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(freezeLate).toBe(freezeEarly);
		expect(clientErrors).toEqual([]);
	});
});

async function openVisualInspector(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', [
		'Video Finishing', 'Selected Visual Inspector…',
	]);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function selectAndSeekClip(editor, clipId, fraction, state) {
	const clip = editor.locator(`[data-clip-id="${clipId}"]`).first();
	await expect(clip).toBeVisible();
	const range = state.visualClips.find(({ id }) => id === clipId);
	expect(range).toBeTruthy();
	const frame = range.start + Math.min(range.count - 1, Math.max(0, Math.floor(range.count * fraction)));
	const timecode = sequenceTimecode(frame, state.rate);
	const input = editor.getByRole('textbox', { name: 'Timecode', exact: true });
	await input.fill(timecode);
	await input.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', timecode);
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

function sequenceTimecode(frame, rate) {
	const nominal = Math.round(rate.num / rate.den);
	const totalSeconds = Math.floor(frame * rate.den / rate.num);
	const frameInSecond = frame - Math.floor(totalSeconds * rate.num / rate.den);
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor(totalSeconds % 3_600 / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds, Math.min(nominal - 1, frameInSecond)]
		.map((value) => String(value).padStart(2, '0')).join(':');
}

async function expectExactVisualFrame(preview, minimumRequested) {
	await expect.poll(() => preview.evaluate((element) => {
		const requested = Number(element.dataset.videoPreviewVisualRequestedCount || 0);
		const consumed = Number(element.dataset.videoPreviewVisualConsumedCount || 0);
		return {
			pending: element.dataset.videoPreviewVisualPending,
			error: element.dataset.videoPreviewVisualError,
			omitted: element.dataset.videoPreviewVisualOmittedCount,
			requested, consumed,
		};
	})).toMatchObject({ pending: 'false', error: '', omitted: '0',
		requested: minimumRequested, consumed: minimumRequested });
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
}

async function screenshotDigest(canvas) {
	await expect(canvas).toBeVisible();
	return createHash('sha256').update(await canvas.screenshot()).digest('hex');
}

async function storedVisualState(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			const clips = project?.clips || [];
			const sequence = project?.sequences?.find(({ id: sequenceId }) => (
				sequenceId === project.primarySequenceId
			)) || project?.sequences?.[0];
			const visuals = clips.filter(({ kind }) => kind === 'generator' || kind === 'still');
			return {
				generatorCount: clips.filter(({ kind }) => kind === 'generator').length,
				generatorClipIds: clips.filter(({ kind }) => kind === 'generator').map(({ id }) => id),
				stillCount: clips.filter(({ kind }) => kind === 'still').length,
				stillClipIds: clips.filter(({ kind }) => kind === 'still').map(({ id }) => id),
				adjustmentCount: project?.videoAdjustmentLayers?.length || 0,
				presetCount: project?.videoVisualPresets?.length || 0,
				maskCount: project?.videoMaskMattes?.length || 0,
				maskIds: project?.videoMaskMattes?.map(({ id }) => id) || [],
				presentationCount: project?.videoVisualPresentations?.length || 0,
				freezeCount: project?.videoFreezeFallbacks?.length || 0,
				rate: sequence?.rate || { num: 30, den: 1 },
				visualClips: visuals.map(({ id, sequenceStartFrame, sequenceFrameCount }) => ({
					id, start: sequenceStartFrame, count: sequenceFrameCount,
				})),
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
