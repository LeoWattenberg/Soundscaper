/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export async function registerNyquistArchivePublication(page) {
	const fixture = new URL('../../fixtures/nyquist-archive/', import.meta.url);
	const [manifest, source, metadata] = await Promise.all([
		readFile(new URL('manifest.json.gz', fixture)).then(bytes => gunzipSync(bytes)),
		readFile(new URL('10bandeq.ny.gz', fixture)).then(bytes => gunzipSync(bytes)),
		readFile(new URL('../../../evidence/nyquist-plugin-publication/catalog-metadata-ed168a19631ec48d0029dfb5c17d16c339a174c1.json', import.meta.url)),
	]);
	await page.route('**/plugins/nyquist/audacityteam.org/**/manifest.json', route => route.fulfill({
		body: manifest, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
	}));
	await page.route('**/plugins/nyquist/audacityteam.org/**/files/10bandeq.ny', route => route.fulfill({
		body: source, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' },
	}));
	await page.route('**/plugins/nyquist/audacityteam.org/**/catalog-metadata-*.json', route => route.fulfill({
		body: metadata, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
	}));
}
