/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { expect, test, toneA, toneB, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	clipField,
	closeDialog,
	collectClientErrors,
	openClipProperties,
	registerAudioEditorHooks,
	stubStorageEstimate,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const shorterTone = createWavFixture({ name: 'shorter-project-bin-tone.wav', frequency: 550, duration: 0.4 });
const originalFrameCount = 38_400;
const shorterFrameCount = 19_200;
const laterStartFrame = 60_000;
const locatorIds = Object.freeze({
	initial: '1'.repeat(64),
	exact: '2'.repeat(64),
	declined: '3'.repeat(64),
	accepted: '4'.repeat(64),
	switched: '5'.repeat(64),
});

test.describe('Project Bin replacement and linked original relink', () => {
	registerAudioEditorHooks();

	test('cancel and Keep timeline spacing preserve the later placement through undo and reload', async ({ page }) => {
		const errors = collectClientErrors(page);
		const { editor, card, firstId, laterId } = await setupShortReplacement(page);
		const originalSourceId = await card.getAttribute('data-source-id');

		await stageShortReplacement(page, card);
		const choice = page.locator('[data-project-bin-replacement-dialog]');
		await expect(choice).toBeVisible();
		await choice.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(choice).toBeHidden();
		await expect(card).toHaveAttribute('data-source-id', originalSourceId);
		await expectClipFrames(page, editor, firstId, { start: 0, duration: originalFrameCount });
		await expectClipFrames(page, editor, laterId, { start: laterStartFrame, duration: originalFrameCount });

		await stageShortReplacement(page, card);
		await choice.getByRole('button', { name: 'Keep timeline spacing', exact: true }).click();
		await expect(choice).toBeHidden();
		await expect(card).not.toHaveAttribute('data-source-id', originalSourceId);
		await expectClipFrames(page, editor, firstId, { start: 0, duration: shorterFrameCount });
		await expectClipFrames(page, editor, laterId, { start: laterStartFrame, duration: shorterFrameCount });
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expectClipFrames(page, editor, firstId, { start: 0, duration: originalFrameCount });
		await expectClipFrames(page, editor, laterId, { start: laterStartFrame, duration: originalFrameCount });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expectClipFrames(page, editor, firstId, { start: 0, duration: shorterFrameCount });
		await expectClipFrames(page, editor, laterId, { start: laterStartFrame, duration: shorterFrameCount });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await waitForEditor(page);
		await expectClipFrames(page, editor, firstId, { start: 0, duration: shorterFrameCount });
		await expectClipFrames(page, editor, laterId, { start: laterStartFrame, duration: shorterFrameCount });
		expect(errors).toEqual([]);
	});

	test('Contract gaps shifts the next instance by the trimmed frames and survives reload', async ({ page }) => {
		const errors = collectClientErrors(page);
		const { editor, card, firstId, laterId } = await setupShortReplacement(page);
		await stageShortReplacement(page, card);
		const choice = page.locator('[data-project-bin-replacement-dialog]');
		await expect(choice).toBeVisible();
		await choice.getByRole('button', { name: 'Contract gaps', exact: true }).click();
		await expect(choice).toBeHidden();
		await expectClipFrames(page, editor, firstId, { start: 0, duration: shorterFrameCount });
		await expectClipFrames(page, editor, laterId, {
			start: laterStartFrame - (originalFrameCount - shorterFrameCount),
			duration: shorterFrameCount,
		});
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expectClipFrames(page, editor, laterId, { start: laterStartFrame, duration: originalFrameCount });
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expectClipFrames(page, editor, laterId, {
			start: laterStartFrame - (originalFrameCount - shorterFrameCount),
			duration: shorterFrameCount,
		});
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await waitForEditor(page);
		await expectClipFrames(page, editor, laterId, {
			start: laterStartFrame - (originalFrameCount - shorterFrameCount),
			duration: shorterFrameCount,
		});
		expect(errors).toEqual([]);
	});

	test('desktop relink of unattributed audio distinguishes exact bytes, declined changes, and accepted changes', async ({ page }) => {
		const errors = collectClientErrors(page);
		await installLinkedAudioBridge(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
		const card = editor.locator('[data-project-bin-item]').first();
		await expect(card).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.initial);
		await clearSourceProvenance(page, projectId);
		await page.reload();
		await waitForEditor(page);
		await expect(card).toBeVisible();
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.initial);

		await chooseRelink(page, card, 'cancel');
		await expect(page.locator('[data-project-bin-relink-changed-dialog]')).toHaveCount(0);
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.initial);
		await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.choices.length)).toBe(1);

		await chooseRelink(page, card, 'exact');
		await expect(page.locator('[data-project-bin-relink-changed-dialog]')).toHaveCount(0);
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.exact);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await chooseRelink(page, card, 'declined');
		const changedDialog = page.locator('[data-project-bin-relink-changed-dialog]');
		await expect(changedDialog).toBeVisible();
		await expect(changedDialog).toContainText('different audio content');
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.exact);
		await changedDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(changedDialog).toBeHidden();
		await expect.poll(() => releasedLocatorIds(page)).toContain(locatorIds.declined);
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.exact);

		await chooseRelink(page, card, 'accepted');
		await expect(changedDialog).toBeVisible();
		await changedDialog.getByRole('button', { name: 'Replace', exact: true }).click();
		await expect(changedDialog).toBeHidden();
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.accepted);
		expect(await releasedLocatorIds(page)).not.toContain(locatorIds.accepted);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await waitForEditor(page);
		await expect.poll(() => linkedAudioLocatorId(page, projectId)).toBe(locatorIds.accepted);
		expect(errors).toEqual([]);
	});

	test('desktop linked-video relink rejects incompatible changes and releases a pending choice on project switch', async ({ page }) => {
		test.setTimeout(120_000);
		const errors = collectClientErrors(page);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installPersistentStorageStub(page);
		await installLinkedVideoBridge(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await editor.getByRole('button', { name: 'Link video', exact: true }).click();
		const card = editor.locator('[data-project-bin-item]').first();
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(() => linkedOriginalLocatorId(page, projectId, 'video')).toBe(locatorIds.initial);
		await clearSourceProvenance(page, projectId);
		await page.reload();
		await waitForEditor(page);
		await expect(card).toBeVisible();
		await expect.poll(() => linkedOriginalLocatorId(page, projectId, 'video')).toBe(locatorIds.initial);

		await chooseVideoRelink(page, card, 'exact');
		await expect(page.locator('[data-project-bin-relink-changed-dialog]')).toHaveCount(0);
		await expect.poll(() => linkedOriginalLocatorId(page, projectId, 'video')).toBe(locatorIds.exact);

		await chooseVideoRelink(page, card, 'declined');
		const changedDialog = page.locator('[data-project-bin-relink-changed-dialog]');
		await expect(changedDialog).toBeVisible();
		await expect(changedDialog).toContainText('different content');
		await changedDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(changedDialog).toBeHidden();
		await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedVideoFixture.released))
			.toContainEqual({ locatorId: locatorIds.declined, locatorRevision: 'c'.repeat(64) });
		await expect.poll(() => linkedOriginalLocatorId(page, projectId, 'video')).toBe(locatorIds.exact);

		await chooseVideoRelink(page, card, 'accepted');
		await expect(changedDialog).toBeVisible();
		await changedDialog.getByRole('button', { name: 'Replace', exact: true }).click();
		await expect(changedDialog).toBeHidden();
		await expect(page.locator('[data-editor-toast="workspace-error"]'))
			.toContainText('The selected video does not match the linked source duration.');
		await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedVideoFixture.released))
			.toContainEqual({ locatorId: locatorIds.accepted, locatorRevision: 'd'.repeat(64) });
		await expect.poll(() => linkedOriginalLocatorId(page, projectId, 'video')).toBe(locatorIds.exact);

		await chooseVideoRelink(page, card, 'switched');
		await expect(changedDialog).toBeVisible();
		// A host project switch can arrive while the modal owns pointer focus.
		await editor.getByRole('button', { name: 'New project', exact: true })
			.evaluate((button) => button.click());
		await expect(editor).not.toHaveAttribute('data-project-id', projectId);
		await expect(changedDialog).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedVideoFixture.released))
			.toContainEqual({ locatorId: locatorIds.switched, locatorRevision: 'e'.repeat(64) });
		await expect.poll(() => linkedOriginalLocatorId(page, projectId, 'video')).toBe(locatorIds.exact);
		expect(errors).toEqual([]);
	});
});

async function setupShortReplacement(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	const add = card.getByRole('button', { name: /Add to timeline/u });
	await add.click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await add.click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const instances = clipByName(editor, toneA.name);
	await expect(instances).toHaveCount(2);
	const [firstId, laterId] = await Promise.all([
		instances.nth(0).getAttribute('data-clip-id'),
		instances.nth(1).getAttribute('data-clip-id'),
	]);
	const later = await openClipProperties(page, editor, instances.nth(1));
	await clipField(later, 'startFrame').fill(String(laterStartFrame));
	await clipField(later, 'startFrame').press('Tab');
	await closeDialog(later);
	await expectClipFrames(page, editor, laterId, { start: laterStartFrame, duration: originalFrameCount });
	return { editor, card, firstId, laterId };
}

async function stageShortReplacement(page, card) {
	await card.getByRole('button', { name: /More file actions/u }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await chooser).setFiles(shorterTone);
}

async function expectClipFrames(page, editor, clipId, expected) {
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	const dialog = await openClipProperties(page, editor, clip);
	await expect(clipField(dialog, 'startFrame')).toHaveValue(String(expected.start));
	await expect(clipField(dialog, 'durationFrame')).toHaveValue(String(expected.duration));
	await closeDialog(dialog);
}

async function chooseRelink(page, card, choice) {
	await page.evaluate((next) => { globalThis.__projectBinLinkedAudioFixture.next = next; }, choice);
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
}

async function releasedLocatorIds(page) {
	return page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.released.map((entry) => entry.locatorId));
}

async function linkedAudioLocatorId(page, projectId) {
	return linkedOriginalLocatorId(page, projectId, 'audio');
}

async function linkedOriginalLocatorId(page, projectId, kind) {
	return page.evaluate(async ({ databaseName, id, sourceKind }) => {
		const request = indexedDB.open(databaseName);
		const database = await new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const transaction = database.transaction('linkedVideoOriginalBindings', 'readonly');
			const query = transaction.objectStore('linkedVideoOriginalBindings').getAll();
			const bindings = await new Promise((resolve, reject) => {
				query.onsuccess = () => resolve(query.result);
				query.onerror = () => reject(query.error);
			});
		return bindings.find((record) => record.projectId === id
			&& (record.binding?.kind === sourceKind || (sourceKind === 'video' && record.binding?.kind === undefined)))
				?.binding.locatorId ?? null;
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId, sourceKind: kind });
}

async function clearSourceProvenance(page, projectId) {
	// Current imports carry attribution; this fixture models an older unattributed project.
	await page.evaluate(async ({ databaseName, id }) => {
		const open = indexedDB.open(databaseName);
		const database = await new Promise((resolve, reject) => {
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		try {
			const transaction = database.transaction('projects', 'readwrite');
			const store = transaction.objectStore('projects');
			const read = store.get(id);
			const project = await new Promise((resolve, reject) => {
				read.onsuccess = () => resolve(read.result);
				read.onerror = () => reject(read.error);
			});
			if (!project?.sources?.some((source) => Object.hasOwn(source, 'provenance'))) {
				throw new Error('The linked import fixture did not carry source attribution.');
			}
			const sources = project.sources.map((source) => {
				const copy = { ...source };
				delete copy.provenance;
				return copy;
			});
			store.put({ ...project, sources });
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

async function installLinkedAudioBridge(page) {
	const media = { original: toneA, changed: toneB };
	await page.route(/\/__e2e-project-bin-linked\/(original|changed)\.wav$/u, (route) => {
		const kind = /\/(original|changed)\.wav$/u.exec(route.request().url())?.[1];
		return route.fulfill({
			body: media[kind].buffer,
			contentType: media[kind].mimeType,
			headers: { 'Content-Length': String(media[kind].buffer.byteLength) },
		});
	});
	await page.addInitScript(({ fixtures, ids }) => {
		const state = { next: 'initial', choices: [], released: [], rangeRequests: [] };
		const details = {
			initial: { kind: 'original', locatorId: ids.initial, locatorRevision: 'a'.repeat(64) },
			exact: { kind: 'original', locatorId: ids.exact, locatorRevision: 'b'.repeat(64) },
			declined: { kind: 'changed', locatorId: ids.declined, locatorRevision: 'c'.repeat(64) },
			accepted: { kind: 'changed', locatorId: ids.accepted, locatorRevision: 'd'.repeat(64) },
		};
		const byId = Object.values(details).reduce((entries, detail) => {
			entries[detail.locatorId] = detail;
			return entries;
		}, {});
		const bytes = Object.fromEntries(Object.entries(fixtures).map(([kind, fixture]) => [
			kind, Uint8Array.from(atob(fixture.base64), (character) => character.charCodeAt(0)),
		]));
		const nativeFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			const match = /\/linked-audio-range-v1\/([a-f\d]{64})\//u.exec(url);
			if (!match) return nativeFetch(input, init);
			const kind = match[1].endsWith('1') ? 'original' : 'changed';
			const header = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Range');
			const interval = /^bytes=(\d+)-(\d+)$/u.exec(header ?? '');
			if (!interval) return new Response(null, { status: 416 });
			const start = Number(interval[1]);
			const end = Number(interval[2]);
			state.rangeRequests.push({ kind, start, end });
			const body = bytes[kind].slice(start, end + 1);
			return new Response(body, { status: 206, headers: {
				'Accept-Ranges': 'bytes',
				'Content-Length': String(body.byteLength),
				'Content-Range': `bytes ${start}-${end}/${bytes[kind].byteLength}`,
				'Content-Type': fixtures[kind].mimeType,
			} });
		};
		const bridge = Object.freeze({
			chooseLinkedAudioOriginal: async () => {
				const selected = state.next;
				state.choices.push(selected);
				if (selected === 'cancel') return null;
				const detail = details[selected];
				const fixture = fixtures[detail.kind];
				return {
					locatorId: detail.locatorId, locatorRevision: detail.locatorRevision,
					name: fixture.name, size: bytes[detail.kind].byteLength,
					mimeType: fixture.mimeType, lastModified: 123,
				};
			},
			loadLinkedAudioOriginal: async ({ locatorId, range }) => {
				const detail = byId[locatorId];
				if (!detail) return null;
				const fixture = fixtures[detail.kind];
				const descriptorId = `${range ? 'e' : 'f'}`.repeat(63) + (detail.kind === 'original' ? '1' : '2');
				return { locatorRevision: detail.locatorRevision, descriptor: {
					id: descriptorId,
					readProfile: range ? 'linked-audio-range-v1' : 'materialized-v1',
					url: range
						? `framescaper-app://bundle/_desktop/read/linked-audio-range-v1/${descriptorId}/${encodeURIComponent(fixture.name)}`
						: `${location.origin}/__e2e-project-bin-linked/${detail.kind}.wav`,
					name: fixture.name, size: bytes[detail.kind].byteLength,
					mimeType: fixture.mimeType, lastModified: 123,
				} };
			},
			reconcileLinkedOriginals: async () => 0,
			releaseLinkedOriginal: async (reference) => { state.released.push(structuredClone(reference)); return true; },
			chooseLinkedVideoOriginal: async () => null,
			loadLinkedVideoOriginal: async () => null,
			reconcileLinkedVideoOriginals: async () => 0,
			releaseLinkedVideoOriginal: async () => true,
			releaseRead: async () => true,
		});
		Object.defineProperty(globalThis, '__projectBinLinkedAudioFixture', { configurable: true, value: state });
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true, enumerable: true, value: Object.freeze({ v1: bridge }),
		});
	}, {
		fixtures: Object.fromEntries(Object.entries(media).map(([kind, fixture]) => [kind, {
			name: fixture.name, mimeType: fixture.mimeType, base64: fixture.buffer.toString('base64'),
		}])),
		ids: locatorIds,
	});
}

async function installPersistentStorageStub(page) {
	await page.addInitScript(() => {
		const storage = navigator.storage ?? {};
		Object.defineProperty(storage, 'persisted', {
			configurable: true,
			value: () => Promise.resolve(true),
		});
		Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
	});
}

async function chooseVideoRelink(page, card, choice) {
	await page.evaluate((next) => { globalThis.__projectBinLinkedVideoFixture.next = next; }, choice);
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
}

async function installLinkedVideoBridge(page) {
	const original = createDeterministicSilentVideoFixture('project-bin-linked-original.webm');
	const changed = {
		...original,
		name: 'project-bin-linked-changed.webm',
		buffer: Buffer.concat([original.buffer, Buffer.from([0])]),
	};
	const variants = {
		initial: { media: original, locatorId: locatorIds.initial, revision: 'a'.repeat(64), readId: '6'.repeat(64) },
		exact: { media: original, locatorId: locatorIds.exact, revision: 'b'.repeat(64), readId: '7'.repeat(64) },
		declined: { media: changed, locatorId: locatorIds.declined, revision: 'c'.repeat(64), readId: '8'.repeat(64) },
		accepted: { media: changed, locatorId: locatorIds.accepted, revision: 'd'.repeat(64), readId: '9'.repeat(64) },
		switched: { media: changed, locatorId: locatorIds.switched, revision: 'e'.repeat(64), readId: 'a'.repeat(64) },
	};
	await page.route('**/__e2e-project-bin-linked-video/*', (route) => {
		const key = new URL(route.request().url()).pathname.split('/').at(-1);
		const media = variants[key]?.media;
		if (!media) return route.abort();
		return route.fulfill({
			body: media.buffer,
			contentType: media.mimeType,
			headers: { 'Content-Length': String(media.buffer.byteLength) },
		});
	});
	await page.addInitScript((records) => {
		const byKey = Object.fromEntries(records.map((record) => [record.key, record]));
		const byLocator = Object.fromEntries(records.map((record) => [record.locatorId, record]));
		const state = { next: 'initial', choices: [], loads: [], released: [] };
		const bridge = Object.freeze({
			chooseLinkedVideoOriginal: async () => {
				state.choices.push(state.next);
				const record = byKey[state.next];
				return {
					locatorId: record.locatorId,
					locatorRevision: record.revision,
					name: record.name,
					size: record.size,
					mimeType: record.mimeType,
					lastModified: 123,
				};
			},
			loadLinkedVideoOriginal: async (request) => {
				state.loads.push(structuredClone(request));
				const { locatorId, playback } = request;
				if (playback) return null;
				const record = byLocator[locatorId];
				if (!record) return null;
				return { locatorRevision: record.revision, descriptor: {
					id: record.readId,
					readProfile: 'materialized-v1',
					url: `${location.origin}/__e2e-project-bin-linked-video/${record.key}`,
					name: record.name,
					size: record.size,
					mimeType: record.mimeType,
					lastModified: 123,
				} };
			},
			reconcileLinkedVideoOriginals: async () => 0,
			releaseLinkedVideoOriginal: async (reference) => {
				state.released.push(structuredClone(reference));
				return true;
			},
		});
		Object.defineProperty(globalThis, '__projectBinLinkedVideoFixture', { configurable: true, value: state });
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true, enumerable: true, value: Object.freeze({ v1: bridge }),
		});
	}, Object.entries(variants).map(([key, variant]) => ({
		key,
		locatorId: variant.locatorId,
		revision: variant.revision,
		readId: variant.readId,
		name: variant.media.name,
		size: variant.media.buffer.byteLength,
		mimeType: variant.media.mimeType,
	})));
}
