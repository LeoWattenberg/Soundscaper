/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import sharp from 'sharp';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseDropdown,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

test.describe('selected V27 exact visual preview', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
	});

	test('menu-authored generator, preset, presentation, and mask change pixels, reopen, and reach video export', async ({ page }) => {
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
		let authoring = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		await expect(authoring).toBeVisible();
		await expect(authoring.locator('[data-v27-authoring-preset-name]')).toBeFocused();
		await assertNoSeriousAxeViolations(page, '[data-framescaper-selected-v27-authoring]');
		await authoring.locator('[data-v27-authoring-preset-name]').fill('Selected red solid');
		await authoring.locator('[data-v27-authoring-save-visual]').click();
		await expect(authoring.getByRole('status')).toContainText('Selected visual preset saved.');
		await page.keyboard.press('Escape');
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ presetCount: 1 });
		await chooseNestedCommandAction(page, editor, 'Effect', ['Edit Video Mask/Matte…']);
		authoring = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await expect(authoring).toBeVisible();
		await authoring.locator('[data-v27-authoring-mask-shape]').selectOption('ellipse');
		await authoring.locator('[data-v27-authoring-mask-width]').fill('0.5');
		await authoring.locator('[data-v27-authoring-apply]').click();
		await expect(authoring.getByRole('status')).toContainText('Selected authored state applied.');
		await page.keyboard.press('Escape');
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
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset…']);
		authoring = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		await expect(authoring).toBeVisible();
		await authoring.locator('[data-v27-authoring-visual-preset]').selectOption({ label: 'Selected red solid' });
		await authoring.locator('[data-v27-authoring-apply-visual]').click();
		await expect(authoring.getByRole('status')).toContainText('Selected authored state applied.');
		await page.keyboard.press('Escape');
		await expectExactVisualFrame(preview, 1);
		const afterPreset = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(afterPreset).not.toBe(beforePreset);

		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({
			generatorCount: 2, presentationCount: 1, maskCount: 1, presetCount: 1,
		});
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({
			generatorColorByClip: { [secondClipId]: '#ff0000ff' },
		});
		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		state = await storedVisualState(page, projectId);
		expect(state.generatorColorByClip[secondClipId]).toBe('#ff0000ff');
		await selectAndSeekClip(editor, secondClipId, 0.25, state);
		await expectExactVisualFrame(editor.locator('[data-video-preview]'), 1);
		await expect.poll(() => screenshotDigest(editor.locator('[data-video-preview-canvas]')))
			.toBe(afterPreset);

		await chooseFileAction(page, editor, 'Export audio');
		const exportDialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
		await expect(exportDialog).toBeVisible();
		await chooseDropdown(
			page,
			exportDialog.getByRole('group', { name: 'Format', exact: true }),
			'MP4 video',
		);
		const canvasSize = exportDialog.locator('[data-export-field="canvasSize"] input');
		await canvasSize.nth(0).fill('64');
		await canvasSize.nth(1).fill('64');
		await exportDialog.locator('[data-export-field="canvasFrameRate"] input').fill('1');
		await expect(exportDialog.locator('[data-export-action="start"]').getByRole('button'))
			.toBeEnabled();
		await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(exportDialog).toBeHidden();
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
		let authoring = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
		await expect(authoring).toBeVisible();
		await authoring.locator('[data-v27-authoring-brightness]').fill('0.4');
		await authoring.locator('[data-v27-authoring-apply]').click();
		await expect(authoring.getByRole('status')).toContainText('Selected authored state applied.');
		await page.keyboard.press('Escape');
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ adjustmentCount: 1 });
		await expectExactVisualFrame(preview, 1);
		await expect(preview).toHaveAttribute('data-video-preview-requested-effect-count', '1');
		await expect(preview).toHaveAttribute('data-video-preview-omitted-effect-count', '0');
		const afterAdjustment = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(afterAdjustment).not.toBe(beforeAdjustment);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ adjustmentCount: 0 });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => storedVisualState(page, projectId)).toMatchObject({ adjustmentCount: 1 });

		await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video…']);
		authoring = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
		await expect(authoring).toBeVisible();
		await authoring.locator('[data-v27-authoring-freeze-duration]').fill('24');
		await authoring.locator('[data-v27-authoring-freeze]').click();
		await expect(authoring.getByRole('status')).toContainText('Exact playhead freeze created.', { timeout: 30_000 });
		await page.keyboard.press('Escape');
		await expect.poll(() => storedVisualState(page, projectId), { timeout: 30_000 })
			.toMatchObject({ freezeCount: 1, stillCount: 1 });
		const state = await storedVisualState(page, projectId);
		const freezeClipId = state.stillClipIds[0];
		expect(freezeClipId).toBeTruthy();
		await selectAndSeekClip(editor, freezeClipId, 0.2, state);
		await expectExactVisualFrame(preview, 2);
		await expect(preview).toHaveAttribute('data-video-preview-active-freeze-node-ids', /video-freeze/u);
		const freezeEarly = await screenshotPixels(editor.locator('[data-video-preview-canvas]'));
		await selectAndSeekClip(editor, freezeClipId, 0.8, state);
		await expectExactVisualFrame(preview, 2);
		const freezeLate = await screenshotPixels(editor.locator('[data-video-preview-canvas]'));
		const freezeDelta = pixelDelta(freezeEarly, freezeLate);
		expect(freezeDelta.maximum).toBeLessThanOrEqual(2);
		expect(freezeDelta.mean).toBeLessThan(0.1);
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
	const sample = Math.round(frame * state.rate.den * state.sampleRate / state.rate.num);
	await expect(editor.locator('[data-video-preview]')).toHaveAttribute(
		'data-video-preview-evaluated-timeline-sample', String(sample),
	);
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
	await expect.poll(() => preview.evaluate((element, minimum) => {
		const requested = Number(element.dataset.videoPreviewVisualRequestedCount || 0);
		const consumed = Number(element.dataset.videoPreviewVisualConsumedCount || 0);
		return {
			pending: element.dataset.videoPreviewVisualPending,
			error: element.dataset.videoPreviewVisualError,
			omitted: element.dataset.videoPreviewVisualOmittedCount,
			exact: requested >= minimum && consumed === requested,
		};
	}, minimumRequested)).toMatchObject({ pending: 'false', error: '', omitted: '0', exact: true });
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
}

async function screenshotDigest(canvas) {
	return createHash('sha256').update(await screenshotPixels(canvas)).digest('hex');
}

async function screenshotPixels(canvas) {
	await expect(canvas).toBeVisible();
	const { data } = await sharp(await canvas.screenshot()).raw().toBuffer({
		resolveWithObject: true,
	});
	return data;
}

function pixelDelta(left, right) {
	expect(right.byteLength).toBe(left.byteLength);
	let changed = 0;
	let maximum = 0;
	let total = 0;
	for (let index = 0; index < left.byteLength; index += 1) {
		const difference = Math.abs(left[index] - right[index]);
		if (difference > 0) changed += 1;
		maximum = Math.max(maximum, difference);
		total += difference;
	}
	return { changed, maximum, mean: total / left.byteLength };
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
			const sources = project?.sources || [];
			return {
				generatorCount: clips.filter(({ kind }) => kind === 'generator').length,
				generatorClipIds: clips.filter(({ kind }) => kind === 'generator').map(({ id }) => id),
				generatorColors: clips.filter(({ kind }) => kind === 'generator').map(({ sourceId }) => (
					sources.find(({ id }) => id === sourceId)?.generator?.color
				)).filter(Boolean),
				generatorColorByClip: Object.fromEntries(clips
					.filter(({ kind }) => kind === 'generator')
					.map(({ id: clipId, sourceId }) => [
						clipId,
						sources.find(({ id }) => id === sourceId)?.generator?.color ?? null,
					])),
				stillCount: clips.filter(({ kind }) => kind === 'still').length,
				stillClipIds: clips.filter(({ kind }) => kind === 'still').map(({ id }) => id),
				adjustmentCount: project?.videoAdjustmentLayers?.length || 0,
				presetCount: project?.videoVisualPresets?.length || 0,
				maskCount: project?.videoMaskMattes?.length || 0,
				maskIds: project?.videoMaskMattes?.map(({ id }) => id) || [],
				presentationCount: project?.videoVisualPresentations?.length || 0,
				freezeCount: project?.videoFreezeFallbacks?.length || 0,
				sampleRate: project?.sampleRate || 48_000,
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
