import { readFile } from 'node:fs/promises';

const FFMPEG_RUNTIME_ROOT = 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10';
const FFMPEG_RUNTIME_FILES = new Map([
	['ffmpeg-core.js', {
		file: new URL('../../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	['ffmpeg-core.wasm', {
		file: new URL('../../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url),
		contentType: 'application/wasm',
	}],
]);

/** Route production FFmpeg URLs to the exact pinned npm bytes for deterministic browser integration tests. */
export async function installPinnedFfmpegRuntimeRoutes(page, options = {}) {
	const sameOriginRoot = options.sameOriginRoot ?? null;
	const routeRoot = sameOriginRoot ? `**${sameOriginRoot}` : FFMPEG_RUNTIME_ROOT;
	await page.context().route(`${routeRoot}/**`, async (route) => {
		const fixture = FFMPEG_RUNTIME_FILES.get(new URL(route.request().url()).pathname.split('/').at(-1));
		if (!fixture) return route.fulfill({ status: 404, body: 'Unknown FFmpeg runtime asset.' });
		return route.fulfill({
			status: 200,
			contentType: fixture.contentType,
			headers: {
				'Access-Control-Allow-Origin': '*',
				...(sameOriginRoot ? { 'Cross-Origin-Resource-Policy': 'same-origin' } : {}),
			},
			body: await readFile(fixture.file),
		});
	});
	await page.addInitScript(({ runtimeRoot, sameOriginRoot }) => {
		const nativePostMessage = Worker.prototype.postMessage;
		const localRuntimeURLs = new Map();
		const CORE_SUFFIX = '/ffmpeg-core.js';
		Worker.prototype.postMessage = function postPinnedFfmpegMessage(message, ...rest) {
			// A production build addresses the runtime by manifest digest, so the core lives at
			// `<runtimeRoot>/releases/<digest>/ffmpeg-core.js` rather than directly under the root.
			// Match the whole subtree: a worker fetch that escapes to the network is not routable
			// in every browser, and the real host only serves digests that have been published.
			const requestedCore = message?.type === 'LOAD' ? message?.data?.coreURL : null;
			if (typeof requestedCore !== 'string'
				|| !requestedCore.startsWith(`${runtimeRoot}/`)
				|| !requestedCore.endsWith(CORE_SUFFIX)) {
				return nativePostMessage.call(this, message, ...rest);
			}
			if (sameOriginRoot) {
				const localRoot = `${globalThis.location.origin}${sameOriginRoot}`;
				return nativePostMessage.call(this, {
					...message,
					data: {
						...message.data,
						coreURL: `${localRoot}/ffmpeg-core.js`,
						wasmURL: `${localRoot}/ffmpeg-core.wasm`,
					},
				}, ...rest);
			}
			const releaseRoot = requestedCore.slice(0, -CORE_SUFFIX.length);
			let pending = localRuntimeURLs.get(releaseRoot);
			if (!pending) {
				pending = Promise.all([
					fetch(`${releaseRoot}/ffmpeg-core.js`).then(async (response) => {
						if (!response.ok) throw new Error(`Pinned FFmpeg JavaScript returned HTTP ${String(response.status)}.`);
						return URL.createObjectURL(await response.blob());
					}),
					fetch(`${releaseRoot}/ffmpeg-core.wasm`).then(async (response) => {
						if (!response.ok) throw new Error(`Pinned FFmpeg WASM returned HTTP ${String(response.status)}.`);
						return URL.createObjectURL(await response.blob());
					}),
				]);
				localRuntimeURLs.set(releaseRoot, pending);
			}
			void pending.then(([coreURL, wasmURL]) => nativePostMessage.call(this, {
				...message,
				data: { ...message.data, coreURL, wasmURL },
			}, ...rest));
		};
	}, { runtimeRoot: FFMPEG_RUNTIME_ROOT, sameOriginRoot });
}
