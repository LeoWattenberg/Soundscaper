/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = '/__ffmpeg-input-stream__';
const ROUTES = new Map([
	[`${ROOT}/ffmpeg/classes.js`, route('node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js', 'text/javascript')],
	[`${ROOT}/ffmpeg/const.js`, route('node_modules/@ffmpeg/ffmpeg/dist/esm/const.js', 'text/javascript')],
	[`${ROOT}/ffmpeg/errors.js`, route('node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js', 'text/javascript')],
	[`${ROOT}/ffmpeg/utils.js`, route('node_modules/@ffmpeg/ffmpeg/dist/esm/utils.js', 'text/javascript')],
	[`${ROOT}/ffmpeg/worker.js`, route('node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js', 'text/javascript')],
	[`${ROOT}/core/ffmpeg-core.js`, route('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'text/javascript')],
	[`${ROOT}/core/ffmpeg-core.wasm`, route('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'application/wasm')],
]);

test('FFmpeg consumes a bounded raw-frame ring while exec is running', async ({ browserName, page }) => {
	// Firefox creates @ffmpeg/ffmpeg's class worker and fetches worker.js, then never
	// resolves the worker's own module imports: no further request is made, no ffmpeg log
	// line is emitted, and load hangs until its bound. Chromium completes the same
	// sequence in about a second. The fixture drives the third-party loader directly, so
	// this is that loader's module-worker path under COEP credentialless, not the
	// product's own ffmpeg runtime, which other specs cover on Firefox.
	test.skip(browserName === 'firefox', 'The @ffmpeg/ffmpeg class worker never resolves its module imports on Firefox.');
	test.setTimeout(120_000);
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	// The fixture drives @ffmpeg/ffmpeg's SharedArrayBuffer ring, which only exists in a
	// cross-origin-isolated context. Playwright's Firefox and WebKit do not reach that
	// state from this served fixture, so there is no ring to exercise there.
	test.skip(
		!await page.evaluate(() => globalThis.crossOriginIsolated === true
			&& typeof SharedArrayBuffer === 'function'),
		'The FFmpeg input-stream ring requires cross-origin isolation.',
	);
	const result = await page.evaluate(async (root) => {
		if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
			throw new Error('The FFmpeg input-stream fixture requires cross-origin isolation.');
		}
		const { FFmpeg } = await import(`${root}/ffmpeg/classes.js`);
		const ffmpeg = new FFmpeg();
		const logs = [];
		let stage = 'load';
		const bounded = async (label, operation, timeoutMs = 20_000) => Promise.race([
			operation,
			new Promise((_, reject) => setTimeout(() => {
				reject(new Error(`Timed out during ${label} (stage ${stage}).\n${logs.join('\n')}`));
			}, timeoutMs)),
		]);
		ffmpeg.on('log', ({ type, message }) => {
			logs.push(`${type}: ${message}`);
			if (logs.length > 100) logs.shift();
		});
		await bounded('load', ffmpeg.load({
			classWorkerURL: `${root}/ffmpeg/worker.js`,
			coreURL: `${root}/core/ffmpeg-core.js`,
			wasmURL: `${root}/core/ffmpeg-core.wasm`,
		}), 60_000);
		const width = 32;
		const height = 32;
		const frameCount = 3;
		const input = Uint8Array.from(
			{ length: width * height * 4 * frameCount },
			(_, index) => (index * 37 + Math.floor(index / 17)) % 256,
		);
		stage = 'create';
		const stream = await bounded('create', ffmpeg.createInputStream('/frames.rgba', 4096));
		try {
			stage = 'exec';
			const execution = ffmpeg.exec([
				'-f', 'rawvideo', '-pixel_format', 'rgba',
				'-video_size', `${width}x${height}`, '-framerate', '3',
				'-i', stream.path, '-frames:v', String(frameCount),
				'-c:v', 'rawvideo', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'stream-output.rgba',
			]);
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
			stage = 'write-1';
			await bounded(stage, stream.write(input.subarray(0, 4096)));
			stage = 'write-2';
			await bounded(stage, stream.write(input.subarray(4096, 8192)));
			stage = 'write-3';
			await bounded(stage, stream.write(input.subarray(8192)));
			stage = 'close';
			await bounded(stage, stream.close());
			stage = 'execution';
			const exitCode = await bounded(stage, execution);
			if (exitCode !== 0) throw new Error(`FFmpeg exited ${exitCode}.\n${logs.join('\n')}`);
			stage = 'read-output';
			const output = await bounded(stage, ffmpeg.readFile('stream-output.rgba'));
			return {
				exitCode,
				matches: output instanceof Uint8Array
					&& output.byteLength === input.byteLength
					&& output.every((value, index) => value === input[index]),
				byteLength: output.byteLength,
			};
		} finally {
			await stream.dispose();
			await ffmpeg.deleteFile('stream-output.rgba').catch(() => undefined);
			ffmpeg.terminate();
		}
	}, ROOT);
	expect(result).toEqual({ exitCode: 0, matches: true, byteLength: 12_288 });
});

function route(file, contentType) {
	return Object.freeze({ file: resolve(file), contentType });
}

async function installRoutes(page) {
	await page.route(`**${ROOT}/**`, async (requestRoute) => {
		const pathname = new URL(requestRoute.request().url()).pathname;
		if (pathname === `${ROOT}/index.html`) {
			await requestRoute.fulfill({
				status: 200,
				contentType: 'text/html',
				headers: {
					'Cross-Origin-Opener-Policy': 'same-origin',
					'Cross-Origin-Embedder-Policy': 'credentialless',
				},
				body: '<!doctype html><meta charset="utf-8"><title>FFmpeg stream fixture</title>',
			});
			return;
		}
		const descriptor = ROUTES.get(pathname);
		if (!descriptor) {
			await requestRoute.fulfill({ status: 404, body: 'Not found' });
			return;
		}
		const body = await readFile(descriptor.file);
		await requestRoute.fulfill({
			status: 200,
			contentType: descriptor.contentType,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Embedder-Policy': 'credentialless',
				'Cross-Origin-Resource-Policy': 'same-origin',
				'Content-Length': String(body.byteLength),
			},
			body,
		});
	});
}
