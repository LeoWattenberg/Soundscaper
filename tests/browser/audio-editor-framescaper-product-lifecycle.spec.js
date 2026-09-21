/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test.describe('Framescaper v1 product lifecycle', () => {
	test('authors and reopens exact keyframes through the shipped route', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		let editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await importFiles(editor, [createDeterministicAvFixture('framescaper-v20-keyframes.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClip).toHaveCount(1);
		await videoClip.focus();
		await videoClip.press('Enter');
		await expect(videoClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);

		await openKeyframeDialog(page, editor);
		const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
		await expect(dialog).toBeVisible();
		const target = dialog.locator('[data-video-keyframe-field="target"]');
		const [opacityTarget] = await target.selectOption({ label: 'Opacity' });
		await expect(target).toHaveValue(opacityTarget);
		const startValue = dialog.locator('[data-video-keyframe-field="start-value"]');
		const endValue = dialog.locator('[data-video-keyframe-field="end-value"]');
		await startValue.fill('1');
		await endValue.fill('0.5');
		await expect(startValue).toHaveValue('1');
		await expect(endValue).toHaveValue('0.5');
		await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Video keyframes applied.');
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			schemaFamily: 'framescaper', schemaVersion: 1,
			curveCount: 1,
			startValue: 1,
			endValue: 0.5,
		});

		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({ curveCount: 0 });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({ curveCount: 1 });

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			schemaFamily: 'framescaper', schemaVersion: 1,
			curveCount: 1,
			startValue: 1,
			endValue: 0.5,
		});

		const soundscaperPage = await page.context().newPage();
		const soundscaperErrors = collectClientErrors(soundscaperPage);
		try {
			const soundscaper = await bootEditor(soundscaperPage, '/embed/en/');
			await expect(soundscaper).toHaveAttribute('data-product', 'soundscaper');
			const audioClips = await openNestedCommandMenu(
				soundscaperPage, soundscaper, 'Edit', ['Audio clips'],
			);
			await expect(audioClips
				.getByRole('menuitem', { name: /^Video keyframes(?:\s|$)/u })).toHaveCount(0);
			await expect(audioClips
				.getByRole('menuitem', { name: /^Video retime…(?:\s|$)/u })).toHaveCount(0);
			expect(clientErrors).toEqual([]);
			expect(soundscaperErrors).toEqual([]);
		} finally {
			await soundscaperPage.close();
		}
	});

	test('edits and transfers exact keyframe curves through the shipped dialog', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('framescaper-advanced-keyframes.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await videoClip.focus();
		await videoClip.press('Enter');
		await openKeyframeDialog(page, editor);
		let dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
		const target = dialog.locator('[data-video-keyframe-field="target"]');
		await target.selectOption({ label: 'Opacity' });
		const frameCount = Number(await dialog.locator('[data-video-keyframe-field="end"]').inputValue());
		expect(frameCount).toBeGreaterThan(4);
		const insertedFrame = Math.floor(frameCount / 2);
		const movedFrame = insertedFrame + 1;
		await dialog.locator('[data-video-keyframe-field="start-value"]').fill('0.2');
		await dialog.locator('[data-video-keyframe-field="end-value"]').fill('0.8');
		await dialog.locator('[data-video-keyframe-field="interpolation"]').selectOption('hold');
		await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curveCount: 1,
			curves: [{ target: 'opacity', anchors: [
				{ position: '0', value: 0.2 }, { position: String(frameCount), value: 0.8 },
			], segments: ['hold'] }],
		});

		const anchor = dialog.locator('[data-video-keyframe-field="anchor"]');
		const anchorPosition = dialog.locator('[data-video-keyframe-field="anchor-position"]');
		const anchorValue = dialog.locator('[data-video-keyframe-field="anchor-value"]');
		await expect(anchor.locator('option')).toHaveCount(2);
		await expect(dialog.locator('[data-video-keyframe-field="segment-kind"]')).toHaveValue('hold');
		await anchorPosition.fill(String(insertedFrame));
		await anchorValue.fill('0.5');
		await dialog.getByRole('button', { name: 'Insert anchor', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curves: [{ target: 'opacity', anchorCount: 3, segments: ['hold', 'hold'] }],
		});

		await expect(anchor.locator('option')).toHaveCount(3);
		await expect(anchorPosition).toHaveValue('0');
		await anchor.selectOption({ value: '1' });
		await anchorPosition.fill(String(movedFrame));
		await anchorValue.fill('0.6');
		await expect(anchorPosition).toHaveValue(String(movedFrame));
		await expect(anchorValue).toHaveValue('0.6');
		await dialog.getByRole('button', { name: 'Update anchor', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curves: [{ target: 'opacity', anchors: [
				{ position: '0', value: 0.2 },
				{ position: String(movedFrame), value: 0.6 },
				{ position: String(frameCount), value: 0.8 },
			] }],
		});
		await expect(anchorPosition).toHaveValue('0');

		const segment = dialog.locator('[data-video-keyframe-field="segment"]');
		const segmentKind = dialog.locator('[data-video-keyframe-field="segment-kind"]');
		await segment.selectOption({ value: '0' });
		await segmentKind.selectOption('linear');
		await dialog.getByRole('button', { name: 'Update segment', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curves: [{ target: 'opacity', segments: ['linear', 'hold'] }],
		});
		await expect(segment).toHaveValue('0');
		await expect(segmentKind).toHaveValue('linear');
		await segment.selectOption({ value: '1' });
		await segmentKind.selectOption('eased');
		await dialog.getByRole('button', { name: 'Update segment', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curves: [{ target: 'opacity', segments: ['linear', 'eased'] }],
		});

		await expect(segment).toHaveValue('0');
		await expect(segmentKind).toHaveValue('linear');
		await segment.selectOption({ value: '0' });
		await segmentKind.selectOption('bezier');
		const firstControl = Math.max(1, Math.floor(movedFrame / 3));
		const secondControl = Math.max(firstControl, Math.floor(movedFrame * 2 / 3));
		await dialog.locator('[data-video-keyframe-field="control-1-position"]').fill(String(firstControl));
		await dialog.locator('[data-video-keyframe-field="control-1-value"]').fill('0.3');
		await dialog.locator('[data-video-keyframe-field="control-2-position"]').fill(String(secondControl));
		await dialog.locator('[data-video-keyframe-field="control-2-value"]').fill('0.4');
		await dialog.getByRole('button', { name: 'Update segment', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curves: [{ target: 'opacity', segments: ['bezier', 'eased'] }],
		});

		await expect(anchor.locator('option')).toHaveCount(3);
		await anchor.selectOption({ value: '1' });
		await dialog.getByRole('button', { name: 'Remove anchor', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curves: [{ target: 'opacity', anchorCount: 2, segments: ['linear'] }],
		});
		await expect(anchor.locator('option')).toHaveCount(2);

		await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
		const transfer = dialog.locator('[data-video-keyframe-field="transfer"]');
		expect(JSON.parse(await transfer.inputValue())).toMatchObject({
			schemaVersion: 1, role: 'clipboard', curve: { segments: [{ kind: 'linear' }] },
		});
		await target.selectOption({ label: 'Position X' });
		await dialog.getByRole('button', { name: 'Paste curve', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curveCount: 2, targets: ['opacity', 'transform.positionX'],
		});
		await dialog.getByRole('button', { name: 'Prepare preset', exact: true }).click();
		expect(JSON.parse(await transfer.inputValue())).toMatchObject({ schemaVersion: 1, role: 'preset' });
		await target.selectOption({ label: 'Position Y' });
		await dialog.getByRole('button', { name: 'Apply preset', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curveCount: 3, targets: ['opacity', 'transform.positionX', 'transform.positionY'],
		});

		const curve = dialog.locator('[data-video-keyframe-field="curve"]');
		await curve.selectOption({ label: 'Position Y' });
		await dialog.getByRole('button', { name: 'Remove curve', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curveCount: 2, targets: ['opacity', 'transform.positionX'],
		});
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curveCount: 3, targets: ['opacity', 'transform.positionX', 'transform.positionY'],
		});
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => storedKeyframeState(page, projectId)).toMatchObject({
			curveCount: 2, targets: ['opacity', 'transform.positionX'],
		});

		await openKeyframeDialog(page, editor);
		dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
		await expect(dialog.locator('[data-video-keyframe-field="curve"] option')).toHaveCount(2);
		await dialog.locator('[data-video-keyframe-field="curve"]').selectOption({ label: 'Position X' });
		await expect(dialog.locator('[data-video-keyframe-field="anchor"] option')).toHaveCount(2);
		await expect(dialog.locator('[data-video-keyframe-field="segment-kind"]')).toHaveValue('linear');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		expect(clientErrors).toEqual([]);
	});

	test('authors exact retime from the keyboard-only lazy dialog', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('framescaper-v20-retime.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
		await videoClip.focus();
		await videoClip.press('Enter');

		const audioClips = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
		const retime = getMenuItem(audioClips, 'Video retime…');
		await expect(retime).toBeEnabled();
		await retime.focus();
		await retime.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('Linked audio stays unwarped.');
		await assertNoSeriousAxeViolations(page, '[data-video-retime-dialog]');
		await page.emulateMedia({ forcedColors: 'active' });
		await expect(dialog.getByRole('button', { name: 'Reverse', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Reverse', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Video retime updated.');
		await expect.poll(() => storedRetimeState(page, projectId)).toMatchObject({
			schemaFamily: 'framescaper', schemaVersion: 1, mode: 'constant-reverse', audioWarp: null, audioReversed: false,
		});

		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedRetimeState(page, projectId)).toMatchObject({ mode: null });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => storedRetimeState(page, projectId)).toMatchObject({
			mode: 'constant-reverse', audioWarp: null, audioReversed: false,
		});
		expect(clientErrors).toEqual([]);
	});

	test('opens the menu-only proxy lifecycle and switches preview authority', async ({ page }) => {
		test.setTimeout(180_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('framescaper-v20-proxy.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });

		const audioClips = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
		const proxies = getMenuItem(audioClips, 'Video proxies…');
		await expect(proxies).toBeEnabled();
		await proxies.focus();
		await proxies.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
		await expect(dialog).toBeVisible();
		await assertNoSeriousAxeViolations(page, '[data-video-proxy-dialog]');
		await expect(dialog).toContainText('Export and delivery always use the original.');
		await expect(dialog.getByRole('button', { name: 'Generate and attach', exact: true })).toBeEnabled();
		const mode = dialog.getByRole('combobox', { name: 'Preview media', exact: true });
		await mode.selectOption('proxy');
		await expect(dialog.getByRole('status')).toContainText(
			'Proxy preview is unavailable because no verified attachment exists.',
		);
		await expect(mode).toHaveValue('auto');
		await mode.selectOption('original');
		await expect(mode).toHaveValue('original');
		await expect(dialog.getByRole('status')).toContainText(
			'Preview mode updated and proxy trust refreshed.',
		);
		await mode.selectOption('auto');
		await expect(mode).toHaveValue('auto');
		await expect(dialog.getByRole('status')).toContainText(
			'Preview mode updated and proxy trust refreshed.',
		);
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		expect(clientErrors).toEqual([]);
	});
});

async function openKeyframeDialog(page, editor) {
	const audioClips = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	const keyframes = getMenuItem(audioClips, 'Video keyframes');
	await expect(keyframes).toBeEnabled();
	await keyframes.focus();
	await keyframes.press('Enter');
}

async function storedKeyframeState(page, projectId) {
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
			const video = project?.clips?.find((clip) => clip.kind === 'video');
			const curve = video?.videoKeyframes?.curves?.[0]?.curve;
			const curves = video?.videoKeyframes?.curves?.map((entry) => ({
				target: entry.target?.parameterId ?? null,
				anchorCount: entry.curve?.anchors?.length ?? -1,
				anchors: entry.curve?.anchors?.map((anchor) => ({
					position: anchor.position?.den === 1
						? String(anchor.position.num)
						: `${String(anchor.position?.num)}/${String(anchor.position?.den)}`,
					value: anchor.value ?? null,
				})) ?? [],
				segments: entry.curve?.segments?.map((segment) => segment.kind) ?? [],
			})) ?? [];
			return {
				schemaFamily: project?.schemaFamily ?? null,
				schemaVersion: project?.schemaVersion ?? null,
				curveCount: video?.videoKeyframes?.curves?.length ?? -1,
				startValue: curve?.anchors?.[0]?.value ?? null,
				endValue: curve?.anchors?.at(-1)?.value ?? null,
				targets: curves.map((entry) => entry.target),
				curves,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function storedRetimeState(page, projectId) {
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
			const video = project?.clips?.find((clip) => clip.kind === 'video');
			const audio = project?.clips?.find((clip) => clip.kind === 'audio');
			return {
				schemaFamily: project?.schemaFamily ?? null,
				schemaVersion: project?.schemaVersion ?? null,
				mode: video?.retimeMap?.segments?.[0]?.mode ?? null,
				audioWarp: audio?.warpMap ?? null,
				audioReversed: audio?.reversed ?? null,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
