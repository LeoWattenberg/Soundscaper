/* SPDX-License-Identifier: AGPL-3.0-only */

import { nativeSidecarFixture } from '../../helpers/framescaper-native-sidecar-fixture.ts';

export async function installNativeCaptionSidecar(page, name, text) {
	const fixture = await nativeSidecarFixture(name, text);
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
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'framescaperDesktop', { enumerable: true, value: Object.freeze({ v1: Object.freeze({
			version: 1,
			chooseFiles: (request) => globalThis.__nativeCaptionChoose(request),
			releaseRead: (id) => globalThis.__nativeCaptionRelease(id),
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
	});
	return fixture;
}
