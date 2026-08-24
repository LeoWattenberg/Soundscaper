/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseDropdown,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

const CFR_VIDEO = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const VISUAL_READINESS_TIMEOUT = 30_000;
const VISUAL_OPERATION_TIMEOUT = 120_000;
const VISUAL_WORKFLOW_TIMEOUT = 600_000;
const VISUAL_COMMAND_OPTIONS = { timeout: VISUAL_READINESS_TIMEOUT };
const VISUAL_FFMPEG_OPTIONS = { timeout: 120_000 };
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';
const WEBGL2_COMPOSITED_PREVIEW_REQUIRED = 'The exact composited preview and its pixel assertions require WebGL2, '
	+ 'which this browser environment refuses; the DOM fallback tier is qualified separately.';

test.describe('selected V27 exact visual preview', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ page }) => {
		page.setDefaultTimeout(VISUAL_READINESS_TIMEOUT);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('menu-authored generator, preset, presentation, and mask change pixels, reopen, and reach video export', async ({ page }) => {
		test.setTimeout(VISUAL_WORKFLOW_TIMEOUT);
		const clientErrors = collectClientErrors(page);
		let editor = await bootEditor(page, '/framescaper/embed/en/');
		test.skip(!await page.evaluate(hasWebGl2Capability), WEBGL2_COMPOSITED_PREVIEW_REQUIRED);
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		await chooseNestedCommandAction(
			page, editor, 'Generate', ['Video Generators', 'Add Solid…'], VISUAL_COMMAND_OPTIONS,
		);
		await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(1, {
			timeout: VISUAL_READINESS_TIMEOUT,
		});
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, {
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
		await expect(dialog.locator('[data-visual-inspector-opacity]')).toBeFocused(VISUAL_COMMAND_OPTIONS);
		await assertNoSeriousAxeViolations(page, '[data-framescaper-v27-visual-inspector]');
		await dialog.locator('[data-visual-inspector-color]').fill('#ff0000ff');
		await dialog.locator('[data-visual-inspector-apply]').click();
		await expectVisualCommandStatus(dialog, 'Selected visual updated.');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden(VISUAL_COMMAND_OPTIONS);
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, {
			generatorCount: 1, presentationCount: 1,
		});
		await expectExactVisualFrame(preview, 1);
		const redPixels = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(redPixels).not.toBe(originalPixels);

		await chooseNestedCommandAction(
			page, editor, 'Generate', ['Video Generators', 'Save Visual Preset…'], VISUAL_COMMAND_OPTIONS,
		);
		let authoring = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		await expect(authoring).toBeVisible(VISUAL_COMMAND_OPTIONS);
		await expect(authoring.locator('[data-v27-authoring-preset-name]')).toBeFocused(VISUAL_COMMAND_OPTIONS);
		await assertNoSeriousAxeViolations(page, '[data-framescaper-selected-v27-authoring]');
		await authoring.locator('[data-v27-authoring-preset-name]').fill('Selected red solid');
		await authoring.locator('[data-v27-authoring-save-visual]').click();
		await expectVisualCommandStatus(authoring, 'Selected visual preset saved.');
		await page.keyboard.press('Escape');
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { presetCount: 1 });
		await chooseNestedCommandAction(
			page, editor, 'Effect', ['Edit Video Mask/Matte…'], VISUAL_COMMAND_OPTIONS,
		);
		authoring = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await expect(authoring).toBeVisible(VISUAL_COMMAND_OPTIONS);
		await authoring.locator('[data-v27-authoring-mask-shape]').selectOption('ellipse');
		await authoring.locator('[data-v27-authoring-mask-width]').fill('0.5');
		await authoring.locator('[data-v27-authoring-apply]').click();
		await expectVisualCommandStatus(authoring, 'Selected authored state applied.');
		await page.keyboard.press('Escape');
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { maskCount: 1 });
		state = await storedVisualState(page, projectId);
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true', VISUAL_COMMAND_OPTIONS);
		dialog = await openVisualInspector(page, editor);
		await dialog.locator('[data-visual-inspector-mask]').selectOption(state.maskIds[0]);
		await dialog.locator('[data-visual-inspector-mask-width]').fill('0.5');
		await dialog.locator('[data-visual-inspector-opacity]').fill('0.75');
		await dialog.locator('[data-visual-inspector-apply]').click();
		await expectVisualCommandStatus(dialog, 'Selected visual updated.');
		await page.keyboard.press('Escape');
		await expect(preview).toHaveAttribute(
			'data-video-preview-visual-omitted-count', '0', VISUAL_COMMAND_OPTIONS,
		);
		await expect(preview).toHaveAttribute(
			'data-video-preview-visual-consumed-node-ids', /mask/u, VISUAL_COMMAND_OPTIONS,
		);
		const maskedPixels = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(maskedPixels).not.toBe(redPixels);

		await chooseNestedCommandAction(
			page, editor, 'Generate', ['Video Generators', 'Add Solid…'], VISUAL_COMMAND_OPTIONS,
		);
		await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(2, {
			timeout: VISUAL_READINESS_TIMEOUT,
		});
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { generatorCount: 2 });
		state = await storedVisualState(page, projectId);
		const secondClipId = state.generatorClipIds.find((id) => id !== firstClipId);
		expect(secondClipId).toBeTruthy();
		await selectAndSeekClip(editor, secondClipId, 0.25, state);
		await expectExactVisualFrame(preview, 1);
		const beforePreset = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		await chooseNestedCommandAction(
			page, editor, 'Generate', ['Video Generators', 'Save Visual Preset…'], VISUAL_COMMAND_OPTIONS,
		);
		authoring = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
		await expect(authoring).toBeVisible(VISUAL_COMMAND_OPTIONS);
		await authoring.locator('[data-v27-authoring-visual-preset]').selectOption({ label: 'Selected red solid' });
		await authoring.locator('[data-v27-authoring-apply-visual]').click();
		await expectVisualCommandStatus(authoring, 'Selected authored state applied.');
		await page.keyboard.press('Escape');
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, {
			generatorColorByClip: { [secondClipId]: '#ff0000ff' },
		});
		state = await storedVisualState(page, projectId);
		await selectAndSeekClip(editor, secondClipId, 0.5, state);
		await expectExactVisualFrame(preview, 1);
		const afterPreset = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(afterPreset).not.toBe(beforePreset);

		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, {
			generatorCount: 2, presentationCount: 1, maskCount: 1, presetCount: 1,
		});
		await waitForStoredVisualState(page, projectId, {
			generatorColorByClip: { [secondClipId]: '#ff0000ff' },
		});
		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true', VISUAL_COMMAND_OPTIONS);
		await expect(editor).toHaveAttribute('data-project-id', projectId, VISUAL_COMMAND_OPTIONS);
		state = await storedVisualState(page, projectId);
		expect(state.generatorColorByClip[secondClipId]).toBe('#ff0000ff');
		await selectAndSeekClip(editor, secondClipId, 0.25, state);
		await expectExactVisualFrame(editor.locator('[data-video-preview]'), 1);
		await expect.poll(() => screenshotDigest(editor.locator('[data-video-preview-canvas]')), {
			timeout: VISUAL_READINESS_TIMEOUT,
		})
			.toBe(afterPreset);

		await chooseFileAction(page, editor, 'Export audio', VISUAL_COMMAND_OPTIONS);
		const exportDialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
		await expect(exportDialog).toBeVisible(VISUAL_COMMAND_OPTIONS);
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
			.toBeEnabled(VISUAL_COMMAND_OPTIONS);
		await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(exportDialog).toBeHidden(VISUAL_COMMAND_OPTIONS);
		expect(clientErrors).toEqual([]);
	});

	test('menu-authored adjustment changes video pixels and freeze holds one authenticated picture', async ({
		browserName,
		page,
	}) => {
		test.skip(browserName === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(VISUAL_WORKFLOW_TIMEOUT);
		const clientErrors = collectClientErrors(page);
		await installPinnedFfmpegRuntimeRoutes(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		test.skip(!await page.evaluate(hasWebGl2Capability), WEBGL2_COMPOSITED_PREVIEW_REQUIRED);
		await importFiles(editor, [CFR_VIDEO.file], VISUAL_FFMPEG_OPTIONS);
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await saveProjectAndWait(page, editor);
		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await videoClip.press('Enter', VISUAL_COMMAND_OPTIONS);
		await expect(videoClip.locator('.clip-display')).toHaveClass(
			/clip-display--selected/u, VISUAL_COMMAND_OPTIONS,
		);
		const preview = editor.locator('[data-video-preview]');
		await expect(preview).toHaveAttribute(
			'data-video-preview-renderer', /^(?:ready|webgl)$/u, VISUAL_COMMAND_OPTIONS,
		);
		const beforeAdjustment = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));

		await chooseNestedCommandAction(
			page, editor, 'Tracks', ['Add Video Adjustment Layer…'], VISUAL_COMMAND_OPTIONS,
		);
		let authoring = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
		await expect(authoring).toBeVisible(VISUAL_COMMAND_OPTIONS);
		await authoring.locator('[data-v27-authoring-brightness]').fill('0.4');
		await authoring.locator('[data-v27-authoring-apply]').click();
		await expectVisualCommandStatus(authoring, 'Selected authored state applied.');
		await page.keyboard.press('Escape');
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { adjustmentCount: 1 });
		await expectExactVisualFrame(preview, 1);
		await expect(preview).toHaveAttribute(
			'data-video-preview-requested-effect-count', '1', VISUAL_COMMAND_OPTIONS,
		);
		await expect(preview).toHaveAttribute(
			'data-video-preview-omitted-effect-count', '0', VISUAL_COMMAND_OPTIONS,
		);
		const afterAdjustment = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(afterAdjustment).not.toBe(beforeAdjustment);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { adjustmentCount: 0 });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { adjustmentCount: 1 });

		await chooseNestedCommandAction(
			page, editor, 'Effect', ['Freeze Video…'], VISUAL_COMMAND_OPTIONS,
		);
		authoring = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
		await expect(authoring).toBeVisible(VISUAL_COMMAND_OPTIONS);
		await authoring.locator('[data-v27-authoring-freeze-duration]').fill('24');
		await authoring.locator('[data-v27-authoring-freeze]').click();
		await expectVisualCommandStatus(authoring, 'Exact playhead freeze created.');
		await page.keyboard.press('Escape');
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { freezeCount: 1, stillCount: 1 });
		const state = await storedVisualState(page, projectId);
		const freezeClipId = state.stillClipIds[0];
		expect(freezeClipId).toBeTruthy();
		await selectAndSeekClip(editor, freezeClipId, 0.2, state);
		await expectExactVisualFrame(preview, 2);
		await expect(preview).toHaveAttribute(
			'data-video-preview-active-freeze-node-ids', /video-freeze/u, VISUAL_COMMAND_OPTIONS,
		);
		const freezeEarly = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		await selectAndSeekClip(editor, freezeClipId, 0.8, state);
		await expectExactVisualFrame(preview, 2);
		const freezeLate = await screenshotDigest(editor.locator('[data-video-preview-canvas]'));
		expect(freezeLate).toBe(freezeEarly);
		expect(clientErrors).toEqual([]);
	});

	test('generator-only visual publishes one finite MP4 download', async ({ browserName, page }) => {
		test.skip(
			browserName !== 'chromium',
			'The maintained browser MP4 publication route requires Chromium shared-memory FFmpeg.',
		);
		test.setTimeout(VISUAL_WORKFLOW_TIMEOUT);
		const clientErrors = collectClientErrors(page);
		await installPinnedFfmpegRuntimeRoutes(page, {
			sameOriginRoot: '/__framescaper-v27-ffmpeg',
		});
		await installProductionIsolationHeaders(page, '/framescaper/en/');
		const editor = await bootEditor(page, '/framescaper/en/');
		expect(await page.evaluate(() => ({
			crossOriginIsolated: globalThis.crossOriginIsolated,
			sharedArrayBuffer: typeof globalThis.SharedArrayBuffer,
		}))).toEqual({ crossOriginIsolated: true, sharedArrayBuffer: 'function' });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await chooseNestedCommandAction(
			page, editor, 'Generate', ['Video Generators', 'Add Solid…'], VISUAL_COMMAND_OPTIONS,
		);
		await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true }))
			.toBeVisible(VISUAL_COMMAND_OPTIONS);
		await saveProjectAndWait(page, editor);
		await waitForStoredVisualState(page, projectId, { generatorCount: 1 });

		await chooseFileAction(page, editor, 'Export audio', VISUAL_COMMAND_OPTIONS);
		const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
		const canvasSize = dialog.locator('[data-export-field="canvasSize"] input');
		await canvasSize.nth(0).fill('64');
		await canvasSize.nth(1).fill('64');
		await dialog.locator('[data-export-field="canvasFrameRate"] input').fill('1');
		await dialog.locator('[data-export-action="start"]').getByRole('button').click();
		const download = dialog.locator('[data-export-download]');
		await waitForVideoPublication(page, editor, download, 120_000, clientErrors);
		await expect(download).toHaveAttribute('download', /\.mp4$/u, VISUAL_COMMAND_OPTIONS);
		const witness = await download.evaluate(async (link) => {
			const response = await fetch(link.href);
			const bytes = new Uint8Array(await response.arrayBuffer());
			return {
				byteLength: bytes.byteLength,
				mimeType: response.headers.get('content-type'),
				box: String.fromCharCode(...bytes.subarray(4, 8)),
			};
		});
		expect(witness.byteLength).toBeGreaterThan(32);
		expect(witness.mimeType).toContain('video/mp4');
		expect(witness.box).toBe('ftyp');
		expect(clientErrors).toEqual([]);
	});
});

test.describe('selected V27 visual state without WebGL2', () => {
	test.beforeEach(async ({ page }) => {
		page.setDefaultTimeout(VISUAL_READINESS_TIMEOUT);
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('resolves the visual session state in the DOM fallback tier', async ({ page }) => {
		// Regression: when the WebGL2 compositor is unavailable, the exact V27
		// visual session previously never resolved — the preview reported
		// visual-pending "true" forever with an empty error, which is exactly
		// how CI browsers whose GPU blocklist refuses WebGL2 presented the
		// workspace. The DOM fallback tier must still resolve the session
		// state so the disclosed fallback remains observable.
		await page.addInitScript(() => {
			const originalGetContext = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
				if (type === 'webgl2' && this.hasAttribute('data-video-preview-canvas')) return null;
				return originalGetContext.call(this, type, ...args);
			};
		});
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await chooseNestedCommandAction(
			page, editor, 'Generate', ['Video Generators', 'Add Solid…'], VISUAL_COMMAND_OPTIONS,
		);
		await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(1, {
			timeout: VISUAL_READINESS_TIMEOUT,
		});
		const preview = editor.locator('[data-video-preview]');
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'fallback', VISUAL_COMMAND_OPTIONS);
		await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false', VISUAL_COMMAND_OPTIONS);
		await expect(preview).toHaveAttribute('data-video-preview-visual-error', '', VISUAL_COMMAND_OPTIONS);
		await expect(preview).toHaveAttribute('data-active-track-count', '1', VISUAL_COMMAND_OPTIONS);
		expect(clientErrors).toEqual([]);
	});
});

async function installProductionIsolationHeaders(page, path) {
	await page.route(`**${path}`, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'credentialless',
			},
		});
	});
	await page.route('**/assets/worker-*.js', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				'Cross-Origin-Embedder-Policy': 'credentialless',
				'Cross-Origin-Resource-Policy': 'same-origin',
			},
		});
	});
}

async function waitForVideoPublication(page, editor, download, timeout, clientErrors) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await download.isVisible()) return;
		const status = await editor.locator('[data-status]').evaluate((element) => ({
			state: element.dataset.state ?? '', text: element.textContent ?? '',
		}));
		if (status.state === 'error') {
			throw new Error(`Video publication failed: ${status.text}; console=${JSON.stringify(clientErrors)}`);
		}
		await page.waitForTimeout(250);
	}
	throw new Error(`Video publication timed out: ${JSON.stringify({
		status: await editor.locator('[data-status]').evaluate((element) => ({
			state: element.dataset.state ?? '', text: element.textContent ?? '',
		})),
		clientErrors,
	})}`);
}

async function openVisualInspector(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', [
		'Video Finishing', 'Selected Visual Inspector…',
	], VISUAL_COMMAND_OPTIONS);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog).toBeVisible({ timeout: VISUAL_READINESS_TIMEOUT });
	return dialog;
}

async function selectAndSeekClip(editor, clipId, fraction, state) {
	const clip = editor.locator(`[data-clip-id="${clipId}"]`).first();
	await expect(clip).toBeVisible({ timeout: VISUAL_READINESS_TIMEOUT });
	const range = state.visualClips.find(({ id }) => id === clipId);
	expect(range).toBeTruthy();
	const frame = range.start + Math.min(range.count - 1, Math.max(0, Math.floor(range.count * fraction)));
	const timecode = sequenceTimecode(frame, state.rate);
	const input = editor.getByRole('textbox', { name: 'Timecode', exact: true });
	await input.fill(timecode);
	await input.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute(
		'data-sequence-timecode', timecode, { timeout: VISUAL_READINESS_TIMEOUT },
	);
	const sample = Math.round(frame * state.rate.den * state.sampleRate / state.rate.num);
	await expect(editor.locator('[data-video-preview]')).toHaveAttribute(
		'data-video-preview-evaluated-timeline-sample', String(sample), {
			timeout: VISUAL_READINESS_TIMEOUT,
		},
	);
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u, {
		timeout: VISUAL_READINESS_TIMEOUT,
	});
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
	}, minimumRequested), { timeout: VISUAL_READINESS_TIMEOUT }).toMatchObject({
		pending: 'false', error: '', omitted: '0', exact: true,
	});
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', {
		timeout: VISUAL_READINESS_TIMEOUT,
	});
}

async function expectVisualCommandStatus(dialog, message) {
	await expect(dialog.getByRole('status')).toContainText(message, {
		timeout: VISUAL_OPERATION_TIMEOUT,
	});
}

async function screenshotDigest(canvas) {
	await expect(canvas).toBeVisible(VISUAL_COMMAND_OPTIONS);
	return createHash('sha256').update(await canvas.screenshot()).digest('hex');
}

async function saveProjectAndWait(page, editor) {
	await chooseFileAction(page, editor, 'Save project', VISUAL_COMMAND_OPTIONS);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: VISUAL_READINESS_TIMEOUT,
	});
}

async function waitForStoredVisualState(page, projectId, expected) {
	await expect.poll(() => storedVisualState(page, projectId), {
		timeout: VISUAL_READINESS_TIMEOUT,
	}).toMatchObject(expected);
}

async function storedVisualState(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction('projects', 'readonly');
			const completed = new Promise((resolve, reject) => {
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			const project = await result(transaction.objectStore('projects').get(id));
			await completed;
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
