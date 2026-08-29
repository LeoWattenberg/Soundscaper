/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Routes for the retime preview harness page: a bare document, the repository
 * VFR fixture served with byte ranges, and the two retime modules transpiled
 * straight from source so a spec exercises the shipped code rather than a copy.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';

import { videoRetimePreviewMedia } from '../fixtures/video-retime-preview-media.js';

export const HARNESS_ROOT = '/__video-retime-preview__';
export const FIXTURE_PATH = `${HARNESS_ROOT}/video-retime-vfr-ordinal.mp4`;
const MODULE_SOURCES = Object.freeze([
	Object.freeze({
		name: 'video-retime-preview-executor',
		file: new URL('../../../src/common/editor/video-retime-preview-executor.ts', import.meta.url),
	}),
	Object.freeze({
		name: 'video-retime-html-video-seek-port',
		file: new URL('../../../src/common/editor/video-retime-html-video-seek-port.ts', import.meta.url),
	}),
]);

export async function installHarnessRoutes(page, options = {}) {
	const strictModules = options.strictModules === true ? await transpileStrictModules() : new Map();
	await page.route(`**${HARNESS_ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${HARNESS_ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><title>retime preview qualification</title>',
			});
			return;
		}
		if (pathname === FIXTURE_PATH) {
			const bytes = videoRetimePreviewMedia.file.buffer;
			const range = route.request().headers().range;
			const match = range?.match(/^bytes=(\d+)-(\d*)$/u);
			const start = match ? Number(match[1]) : 0;
			const requestedEnd = match?.[2] ? Number(match[2]) : bytes.byteLength - 1;
			const end = Math.min(requestedEnd, bytes.byteLength - 1);
			const body = bytes.subarray(start, end + 1);
			await route.fulfill({
				status: match ? 206 : 200,
				contentType: videoRetimePreviewMedia.file.mimeType,
				headers: {
					'Accept-Ranges': 'bytes',
					'Content-Length': String(body.byteLength),
					...(match ? { 'Content-Range': `bytes ${String(start)}-${String(end)}/${String(bytes.byteLength)}` } : {}),
				},
				body,
			});
			return;
		}
		const module = strictModules.get(pathname);
		if (module !== undefined) {
			await route.fulfill({ status: 200, contentType: 'text/javascript', body: module });
			return;
		}
		await route.fulfill({ status: 404, body: 'Unknown retime preview harness resource.' });
	});
}

async function transpileStrictModules() {
	const routes = new Map();
	for (const descriptor of MODULE_SOURCES) {
		const filename = fileURLToPath(descriptor.file);
		const source = await readFile(descriptor.file, 'utf8');
		const transformed = await transform(source, {
			sourcefile: filename,
			loader: 'ts',
			format: 'esm',
			target: 'es2022',
			sourcemap: 'inline',
		});
		routes.set(`${HARNESS_ROOT}/${descriptor.name}.js`, transformed.code);
		routes.set(`${HARNESS_ROOT}/${descriptor.name}.ts`, transformed.code);
	}
	return routes;
}
