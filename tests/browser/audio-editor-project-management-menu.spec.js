import { readFile } from 'node:fs/promises';

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clickClipInterior,
	collectClientErrors,
	getMenuItem,
	importFiles,
	registerAudioEditorHooks,
	resolveBrowserProductTestUrl,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const projectManagementCommands = [
	'Local projects',
	'Consolidate media',
	'Trim media to what is used',
	'Save archive checksums',
	'Project properties',
	'Rename project',
	'Duplicate project',
	'Delete project',
	'Clear all local editor data',
];

test.describe('File project management submenu', () => {
	registerAudioEditorHooks();

	test('groups the project commands under an optional File submenu', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const file = editor.getByRole('menubar', { name: 'Application menu' })
			.getByRole('menuitem', { name: 'File', exact: true });
		await file.click();
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		const projectManagement = getMenuItem(fileMenu, 'Project management');
		await expect(projectManagement).toBeVisible();
		await expect(projectManagement.getByRole('menu')).toHaveCount(0);
		for (const label of projectManagementCommands) {
			await expect(getMenuItem(fileMenu, label)).toHaveCount(0);
		}

		await projectManagement.click();
		const submenu = projectManagement.getByRole('menu');
		await expect(submenu).toBeVisible();
		await expect(submenu.getByRole('menuitem')).toHaveCount(projectManagementCommands.length);
		await expect(submenu.getByRole('menuitem')).toContainText(projectManagementCommands);
		await expect(getMenuItem(submenu, 'Save archive checksums')).toHaveAttribute('aria-disabled', 'true');
		await getMenuItem(submenu, 'Project properties').click();
		await expect(fileMenu).toBeHidden();
		await expect(editor.locator('[data-workspace-panel="metadata"]')).toBeVisible();
	});

	test('supports keyboard entry, wraparound, exit, and command activation', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const file = editor.getByRole('menubar', { name: 'Application menu' })
			.getByRole('menuitem', { name: 'File', exact: true });
		await file.focus();
		await page.keyboard.press('ArrowDown');
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		await expect(fileMenu.getByRole('menuitem').first()).toBeFocused();
		const projectManagement = getMenuItem(fileMenu, 'Project management');
		await page.keyboard.press('End');
		await expect(projectManagement).toBeFocused();
		await page.keyboard.press('ArrowRight');
		const submenu = projectManagement.getByRole('menu');
		const localProjects = getMenuItem(submenu, 'Local projects');
		const clearData = getMenuItem(submenu, 'Clear all local editor data');
		await expect(submenu).toBeVisible();
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('Home');
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('End');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(submenu).toBeHidden();
		await expect(projectManagement).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(fileMenu).toBeHidden();
		const dialog = page.getByRole('dialog', { name: 'Local projects', exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(file).toBeFocused();
	});

	test('consolidates a linked WAV and trims managed video with persistent undo', async ({ page }) => {
		test.setTimeout(240_000);
		page.setDefaultTimeout(30_000);
		const clientErrors = collectClientErrors(page);
		await installProjectMediaRoutes(page);
		await installLinkedAudioDesktopBridge(page, toneA);

		let editor = await bootEditor(page, '/framescaper/embed/en/');
		await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
		await expect(editor.locator('[data-project-bin-item]')).toHaveCount(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await expect.poll(() => persistedProjectMedia(page, projectId)).toMatchObject({
			bindingCount: 1,
			audioSourceCount: 1,
			managedAudioBodyCount: 0,
		});

		await chooseNestedCommandAction(page, editor, 'File', [
			'Project management', 'Consolidate media',
		]);
		await expect(editor.locator('[data-status]')).toContainText('Media consolidated');
		await expect.poll(() => persistedProjectMedia(page, projectId)).toMatchObject({
			bindingCount: 0,
			audioSourceCount: 1,
			managedAudioBodyCount: 1,
		});
		const bridgeState = await page.evaluate(() => globalThis.__projectMediaDesktopFixture);
		expect(bridgeState.audioLoads).toBeGreaterThanOrEqual(3);
		expect(bridgeState.rangeRequests.length).toBeGreaterThan(0);
		await page.evaluate(() => sessionStorage.setItem('__projectMediaOriginalBlocked', 'true'));

		await importFiles(editor, [createDeterministicSilentVideoFixture('trim-managed-video.webm')], {
			timeout: 60_000,
		});
		let videoClips = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClips).toHaveCount(1);
		const splitTool = editor.getByRole('button', { name: 'Split tool', exact: true });
		await splitTool.click();
		await clickClipInterior(page, videoClips.first(), 0.5);
		await splitTool.click();
		videoClips = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(videoClips).toHaveCount(2);
		await videoClips.nth(1).press('Enter');
		await expect(videoClips.nth(1).locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		await editor.getByRole('region', { name: 'Timeline', exact: true }).first().press('Delete');
		await expect(videoClips).toHaveCount(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		const imported = await persistedProjectMedia(page, projectId);
		expect(imported.video).not.toBeNull();
		expect(imported.video.source.timingAsset).not.toBeNull();
		await makeImportedVideoTrimmable(page, projectId);
		await page.goto(resolveBrowserProductTestUrl('/framescaper/embed/en/'));
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		const beforeTrim = await persistedProjectMedia(page, projectId);
		expect(beforeTrim.bindingCount).toBe(0);
		expect(beforeTrim.video.source.timingAsset).toBeNull();
		expect(beforeTrim.video.source.timingDecision).toMatchObject({
			mode: 'conform-cfr-at-ingest',
			reason: 'timing-probe-unavailable',
		});

		await chooseNestedCommandAction(page, editor, 'File', [
			'Project management', 'Trim media to what is used',
		]);
		await expect(editor.locator('[data-status]')).toContainText('Media trimmed', { timeout: 120_000 });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect.poll(() => persistedProjectMedia(page, projectId), {
			timeout: 30_000,
		}).not.toEqual(beforeTrim);
		const afterTrim = await persistedProjectMedia(page, projectId);
		expect(afterTrim.video.source.sourceFrameCount)
			.toBeLessThan(beforeTrim.video.source.sourceFrameCount);
		expect(afterTrim.video.source.storageKey).toMatch(/\.trim\.[a-f\d]{16}$/u);
		expect(afterTrim.video.clip.sourceFrameCount).toBe(beforeTrim.video.clip.sourceFrameCount);
		expect(afterTrim.video.clip.sourceInFrame).toBe(0);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => persistedProjectMedia(page, projectId)).toEqual(beforeTrim);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => persistedProjectMedia(page, projectId)).toEqual(afterTrim);
		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect.poll(() => persistedProjectMedia(page, projectId)).toEqual(afterTrim);
		expect(clientErrors).toEqual([]);
	});
});

async function installProjectMediaRoutes(page) {
	const core = new Map([
		['ffmpeg-core.js', {
			body: await readFile(new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url)),
			contentType: 'text/javascript',
		}],
		['ffmpeg-core.wasm', {
			body: await readFile(new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)),
			contentType: 'application/wasm',
		}],
	]);
	await page.route('https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/**', async (route) => {
		const descriptor = core.get(new URL(route.request().url()).pathname.split('/').at(-1));
		if (!descriptor) return route.abort();
		await route.fulfill({
			...descriptor,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Resource-Policy': 'cross-origin',
			},
		});
	});
	await page.route('**/__project-media-storage-setup', (route) => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Storage setup</title>',
	}));
}

async function installLinkedAudioDesktopBridge(page, fixture) {
	await page.route('**/__e2e-linked-project-media.wav', (route) => route.fulfill({
		body: fixture.buffer,
		contentType: fixture.mimeType,
		headers: { 'Content-Length': String(fixture.buffer.byteLength) },
	}));
	await page.addInitScript(({ base64, name, mimeType, size }) => {
		const locatorId = '1'.repeat(64);
		const locatorRevision = 'a'.repeat(64);
		const materializedReadId = 'b'.repeat(64);
		const rangeReadId = 'c'.repeat(64);
		const state = { audioLoads: 0, rangeRequests: [], releasedOriginals: [], releasedReads: [] };
		const materializedDescriptor = () => ({
			id: materializedReadId,
			readProfile: 'materialized-v1',
			url: `${location.origin}/__e2e-linked-project-media.wav`,
			name,
			size,
			mimeType,
			lastModified: 123,
		});
		const rangeUrl = `framescaper-app://bundle/_desktop/read/linked-audio-range-v1/${rangeReadId}/${encodeURIComponent(name)}`;
		const rangeDescriptor = () => ({
			id: rangeReadId,
			readProfile: 'linked-audio-range-v1',
			url: rangeUrl,
			name,
			size,
			mimeType,
			lastModified: 123,
		});
		const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
		const nativeFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url !== rangeUrl) return nativeFetch(input, init);
			const header = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
				.get('Range');
			const match = /^bytes=(\d+)-(\d+)$/u.exec(header ?? '');
			if (!match) return new Response(null, { status: 416 });
			const start = Number(match[1]);
			const end = Number(match[2]);
			state.rangeRequests.push({ start, end });
			const body = bytes.slice(start, end + 1);
			return new Response(body, {
				status: 206,
				headers: {
					'Accept-Ranges': 'bytes',
					'Content-Length': String(body.byteLength),
					'Content-Range': `bytes ${start}-${end}/${size}`,
					'Content-Type': mimeType,
				},
			});
		};
		const bridge = Object.freeze({
			chooseLinkedAudioOriginal: async () => ({
				locatorId, locatorRevision, name, size, mimeType, lastModified: 123,
			}),
			loadLinkedAudioOriginal: async ({ range }) => {
				state.audioLoads += 1;
				if (sessionStorage.getItem('__projectMediaOriginalBlocked') === 'true') {
					throw new Error('The consolidated test original must no longer be read.');
				}
				return {
					locatorRevision,
					descriptor: range ? rangeDescriptor() : materializedDescriptor(),
				};
			},
			reconcileLinkedOriginals: async () => 0,
			releaseLinkedOriginal: async (reference) => {
				state.releasedOriginals.push(structuredClone(reference));
				return true;
			},
			chooseLinkedVideoOriginal: async () => null,
			loadLinkedVideoOriginal: async () => null,
			reconcileLinkedVideoOriginals: async () => 0,
			releaseLinkedVideoOriginal: async () => true,
			releaseRead: async (id) => {
				state.releasedReads.push(id);
				return true;
			},
		});
		Object.defineProperty(globalThis, '__projectMediaDesktopFixture', {
			configurable: true, value: state,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true, enumerable: true, value: Object.freeze({ v1: bridge }),
		});
	}, {
		base64: fixture.buffer.toString('base64'),
		name: fixture.name,
		mimeType: fixture.mimeType,
		size: fixture.buffer.byteLength,
	});
}

/**
 * Recreate the supported document written when ingest succeeds but its timing
 * probe is unavailable. This deterministic browser fixture always probes
 * successfully, so the equivalent legal legacy state cannot arise through its
 * import UI; only the timing authority is degraded and the media stays intact.
 */
async function makeImportedVideoTrimmable(page, projectId) {
	await page.goto(new URL('/__project-media-storage-setup', page.url()).href);
	await page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects'], 'readwrite');
			const store = transaction.objectStore('projects');
			const project = await result(store.get(id));
			project.sources = project.sources.map((source) => source.kind === 'video' ? {
				...source,
				timingAsset: null,
				timingDecision: {
					mode: 'conform-cfr-at-ingest',
					rate: source.frameRate,
					reason: 'timing-probe-unavailable',
					failures: [],
				},
			} : source);
			if (project.featureRequirements?.requirements) {
				project.featureRequirements = {
					...project.featureRequirements,
					requirements: project.featureRequirements.requirements.filter(
						({ id: requirementId }) => requirementId !== 'framescaper.video-timing-assets',
					),
				};
			}
			store.put(project);
			await new Promise((resolve, reject) => {
				transaction.oncomplete = resolve;
				transaction.onabort = () => reject(transaction.error);
				transaction.onerror = () => reject(transaction.error);
			});
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function persistedProjectMedia(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction([
				'projects', 'linkedVideoOriginalBindings', 'mediaAssets',
			], 'readonly');
			const project = await result(transaction.objectStore('projects').get(id));
			const bindings = await result(transaction.objectStore('linkedVideoOriginalBindings').getAll());
			const mediaAssets = await result(transaction.objectStore('mediaAssets').getAll());
			const audioSourceIds = new Set(project?.sources
				?.filter(({ kind }) => kind === 'audio')
				.map(({ id: sourceId }) => sourceId) ?? []);
			const source = project?.sources?.find(({ kind }) => kind === 'video') ?? null;
			const clip = source && project.clips.find(({ sourceId }) => sourceId === source.id);
			return {
				bindingCount: bindings.filter((entry) => entry.projectId === id).length,
				audioSourceCount: audioSourceIds.size,
				managedAudioBodyCount: mediaAssets.filter(({ sourceId }) => audioSourceIds.has(sourceId)).length,
				video: source && clip ? {
					source: {
						id: source.id,
						storageKey: source.storageKey,
						sourceFrameCount: source.sourceFrameCount,
						contentSha256: source.contentSha256,
						timingAsset: source.timingAsset,
						timingDecision: source.timingDecision,
					},
					clip: {
						id: clip.id,
						sourceInFrame: clip.sourceInFrame,
						sourceFrameCount: clip.sourceFrameCount,
					},
				} : null,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
