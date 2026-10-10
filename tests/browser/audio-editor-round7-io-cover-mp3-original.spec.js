/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { ordinaryCoverMp3Fixture } from '../helpers/ordinary-cover-mp3-fixture.ts';
import { BlobSource, Input, MP3 } from 'mediabunny';

for (const illustrated of [false, true]) test(`ordinary desktop MP3 with album artwork=${String(illustrated)} retains its supported original Overwrite menu`, async ({ page }) => {
	test.setTimeout(60_000);
	const file = await ordinaryCoverMp3Fixture(illustrated);
	const native = await nativeOriginalImportFixture(file);
	try {
		await page.exposeBinding('__nativeOriginal', async (_source, action, request) => await native.bridge[action](
			action === 'writeChunk' ? { ...request, bytes: Uint8Array.from(request.bytes) } : request,
		));
		await page.exposeBinding('__nativeOriginalFetch', async (_source, url, init) => {
			const response = await native.fetch(url, init);
			return { status: response.status, headers: [...response.headers.entries()], base64: Buffer.from(await response.arrayBuffer()).toString('base64') };
		});
		await page.addInitScript(() => {
			const statuses = [];
			Object.defineProperty(globalThis, '__nativeOriginalStatuses', { value: statuses });
			addEventListener('DOMContentLoaded', () => {
				new MutationObserver(() => {
					for (const element of document.querySelectorAll('[data-editor-toast], [data-status]')) {
						const value = element.textContent;
						if (value && !statuses.includes(value)) statuses.push(value);
					}
				}).observe(document.body, { subtree: true, childList: true, characterData: true });
			});
			Object.defineProperty(globalThis, 'soundscaperDesktop', { enumerable: true, value: Object.freeze({ v1: Object.freeze({
				chooseFiles: (request) => globalThis.__nativeOriginal('chooseFiles', request),
				releaseRead: (id) => globalThis.__nativeOriginal('releaseRead', id),
				releaseOriginalFile: (id) => globalThis.__nativeOriginal('releaseOriginalFile', id),
				prepareOriginalOverwrite: (id) => globalThis.__nativeOriginal('prepareOriginalOverwrite', id),
				beginWrite: (request) => globalThis.__nativeOriginal('beginWrite', request),
				writeChunk: (request) => globalThis.__nativeOriginal('writeChunk', { ...request, bytes: [...request.bytes] }),
				finishWrite: (id) => globalThis.__nativeOriginal('finishWrite', id),
				abortWrite: (id) => globalThis.__nativeOriginal('abortWrite', id),
			}) }) });
			const originalFetch = globalThis.fetch.bind(globalThis);
			globalThis.fetch = async (input, init) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (!url.startsWith('soundscaper-app:')) return originalFetch(input, init);
				const result = await globalThis.__nativeOriginalFetch(url, { method: init?.method ?? 'GET', headers: [...new Headers(init?.headers).entries()] });
				return new Response(Uint8Array.from(atob(result.base64), character => character.charCodeAt(0)), { status: result.status, headers: result.headers });
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
		expect(native.choices).toHaveLength(1);
		expect(native.selections[0]).toMatchObject([{ readProfile: 'selected-range-v1', name: file.name,
			originalFile: { name: file.name } }]);
		const menu = await openNestedCommandMenu(page, editor, 'File', []);
		const overwrite = menu.getByRole('menuitem', { name: `Overwrite ${file.name}`, exact: true });
		await expect(overwrite).toBeEnabled();
		await overwrite.click();
		try { await expect.poll(() => native.completed.length, { timeout: 45_000 }).toBe(1); }
		catch (cause) { throw new Error(`Native overwrite did not finish: ${JSON.stringify(native.operations)}; ${JSON.stringify(await page.evaluate(() => globalThis.__nativeOriginalStatuses))}`, { cause }); }
		const output = new Input({ source: new BlobSource(new Blob([Uint8Array.from(await native.savedBytes())])), formats: [MP3] });
		try {
			const audio = await output.getPrimaryAudioTrack();
			expect(audio?.codec).toBe('mp3');
			expect(audio?.sampleRate).toBe(48_000);
			expect(audio?.numberOfChannels).toBe(1);
			expect(await output.computeDuration()).toBeGreaterThan(0.9);
		} finally { output.dispose(); }
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
		expect(native.choices).toHaveLength(2);
	} finally { await native.close(); }
});
