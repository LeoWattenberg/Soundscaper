/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, getMenuItem, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { editorDatabaseName } from './helpers/editor-databases.js';

const MENU_LABEL = 'Edit selected clip with ARA';
const DIALOG_TITLE = 'ARA clip editor';
const AUDIO = createWavFixture({ name: 'ara-vocal.wav', frequency: 440, duration: 0.25, channelCount: 2, sampleRate: 48_000 });
test.setTimeout(60_000);

for (const productId of ['soundscaper', 'framescaper']) {
	const path = productId === 'framescaper' ? '/framescaper/embed/en/' : '/embed/en/';

	test(`${productId} renders an ARA clip to one muted track and undoes the edit`, async ({ page }) => {
		await installAraFixture(page);
		const editor = await bootEditor(page, path);
		await expect(page.getByRole('dialog', { name: DIALOG_TITLE, exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: /ARA/iu })).toHaveCount(0);
		await importFiles(editor, [AUDIO]);
		const originalClip = clipByName(editor, AUDIO.name);
		await originalClip.locator('.clip-header').click();
		const originalClipId = await originalClip.getAttribute('data-clip-id');
		const projectId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
		const before = await storedProject(page, productId, projectId);
		const trackCount = await editor.locator('[data-track-row]').count();
		await chooseCommandAction(page, editor, 'Effect', MENU_LABEL);
		const dialog = page.getByRole('dialog', { name: DIALOG_TITLE, exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('combobox', { name: 'VST3 plug-in', exact: true }).selectOption('iaaaaaaaaaaaaaaa');
		await dialog.getByRole('button', { name: 'Open clip', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Render to new muted track', exact: true })).toBeEnabled({ timeout: 15_000 });
		await dialog.getByRole('button', { name: 'Open plug-in editor', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__araCalls.map(([method]) => method))).toContain('openEditor');
		await dialog.getByRole('button', { name: 'Render to new muted track', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(editor.locator('[data-track-row]')).toHaveCount(trackCount + 1);
		const renderedTrack = editor.locator('[data-track-row]').last();
		await expect(renderedTrack.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator(`[data-clip-id="${originalClipId}"]`)).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
		const after = await storedProject(page, productId, projectId);
		expect(after.clips.find(({ id }) => id === originalClipId)).toEqual(before.clips.find(({ id }) => id === originalClipId));
		expect(after.sources.filter(({ id }) => before.sources.some(source => source.id === id))).toEqual(before.sources);
		expect(after.tracks.filter(({ id }) => before.tracks.some(track => track.id === id))).toEqual(before.tracks);
		const renderedSource = after.sources.find(({ id }) => !before.sources.some(source => source.id === id));
		expect(renderedSource).toMatchObject({ sampleRate: 48_000, channelCount: 2, frameCount: 12_000 });
		const peaks = await storedRecord(page, productId, 'analysis', `audio-editor-peaks-v2:${renderedSource.id}`);
		expect(peaks?.value?.levels?.length).toBeGreaterThan(0);
		await expect.poll(() => page.evaluate(() => globalThis.__araCalls.filter(([method]) => method === 'close').length)).toBe(1);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor.locator('[data-track-row]')).toHaveCount(trackCount);
		await expect(editor.locator(`[data-clip-id="${originalClipId}"]`)).toBeVisible();
	});

	test(`${productId} cancels an ARA session without publishing audio`, async ({ page }) => {
		await installAraFixture(page);
		const editor = await bootEditor(page, path);
		await importFiles(editor, [AUDIO]);
		await clipByName(editor, AUDIO.name).locator('.clip-header').click();
		const trackCount = await editor.locator('[data-track-row]').count();
		await chooseCommandAction(page, editor, 'Effect', MENU_LABEL);
		const dialog = page.getByRole('dialog', { name: DIALOG_TITLE, exact: true });
		await dialog.getByRole('combobox', { name: 'VST3 plug-in', exact: true }).selectOption('iaaaaaaaaaaaaaaa');
		await dialog.getByRole('button', { name: 'Open clip', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Render to new muted track', exact: true })).toBeEnabled({ timeout: 15_000 });
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => globalThis.__araCalls.filter(([method]) => method === 'close').length)).toBe(1);
		await expect(editor.locator('[data-track-row]')).toHaveCount(trackCount);
	});

	test(`${productId} browser menu omits the native ARA editor`, async ({ page }) => {
		const editor = await bootEditor(page, path);
		const effect = await openNestedCommandMenu(page, editor, 'Effect', []);
		await expect(getMenuItem(effect, MENU_LABEL)).toHaveCount(0);
	});
}

async function installAraFixture(page) {
	await page.addInitScript(() => {
		const calls = [];
		let source = null;
		const chunks = [];
		const sessionId = 'ara-browser-session';
		const registry = { entries: [{ entryId: 'ara-vocal-editor', format: 'VST3', name: 'Vocal editor', vendor: 'Fixture', eligible: true,
			ineligibleReason: null, installations: [{ installationId: 'iaaaaaaaaaaaaaaa', version: '1.0', allowed: true, selected: true, quarantined: false }] }] };
		const bridge = {
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
			nativePluginAvailability: async () => ({ enabled: true, quarantined: false, formats: ['vst3'],
				payload: { status: 'available' }, consent: { scanningEnabled: true, formats: [] } }),
			listNativePlugins: async () => registry,
			setNativePluginInstallationAllowed: async () => registry,
			selectNativePluginInstallation: async () => registry,
			ara: {
				start: async (value) => { calls.push(['start', value]); source = value.source; return { sessionId }; },
				write: async (value) => { calls.push(['write', { startFrame: value.startFrame, frameCount: value.channels[0].length }]); chunks.push(value); return true; },
				bind: async () => { calls.push(['bind']); return true; },
				openEditor: async () => { calls.push(['openEditor']); return true; },
				render: async ({ startFrame, frameCount }) => {
					calls.push(['render', { startFrame, frameCount }]);
					return { startFrame, channels: Array.from({ length: source.channelCount }, (_, channel) => {
						const output = new Float32Array(frameCount);
						for (let frame = 0; frame < frameCount; frame++) {
							const sourceFrame = startFrame + frame;
							const chunk = chunks.find(value => value.startFrame <= sourceFrame && sourceFrame < value.startFrame + value.channels[0].length);
							output[frame] = (chunk?.channels[channel][sourceFrame - chunk.startFrame] ?? 0) * 0.5;
						}
						return output;
					}) };
				},
				close: async () => { calls.push(['close']); return true; },
			},
		};
		globalThis.__araCalls = calls;
		const envelope = Object.freeze({ v1: Object.freeze(bridge) });
		globalThis.scapeDesktop = envelope;
		globalThis.soundscaperDesktop = envelope;
	});
}

async function storedProject(page, productId, projectId) {
	return storedRecord(page, productId, 'projects', projectId);
}

async function storedRecord(page, productId, storeName, key) {
	return page.evaluate(({ databaseName, storeName, key }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => { database.close(); resolve(request.result); };
		};
	}), { databaseName: editorDatabaseName(productId), storeName, key });
}
