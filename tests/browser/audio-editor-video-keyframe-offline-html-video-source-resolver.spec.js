/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { transform } from 'esbuild';

import {
	decodedRgbaMatchesOracle,
	videoRetimePreviewMedia,
} from './fixtures/video-retime-preview-media.js';

const ROUTE_ROOT = '/__video-keyframe-offline-html-source__';
const FIXTURE_PATH = `${ROUTE_ROOT}/video-retime-vfr-ordinal.mp4`;

test('seeks exact ordinary and retimed VFR pictures through occurrence-owned real videos', async ({
	browserName,
	page,
}) => {
	test.skip(browserName !== 'chromium', 'The dormant source resolver owns a Chromium HTMLVideo seek path.');
	await installRoutes(page);
	await page.goto(`${ROUTE_ROOT}/index.html`);
	const actual = await page.evaluate(async ({ fixturePath, root, sha256 }) => {
		const { createVideoKeyframeOfflineHtmlVideoSourceResolver } = await import(
			`${root}/src/common/editor/ui/video-keyframe-offline-html-video-source-resolver.ts`
		);
		const response = await fetch(fixturePath);
		if (!response.ok) throw new Error('The VFR source fixture did not load.');
		const blob = await response.blob();
		let urlCreations = 0;
		let urlRevocations = 0;
		const videos = [];
		const nativeCreate = URL.createObjectURL.bind(URL);
		const nativeRevoke = URL.revokeObjectURL.bind(URL);
		const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver({
			sources: [{
				sourceId: 'source-vfr',
				identity: sha256,
				blob,
				clipIds: ['ordinary-clip', 'retimed-clip'],
				decodedWidth: 64,
				decodedHeight: 32,
				displayWidth: 80,
				displayHeight: 32,
				presentationForEntry: (entry) => entry.exactPresentation,
			}],
			document: {
				body: document.body,
				createElement(name) {
					const video = document.createElement(name);
					videos.push(video);
					return video;
				},
			},
			url: {
				createObjectURL(value) { urlCreations += 1; return nativeCreate(value); },
				revokeObjectURL(value) { urlRevocations += 1; nativeRevoke(value); },
			},
			timeoutMs: 2_000,
		});
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 32;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('The VFR source witness requires a 2D context.');
		const signal = new AbortController().signal;
		const mediaTimes = [
			exact(0n), exact(1n, 25n), exact(13n, 100n), exact(1n, 5n), exact(27n, 100n),
		];
		const frames = [];
		let ordinary = null;
		let retimed = null;
		for (let frame = 0; frame < 4; frame += 1) {
			const clipId = frame === 0 ? 'ordinary-clip' : 'retimed-clip';
			const entry = Object.freeze({
				kind: 'video',
				sourceId: 'source-vfr',
				clipId,
				source: Object.freeze({
					kind: 'video', id: 'source-vfr', contentSha256: sha256, width: 80, height: 32,
				}),
				clip: Object.freeze({ kind: 'video', id: clipId, sourceId: 'source-vfr' }),
				// Deliberately wrong: the resolver must consume only exactPresentation.
				sourceTimeSeconds: 9_999,
				exactPresentation: descriptor(frame, mediaTimes),
			});
			const presentation = await resolver.resolveSource(entry, { signal });
			if (frame === 0) ordinary = presentation;
			else {
				if (retimed === null) retimed = presentation;
				else if (retimed !== presentation) throw new Error('A clip occurrence changed decoder lifecycle.');
			}
			await presentation.present(entry, { signal });
			context.drawImage(presentation.drawable, 0, 0, 64, 32);
			frames.push({
				centerRgba: [...context.getImageData(48, 20, 1, 1).data],
				currentTime: presentation.drawable.currentTime,
				isConnected: presentation.drawable.isConnected,
				paused: presentation.drawable.paused,
				decoded: [presentation.decodedWidth, presentation.decodedHeight],
				display: [presentation.displayWidth, presentation.displayHeight],
			});
		}
		const distinctOccurrences = ordinary !== retimed && ordinary.drawable !== retimed.drawable;
		resolver.dispose();
		return {
			frames,
			distinctOccurrences,
			urlCreations,
			urlRevocations,
			videoCount: videos.length,
			allDisconnected: videos.every((video) => !video.isConnected),
		};

		function descriptor(frame, times) {
			return Object.freeze({
				outerCell: frame,
				segmentIndex: frame === 0 ? 0 : 1,
				mode: frame === 0 ? 'constant-forward' : 'ramp-reverse',
				sourceFrame: exact(BigInt(frame)),
				sourceTime: times[frame],
				drawableSourceFrame: frame,
				drawableSourceStartTime: times[frame],
				drawableSourceEndTime: times[frame + 1],
			});
		}

		function exact(numerator, denominator = 1n) {
			return Object.freeze({ numerator, denominator });
		}
	}, { fixturePath: FIXTURE_PATH, root: ROUTE_ROOT, sha256: videoRetimePreviewMedia.outputSha256 });

	expect(actual.videoCount).toBe(2);
	expect(actual.urlCreations).toBe(2);
	expect(actual.urlRevocations).toBe(2);
	expect(actual.distinctOccurrences).toBe(true);
	expect(actual.allDisconnected).toBe(true);
	for (const [index, expected] of videoRetimePreviewMedia.pixelOracle.entries()) {
		expectDecodedRgba(actual.frames[index].centerRgba, expected.centerRgba, `frame ${String(index)} center`);
		expect(actual.frames[index].currentTime).toBe(expected.midpointSeconds);
		expect(actual.frames[index].isConnected).toBe(true);
		expect(actual.frames[index].paused).toBe(true);
		expect(actual.frames[index].decoded).toEqual([64, 32]);
		expect(actual.frames[index].display).toEqual([80, 32]);
	}
});

function expectDecodedRgba(actual, expected, label) {
	expect(
		decodedRgbaMatchesOracle(actual, expected),
		`${label}: expected ${expected.join(',')}, received ${actual.join(',')}`,
	).toBe(true);
}

async function installRoutes(page) {
	const modules = await transpileModules();
	await page.route(`**${ROUTE_ROOT}/index.html`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<!doctype html><meta charset="utf-8"><title>offline HTML video source</title>',
		});
	});
	await page.route(`**${FIXTURE_PATH}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: videoRetimePreviewMedia.file.mimeType,
			body: videoRetimePreviewMedia.file.buffer,
		});
	});
	await page.route(`**${ROUTE_ROOT}/src/common/editor/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		const body = modules.get(pathname);
		await route.fulfill(body === undefined
			? { status: 404, body: `Unknown module ${pathname}` }
			: { status: 200, contentType: 'text/javascript', body });
	});
}

async function transpileModules() {
	const sourceRoot = new URL('../../src/common/editor/', import.meta.url);
	const pending = [new URL('ui/video-keyframe-offline-html-video-source-resolver.ts', sourceRoot)];
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
		const route = `${ROUTE_ROOT}/src/common/editor/${relative}`;
		routes.set(route, code);
		if (route.endsWith('.ts')) routes.set(route.replace(/\.ts$/u, '.js'), code);
	}
	return routes;
}
