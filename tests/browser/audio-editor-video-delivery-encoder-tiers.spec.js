/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = '/__video-delivery-encoder-tiers__';
const ENTRY_MODULES = ['video-delivery-encoder-tier.ts'];
/** 29.97, stated as the rational a decimal would quietly round away. */
const FRAME_RATE = { num: 30_000, den: 1_001 };
const CANVAS = { width: 64, height: 64 };

test('an eligible Chromium delivery chooses its browser-native encoder explicitly', async ({
	browserName,
	page,
}) => {
	test.skip(browserName !== 'chromium', 'The native delivery-tier witness needs Chromium.');
	const requestedUrls = [];
	page.on('request', (request) => { requestedUrls.push(request.url()); });
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ([root, rate, canvas]) => {
		const tierModule = await import(
			`${root}/src/common/editor/video-delivery-encoder-tier.ts`
		);
		const decision = await tierModule.resolveVideoDeliveryEncoderTier({
			format: 'mp4',
			canvas: { ...canvas, frameRate: rate },
			quality: 'balanced',
			eligible: true,
		});
		return {
			...decision,
			crossOriginIsolated,
			hasSharedArrayBuffer: typeof SharedArrayBuffer === 'function',
		};
	}, [ROOT, FRAME_RATE, CANVAS]);

	expect(requestedUrls.filter(isFfmpegRuntimeRequest)).toEqual([]);
	expect(result).toMatchObject({
		tier: 'webcodecs',
		reason: null,
		crossOriginIsolated: false,
		hasSharedArrayBuffer: false,
	});
	expect(result.codec).toMatch(/^avc1\./u);
	expect(result.bitrate).toBeGreaterThan(0);
});

test('absent and ineligible browser encoders are explicit unavailable errors', async ({ page }) => {
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ([root, rate, canvas]) => {
		const tierModule = await import(
			`${root}/src/common/editor/video-delivery-encoder-tier.ts`
		);
		const request = {
			format: 'mp4',
			canvas: { ...canvas, frameRate: rate },
			quality: 'balanced',
			eligible: true,
		};
		return {
			absent: await capture(() => tierModule.resolveVideoDeliveryEncoderTier(request, null)),
			ineligible: await capture(() => tierModule.resolveVideoDeliveryEncoderTier({
				...request,
				eligible: false,
			})),
		};

		async function capture(operation) {
			try {
				await operation();
				return { resolved: true };
			} catch (error) {
				return {
					resolved: false,
					name: error?.name,
					code: error?.code,
					message: error?.message,
					isUnavailable: error instanceof tierModule.BrowserVideoEncoderUnavailableError,
				};
			}
		}
	}, [ROOT, FRAME_RATE, CANVAS]);

	for (const refusal of [result.absent, result.ineligible]) {
		expect(refusal).toMatchObject({
			resolved: false,
			name: 'BrowserVideoEncoderUnavailableError',
			code: 'BROWSER_VIDEO_ENCODER_UNAVAILABLE',
			isUnavailable: true,
		});
		expect(refusal.message).toMatch(/^Browser-native video export is unavailable:/u);
	}
	expect(result.absent.message).toMatch(/encoder/u);
	expect(result.ineligible.message).toMatch(/keyed frame delivery/u);
});

function isFfmpegRuntimeRequest(value) {
	const url = new URL(value);
	return url.pathname.includes('/node_modules/@ffmpeg/')
		|| url.pathname.includes('/ffmpeg/')
		|| url.pathname.includes('/core/ffmpeg-core');
}

async function installRoutes(page) {
	const routes = await transpileEditorModules();
	await page.route(`**${ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><title>video delivery encoder tier</title>',
			});
			return;
		}
		const descriptor = routes.get(pathname);
		await route.fulfill(descriptor === undefined
			? { status: 404, body: `Unknown fixture path ${pathname}` }
			: { status: 200, ...descriptor });
	});
}

async function transpileEditorModules() {
	const sourceRoot = new URL('../../src/common/editor/', import.meta.url);
	const pending = ENTRY_MODULES.map((name) => new URL(name, sourceRoot));
	const discovered = new Map();
	while (pending.length > 0) {
		const url = pending.pop();
		if (discovered.has(url.href)) continue;
		const filename = fileURLToPath(url);
		const source = await readFile(url, 'utf8');
		const transformed = await transform(source, {
			sourcefile: filename,
			loader: filename.endsWith('.ts') ? 'ts' : 'js',
			format: 'esm',
			target: 'es2022',
			sourcemap: 'inline',
		});
		discovered.set(url.href, transformed.code);
		for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/gu)) {
			const dependency = new URL(match[2], url);
			if (!dependency.pathname.startsWith(sourceRoot.pathname)) continue;
			if (dependency.pathname.endsWith('.js')) {
				const typed = new URL(dependency.href.replace(/\.js$/u, '.ts'));
				try { await readFile(typed, 'utf8'); pending.push(typed); continue; } catch { /* JavaScript owns it. */ }
			}
			pending.push(dependency);
		}
	}
	const routes = new Map();
	for (const [href, code] of discovered) {
		const relative = new URL(href).pathname.slice(sourceRoot.pathname.length);
		const path = `${ROOT}/src/common/editor/${relative}`;
		const descriptor = { body: code, contentType: 'text/javascript' };
		routes.set(path, descriptor);
		if (path.endsWith('.ts')) routes.set(path.replace(/\.ts$/u, '.js'), descriptor);
	}
	return routes;
}
