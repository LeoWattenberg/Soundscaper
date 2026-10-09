/* SPDX-License-Identifier: AGPL-3.0-only */

import { nativeSidecarFixture } from '../../helpers/framescaper-native-sidecar-fixture.ts';

export async function installNativeCaptionSidecar(page, name, text, options = {}) {
	const fixture = await nativeSidecarFixture(name, text, options);
	await page.exposeBinding('__nativeCaptionSave', async (_source, operation, request) => {
		if (operation === 'writeChunk' || operation === 'patchFinalPrefix') {
			request = { ...request, bytes: Uint8Array.from(request.bytes) };
		}
		return await fixture.bridge[operation](request);
	});
	await page.exposeBinding('__nativeCaptionChoose', async (_source, request) =>
		await fixture.bridge.chooseFiles(request));
	await page.exposeBinding('__nativeCaptionRelease', async (_source, id) =>
		await fixture.bridge.releaseRead(id));
	await page.exposeBinding('__nativeCaptionFetch', async (_source, url, init) => {
		const response = await fixture.fetch(url, init);
		return {
			status: response.status, headers: [...response.headers.entries()],
			bytes: [...new Uint8Array(await response.arrayBuffer())],
		};
	});
	await page.addInitScript(({ nativeSave }) => {
		Object.defineProperty(globalThis, 'framescaperDesktop', { enumerable: true, value: Object.freeze({ v1: Object.freeze({
			version: 1,
			chooseFiles: (request) => globalThis.__nativeCaptionChoose(request),
			releaseRead: (id) => globalThis.__nativeCaptionRelease(id),
			...(nativeSave ? {
				chooseSaveTarget: (request) => globalThis.__nativeCaptionSave('chooseSaveTarget', request),
				beginWrite: (request) => globalThis.__nativeCaptionSave('beginWrite', request),
				writeChunk: (request) => globalThis.__nativeCaptionSave('writeChunk', { ...request, bytes: [...request.bytes] }),
				patchFinalPrefix: (request) => globalThis.__nativeCaptionSave('patchFinalPrefix', { ...request, bytes: [...request.bytes] }),
				finishWrite: (id) => globalThis.__nativeCaptionSave('finishWrite', id),
				abortWrite: (id) => globalThis.__nativeCaptionSave('abortWrite', id),
			} : {}),
		}) }) });
		const fetchBrowser = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (!/^(?:soundscaper|framescaper)-app:/u.test(url)) return fetchBrowser(input, init);
			const result = await globalThis.__nativeCaptionFetch(url, {
				method: init?.method ?? 'GET', headers: [...new Headers(init?.headers).entries()],
			});
			return new Response(Uint8Array.from(result.bytes), { status: result.status, headers: result.headers });
		};
	}, { nativeSave: Boolean(options.saveName) });
	return fixture;
}
