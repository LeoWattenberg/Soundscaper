/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { desktopDownloadUrl } from '../src/common/editor/desktop-download-links.ts';
import {
	handleDesktopDownloadRequest,
	selectLatestDesktopRelease,
} from '../functions/download/desktop/index.ts';

const RELEASE_ROOT = 'https://github.com/LeoWattenberg/Soundscaper/releases';

function release(tag: string, published: string, assetName: string, draft = false): Record<string, unknown> {
	return {
		tag_name: tag, published_at: published, draft,
		assets: [{ name: assetName, state: 'uploaded' }],
	};
}

test('desktop download URLs keep each product on its own origin', () => {
	assert.equal(desktopDownloadUrl('soundscaper'), 'https://soundscaper.org/download/desktop/');
	assert.equal(desktopDownloadUrl('framescaper'), 'https://framescaper.org/download/desktop/');
	assert.throws(() => desktopDownloadUrl('unknown'), /Unsupported editor product/u);
});

test('latest release selection covers published candidates and stable builds with installer assets', () => {
	const releases = [
		release('soundscaper-v1.0.0-rc.9', '2026-09-10T00:00:00Z', 'Soundscaper-1.0.0-rc.9.exe'),
		release('framescaper-v1.0.0-rc.13', '2026-09-29T00:00:00Z', 'Framescaper-1.0.0-rc.13.dmg'),
		release('v1.0.0', '2026-09-28T00:00:00Z', 'Soundscaper-1.0.0.AppImage'),
		release('soundscaper-v1.0.0-rc.11', '2026-09-30T00:00:00Z', 'Soundscaper-1.0.0-rc.11.zip', true),
		release('soundscaper-v1.0.0-rc.10', '2026-10-01T00:00:00Z', 'SHA256SUMS'),
		release('soundscaper-v1.0.0-rc.8', '2026-10-02T00:00:00Z', 'Framescaper-1.0.0-rc.8.exe'),
	];
	assert.equal(selectLatestDesktopRelease(releases, 'soundscaper'), `${RELEASE_ROOT}/tag/v1.0.0`);
	assert.equal(selectLatestDesktopRelease(releases, 'framescaper'), `${RELEASE_ROOT}/tag/framescaper-v1.0.0-rc.13`);
	assert.equal(selectLatestDesktopRelease(releases.slice(0, 2), 'soundscaper'),
		`${RELEASE_ROOT}/tag/soundscaper-v1.0.0-rc.9`);
});

test('download route resolves each origin at request time and never trusts an API HTML URL', async () => {
	const requested: string[] = [];
	const releases = [
		{ ...release('soundscaper-v2.0.0-beta.1', '2026-10-01T00:00:00Z', 'Soundscaper-2.0.0-beta.1.deb'),
			html_url: 'https://attacker.example/download' },
		release('framescaper-v2.0.0-beta.1', '2026-10-02T00:00:00Z', 'Framescaper-2.0.0-beta.1.exe'),
	];
	const fetchImpl: typeof fetch = async (input) => {
		requested.push(String(input));
		return Response.json(releases);
	};
	for (const [hostname, tag] of [
		['soundscaper.org', 'soundscaper-v2.0.0-beta.1'],
		['framescaper.org', 'framescaper-v2.0.0-beta.1'],
	] as const) {
		const response = await handleDesktopDownloadRequest(new Request(`https://${hostname}/download/desktop/`), fetchImpl);
		assert.equal(response.status, 302);
		assert.equal(response.headers.get('location'), `${RELEASE_ROOT}/tag/${tag}`);
		assert.equal(response.headers.get('cache-control'), 'no-store');
	}
	assert.equal(requested.length, 2);
	assert.ok(requested.every((url) => url.startsWith('https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?')));
});

test('download route scans subsequent release pages and requests short edge caching', async () => {
	const requested: string[] = [];
	const signals: AbortSignal[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		requested.push(String(input));
		const signal = init?.signal;
		assert.ok(signal);
		signals.push(signal);
		assert.equal(new Headers(init?.headers).get('x-github-api-version'), '2026-03-10');
		assert.deepEqual((init as CacheableRequestInit | undefined)?.cf, {
			cacheEverything: true,
			cacheTtlByStatus: { '200-299': 300, '400-599': 0 },
		});
		return requested.length === 1
			? Response.json([release('framescaper-v1.0.0-rc.1', '2026-09-01T00:00:00Z',
				'Framescaper-1.0.0-rc.1.exe')], {
				headers: { Link: `<${RELEASE_ROOT}?page=2>; rel="next"` },
			})
			: Response.json([release('soundscaper-v1.0.0-rc.1', '2026-09-02T00:00:00Z',
				'Soundscaper-1.0.0-rc.1.exe')]);
	};
	const response = await handleDesktopDownloadRequest(
		new Request('https://soundscaper.org/download/desktop/'), fetchImpl,
	);
	assert.equal(response.headers.get('location'), `${RELEASE_ROOT}/tag/soundscaper-v1.0.0-rc.1`);
	assert.deepEqual(requested, [
		'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=100&page=1',
		'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=100&page=2',
	]);
	assert.equal(signals[0], signals[1], 'page scans share one lookup deadline');
});

test('download route falls back to the product release search when GitHub is unavailable', async () => {
	const fetchImpl: typeof fetch = async () => { throw new Error('offline'); };
	const response = await handleDesktopDownloadRequest(
		new Request('https://framescaper.org/download/desktop/'), fetchImpl,
	);
	assert.equal(response.status, 302);
	assert.equal(response.headers.get('location'), `${RELEASE_ROOT}?q=framescaper`);
});

test('download route refuses unknown hosts and non-navigation methods', async () => {
	const fetchImpl: typeof fetch = async () => { throw new Error('should not fetch'); };
	assert.equal((await handleDesktopDownloadRequest(
		new Request('https://other.example/download/desktop/'), fetchImpl,
	)).status, 404);
	assert.equal((await handleDesktopDownloadRequest(
		new Request('https://soundscaper.org/download/desktop/', { method: 'POST' }), fetchImpl,
	)).status, 405);
});

test('Pages Functions route only the download path and the existing Freesound API', () => {
	const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')) as unknown;
	assert.deepEqual(routes, {
		version: 1,
		include: ['/api/freesound/*', '/download/desktop', '/download/desktop/*'],
		exclude: [],
	});
});

interface CacheableRequestInit extends RequestInit {
	readonly cf?: unknown;
}
