/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME, FRAMESCAPER_OPFS_DIRECTORY_NAME } from './helpers/editor-databases.js';

const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);
const SHA = createHash('sha256').update(CUBE).digest('hex');
const REFERENCE = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: CUBE.length,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const ROUTES = { en: { file: 'File', edit: 'Edit', copy: EDITOR_ENGLISH_COPY },
	de: { file: 'Datei', edit: 'Bearbeiten', copy: EDITOR_GERMAN_COPY } };
const WEBKIT_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';

for (const [locale, route] of Object.entries(ROUTES)) {
	test(`${locale}: the Frame Cube resource controls remain behind the existing Clip properties menu`, async ({ page }) => {
		const editor = await bootEditor(page, `/framescaper/embed/${locale}/`);
		await expect(editor.getByLabel(route.copy.videoEffectCubeLutImport, { exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: route.copy.videoEffectCubeLutClear, exact: true })).toHaveCount(0);
		await expect(editor.locator('[data-workspace-panel="clip-properties"]')).toBeHidden();
	});

	test(`${locale}: keyboard Frame Cube authoring renders exact pixels and preserves disabled clipboard resources and original bytes after reload`, async ({ browserName, page }) => {
		test.skip(browserName === 'webkit', WEBKIT_IMPORT_DEFERRED);
		test.setTimeout(180_000);
		const { copy } = route, input = createDeterministicAvFixture('immutable-cube-source.webm');
		let editor = await bootEditor(page, `/framescaper/embed/${locale}/`);
		await importFiles(editor, [input]);
		await save(page, editor, route);
		const originId = await editor.getAttribute('data-project-id');
		expect(originId).toBeTruthy();
		const original = await snapshot(page, originId);
		const originalVideo = original.project.clips.find(clip => clip.kind === 'video');
		const originalAudio = original.project.clips.find(clip => clip.kind === 'audio');
		expect(originalVideo).toBeTruthy();
		expect(originalAudio).toBeTruthy();
		expect(original.project.clips.map(clip => clip.kind).sort()).toEqual(['audio', 'video']);
		expect(original.project.sources.map(item => item.kind).sort()).toEqual(['audio', 'video']);
		expect(originalVideo.avLinkId).toEqual(expect.any(String));
		expect(originalAudio.avLinkId).toBe(originalVideo.avLinkId);
		expect(originalAudio.sourceId).not.toBe(originalVideo.sourceId);
		const source = original.project.sources.find(item => item.id === originalVideo.sourceId);
		const originalBody = original.bodies.find(item => item.key === (source.storageKey || source.id));
		expect(originalBody.bytes).toEqual([...input.buffer]);
		expect(createHash('sha256').update(Buffer.from(originalBody.bytes)).digest('hex'))
			.toBe(createHash('sha256').update(input.buffer).digest('hex'));
		await selectClip(editor, originalVideo.id);
		let rack = await openRack(page, editor, route);
		const picker = rack.getByRole('group', { name: copy.chooseEffect, exact: true }).getByRole('button');
		await chooseEffectByKeyboard(page, picker, copy.videoEffectCubeLutProfile);
		await key(rack.getByRole('button', { name: copy.addEffect, exact: true }), 'Enter');
		await expect(rack.getByRole('status')).toHaveText(copy.videoEffectCubeLutNone);
		await rack.getByLabel(copy.videoEffectCubeLutImport, { exact: true })
			.setInputFiles({ name: 'independent-quarter-red.cube', mimeType: 'text/plain', buffer: CUBE });
		await expect(rack.getByRole('status')).toHaveText(copy.videoEffectCubeLutAttached);
		await save(page, editor, route);
		let authored = await snapshot(page, originId);
		const cube = authored.project.clips.find(clip => clip.id === originalVideo.id).videoEffects[0];
		expect(cube).toEqual({ id: cube.id, type: 'cube-lut-profile-v1', enabled: true, params: { lut: REFERENCE } });
		expect(authored.project.sources).toEqual(original.project.sources);
		expect(authored.bodies.find(item => item.key === originalBody.key)).toEqual(originalBody);
		expect(authored.bodies.find(item => item.key === REFERENCE.storageKey).bytes).toEqual([...CUBE]);
		expect(authored.project.videoColorContexts).toEqual([expect.objectContaining({
			sequenceId: originalVideo.sequenceId, workingSpace: 'linear-rec709-d65', outputSpace: 'rec709',
		})]);
		await expectExactFrame(editor);
		// Independent Rec.709 encoding of linear quarter-red rounds to 125; sRGB would round to 137.
		await expect.poll(() => centerPixel(editor), { timeout: 30_000 }).toEqual([125, 0, 0, 255]);

		const toggle = rack.getByRole('checkbox', { name: copy.videoEffectCubeLutProfile, exact: true });
		await key(toggle, 'Space');
		await expect(toggle).not.toBeChecked();
		await save(page, editor, route);
		authored = await snapshot(page, originId);
		const disabled = authored.project.clips.find(clip => clip.id === originalVideo.id).videoEffects[0];
		expect(disabled).toEqual({ ...cube, enabled: false });
		await chooseCommandAction(page, editor, route.edit, copy.copy);
		await chooseCommandAction(page, editor, route.file, locale === 'en' ? 'New' : copy.newProject);
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originId);
		const destinationId = await editor.getAttribute('data-project-id');
		await chooseNestedCommandAction(page, editor, route.edit, [copy.paste, copy.paste]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		await save(page, editor, route);
		const pasted = await snapshot(page, destinationId);
		const pastedVideo = pasted.project.clips.find(clip => clip.kind === 'video');
		const pastedAudio = pasted.project.clips.find(clip => clip.kind === 'audio');
		expect(pastedVideo).toBeTruthy();
		expect(pastedAudio).toBeTruthy();
		expect(pasted.project.clips.map(clip => clip.kind).sort()).toEqual(['audio', 'video']);
		expect(pastedVideo.id).not.toBe(originalVideo.id);
		expect(pastedAudio.id).not.toBe(originalAudio.id);
		expect(pastedVideo.avLinkId).toEqual(expect.any(String));
		expect(pastedVideo.avLinkId).not.toBe(originalVideo.avLinkId);
		expect(pastedAudio.avLinkId).toBe(pastedVideo.avLinkId);
		expect(pastedVideo.sourceId).toBe(originalVideo.sourceId);
		expect(pastedAudio.sourceId).toBe(originalAudio.sourceId);
		expect(pastedVideo.videoEffects).toHaveLength(1);
		const copiedEffect = pastedVideo.videoEffects[0];
		expect(copiedEffect).toEqual({ id: copiedEffect.id, type: 'cube-lut-profile-v1', enabled: false, params: { lut: REFERENCE } });
		expect(copiedEffect.id).not.toBe(cube.id);
		expect([...pasted.project.sources].sort((left, right) => left.id.localeCompare(right.id)))
			.toEqual([...authored.project.sources].sort((left, right) => left.id.localeCompare(right.id)));
		expect(pasted.bodies.find(item => item.key === originalBody.key)).toEqual(originalBody);
		expect(pasted.bodies.find(item => item.key === REFERENCE.storageKey).bytes).toEqual([...CUBE]);
		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-project-id', destinationId);
		const reopened = await snapshot(page, destinationId);
		expect(reopened.project).toEqual(pasted.project);
		expect(reopened.bodies).toEqual(pasted.bodies);
		expect(reopened.project.videoColorContexts).toEqual([expect.objectContaining({
			sequenceId: pastedVideo.sequenceId, workingSpace: 'linear-rec709-d65', outputSpace: 'rec709',
		})]);
		await selectClip(editor, pastedVideo.id);
		rack = await openRack(page, editor, route);
		const reopenedToggle = rack.getByRole('checkbox', { name: copy.videoEffectCubeLutProfile, exact: true });
		await expect(reopenedToggle).not.toBeChecked();
		await key(reopenedToggle, 'Space');
		await expect(reopenedToggle).toBeChecked();
		await expectExactFrame(editor);
		await expect.poll(() => centerPixel(editor), { timeout: 30_000 }).toEqual([125, 0, 0, 255]);
		await save(page, editor, route);
		const enabled = await snapshot(page, destinationId);
		expect(enabled.project.sources).toEqual(pasted.project.sources);
		expect(enabled.bodies).toEqual(pasted.bodies);
	});
}

async function key(target, action) {
	await expect(target).toBeEnabled();
	await target.focus();
	await expect(target).toBeFocused();
	await target.press(action);
}
async function chooseEffectByKeyboard(page, button, label) {
	await key(button, 'Enter');
	const listbox = page.getByRole('listbox');
	await expect(listbox).toBeVisible(); await expect(listbox).toBeFocused();
	const options = listbox.getByRole('option'), names = await options.allTextContents(), targetIndex = names.indexOf(label);
	expect(targetIndex).toBeGreaterThanOrEqual(0);
	const targetId = await options.nth(targetIndex).getAttribute('id'); expect(targetId).toBeTruthy();
	// The maintained portal bridges arrows and Enter; ArrowUp clamps at the first option.
	for (let step = 0; step < names.length; step++) await listbox.press('ArrowUp');
	for (let step = 0; step < targetIndex; step++) await listbox.press('ArrowDown');
	await expect(listbox).toHaveAttribute('aria-activedescendant', targetId);
	await listbox.press('Enter');
	await expect(listbox).toBeHidden(); await expect(button).toContainText(label);
}
async function selectClip(editor, id) {
	const clip = editor.locator(`[data-track-lane] [data-clip-id="${id}"][data-clip-kind="video"][role="group"]`);
	await expect(clip).toHaveCount(1);
	await key(clip, 'Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/\bclip-display--selected\b/u);
}
async function openRack(page, editor, route) {
	await chooseNestedCommandAction(page, editor, route.edit, [route.copy.clipBoundaries, route.copy.clipPropertiesCommand]);
	const rack = editor.locator('[data-workspace-panel="clip-properties"] [data-video-effect-rack]');
	await expect(rack).toBeVisible();
	return rack;
}
async function save(page, editor, route) {
	await chooseCommandAction(page, editor, route.file, route.copy.saveProject);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}
async function expectExactFrame(editor) {
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	await expect.poll(() => preview.evaluate(element => ({
		pending: element.dataset.videoPreviewVisualPending,
		error: element.dataset.videoPreviewVisualError,
		omitted: element.dataset.videoPreviewVisualOmittedCount,
	})), { timeout: 30_000 }).toEqual({ pending: 'false', error: '', omitted: '0' });
}
async function centerPixel(editor) {
	const canvas = editor.locator('[data-video-preview-canvas]');
	await expect(canvas).toBeVisible();
	const encoded = (await canvas.screenshot()).toString('base64');
	return canvas.evaluate(async (_canvas, value) => {
		const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		try {
			const sample = document.createElement('canvas'); sample.width = sample.height = 1;
			const context = sample.getContext('2d');
			context.drawImage(bitmap, Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1, 0, 0, 1, 1);
			return [...context.getImageData(0, 0, 1, 1).data];
		} finally { bitmap.close(); }
	}, encoded);
}

/** Read-only native observation. Exact backend layouts are checked before any
 * original/LUT body is read; no fixture mutates the stored recipe or media. */
async function snapshot(page, id) {
	return page.evaluate(async ({ databaseName, directoryName, projectId }) => {
		const request = value => new Promise((resolve, reject) => {
			value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const project = await request(database.transaction('projects').objectStore('projects').get(projectId));
			if (!project) throw new Error('The current Frame project was not durably saved.');
			const keys = new Set(project.sources.filter(source => source.kind === 'video').map(source => source.storageKey || source.id));
			for (const clip of project.clips) for (const effect of clip.videoEffects || []) {
				if (effect.type === 'cube-lut-profile-v1' && effect.params.lut !== null) keys.add(effect.params.lut.storageKey);
			}
			const bodies = [];
			for (const key of [...keys].sort()) {
				const row = await request(database.transaction('mediaAssets').objectStore('mediaAssets').get(key));
				if (!row || row.sourceId !== key || !Number.isSafeInteger(row.size) || row.size < 0) throw new Error('Frame media metadata is missing or malformed.');
				let body;
				if (row.storage === 'opfs') {
					if (typeof row.path !== 'string' || !row.path || row.path.includes('/')) throw new Error('Malformed exact OPFS media path.');
					const root = await navigator.storage.getDirectory();
					const directory = await root.getDirectoryHandle(directoryName);
					body = await (await directory.getFileHandle(row.path)).getFile();
				} else if (row.storage === 'indexeddb-blob') {
					if (!(row.blob instanceof Blob)) throw new Error('The exact IndexedDB media Blob is missing.');
					body = row.blob;
				} else if (row.storage === 'indexeddb-media-chunks-v1') {
					if (typeof row.mediaChunkToken !== 'string' || !Number.isSafeInteger(row.mediaChunkCount)
						|| row.mediaChunkCount < 1 || row.mediaChunkCount > 8) throw new Error('The bounded native media chunk inventory is malformed.');
					const chunks = [];
					for (let index = 0; index < row.mediaChunkCount; index++) {
						const key = `${row.mediaChunkToken}:${String(index).padStart(10, '0')}`;
						const chunk = await request(database.transaction('mediaAssetChunks').objectStore('mediaAssetChunks').get(key));
						if (!chunk || chunk.key !== key || chunk.sourceId !== row.sourceId || chunk.index !== index
							|| chunk.mediaChunkToken !== row.mediaChunkToken || chunk.payloadEncoding !== 'array-buffer-v1'
							|| !(chunk.payloadBytes instanceof ArrayBuffer) || chunk.payloadBytes.byteLength !== chunk.byteLength) {
							throw new Error('The native media chunk body or ownership is missing.');
						}
						chunks.push(chunk.payloadBytes);
					}
					body = new Blob(chunks);
				} else throw new Error('The Frame media backend is unsupported by this exact witness.');
				if (body.size !== row.size || body.size > 64 * 1024) throw new Error('The bounded native media size disagrees with its metadata.');
				const { blob: _blob, ...metadata } = row;
				bodies.push({ key, metadata, bytes: [...new Uint8Array(await body.arrayBuffer())] });
			}
			return { project, bodies };
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, directoryName: FRAMESCAPER_OPFS_DIRECTORY_NAME, projectId: id });
}
