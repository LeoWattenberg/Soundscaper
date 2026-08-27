/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('selected F31 imports and exports caption files and publishes built-in motion analysis', async ({ page }) => {
	test.setTimeout(180_000);
	await disableNativeSavePicker(page);
	const clientErrors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('v28-caption-motion.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();

	let dialog = await openFinishing(page, editor, 'Tracks', /^Caption Tracks/u, 'Caption Tracks');
	await dialog.locator('[data-v27-caption-file]').setInputFiles({
		name: 'captions.vtt', mimeType: 'text/vtt',
		buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nFile-backed caption\n'),
	});
	await expect(dialog.getByRole('status')).toHaveText('captions.vtt: No interchange losses.');
	await expect(dialog.getByRole('combobox', { name: 'Format', exact: true })).toHaveValue('webvtt');
	const downloadPromise = page.waitForEvent('download');
	await dialog.getByRole('button', { name: /Export selected track/u }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('captions-1.vtt');
	await expect(dialog.getByRole('status')).toHaveText('1 interchange loss recorded.');
	await closeFinishing(dialog);

	const exportDialog = await openExportDialog(page, editor);
	await chooseDropdown(page,
		exportDialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
	await expect(exportDialog.locator('[data-export-field="captionDeliveryUnavailable"]')).toContainText(
		'Caption burn-in and mux are unavailable for selected Framescaper F31.',
	);
	await expect(exportDialog.locator('[data-effect-field="captionTrack"]')).toHaveCount(0);
	await expect(exportDialog.locator('[data-effect-field="captionDelivery"]')).toHaveCount(0);
	await expect(exportDialog.locator('[data-export-field="captionBurnIn"]')).toHaveCount(0);
	await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(exportDialog).toBeHidden();

	const source = await storedMotionState(page, projectId);
	dialog = await openFinishing(page, editor, 'Analyze', /^Motion Tracking/u, 'Motion Tracking');
	const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
	const finishing = JSON.parse(await document.inputValue());
	finishing.videoProcessorStacks = [trackingStack(source.sourceId)];
	await document.fill(JSON.stringify(finishing, null, 2));
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Finishing state updated.');
	await expect(dialog.getByRole('combobox', { name: 'Motion-analysis target', exact: true })).toBeVisible();
	await dialog.getByRole('spinbutton', { name: 'Start frame', exact: true }).fill('0');
	await dialog.getByRole('spinbutton', { name: 'End frame', exact: true }).fill('2');
	await dialog.getByRole('button', { name: 'Analyze motion', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText(
		'Motion analysis published and current.', { timeout: 60_000 },
	);
	await expect(dialog.getByRole('button', { name: 'Recompute motion', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Recompute motion', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText(
		'Motion analysis published and current.', { timeout: 60_000 },
	);
	await closeFinishing(dialog);

	await expect.poll(() => storedMotionState(page, projectId)).toMatchObject({
		captionCueCount: 1,
		analysisCount: 1,
		analysisBodyStored: true,
	});
	expect(clientErrors).toEqual([]);
});

async function openFinishing(page, editor, owner, itemName, title) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: owner, exact: true }).click();
	const menu = page.getByRole('menu', { name: owner, exact: true });
	await expect(menu).toBeVisible();
	const item = menu.getByRole('menuitem', { name: itemName }).first();
	await expect(item).toBeEnabled();
	await item.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: title, exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function closeFinishing(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

function trackingStack(sourceId) {
	return {
		schemaVersion: 1, id: 'stack-browser', sourceId,
		processors: [{
			schemaVersion: 1, id: 'tracking-browser', kind: 'tracking', enabled: true,
			maximumFeatures: 32, quality: 0.01, minimumDistance: 2,
			windowRadius: 2, pyramidLevels: 2,
		}],
	};
}

async function storedMotionState(page, projectId) {
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
			const source = project.sources.find(({ kind }) => kind === 'video');
			const reference = project.videoMotionAnalyses[0] ?? null;
			const body = reference ? await result(
				database.transaction('mediaAssets', 'readonly').objectStore('mediaAssets')
					.get(reference.storageKey),
			) : null;
			return {
				sourceId: source.id,
				captionCueCount: project.videoCaptionTracks[0]?.cues?.length ?? 0,
				analysisCount: project.videoMotionAnalyses.length,
				analysisBodyStored: Boolean(body),
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
