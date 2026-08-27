/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { ROUTE_LOCALES } from '../src/common/i18n/locales.js';
import { TRANSFER_ROUTES } from '../src/common/transfer/transfer-routes.js';

const execFileAsync = promisify(execFile);

test('static web routes receive product-specific install manifests and Apple touch icons', async (context) => {
	const outputRoot = await generateRoutes(context, {});

	const root = await readFile(join(outputRoot, 'index.html'), 'utf8');
	const soundscaper = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	const framescaper = await readFile(join(outputRoot, 'framescaper/en/index.html'), 'utf8');
	const framescaperEmbed = await readFile(join(outputRoot, 'framescaper/embed/en/index.html'), 'utf8');
	assertInstallLinks(root, 'soundscaper');
	assertInstallLinks(soundscaper, 'soundscaper');
	assertInstallLinks(framescaper, 'framescaper');
	assertInstallLinks(framescaperEmbed, 'framescaper');
	assert.doesNotMatch(framescaper, /manifest-soundscaper|soundscaper-180/u);
	// Every build also emits the two cross-origin transfer documents: they
	// belong to the origin rather than to a product, so both builds carry them.
	assert.equal(await documentCount(outputRoot), 1 + ROUTE_LOCALES.length * 4 + TRANSFER_ROUTES.length);
	assert.match(soundscaper, /<link rel="canonical" href="https:\/\/soundscaper\.org\/en\/" \/>/u);
	assert.match(framescaper, /<link rel="canonical" href="https:\/\/soundscaper\.org\/framescaper\/en\/" \/>/u);
});

test('a Framescaper build serves its own origin root and never the transitional prefix', async (context) => {
	const outputRoot = await generateRoutes(context, { SCAPE_PRODUCT: 'framescaper' });

	assert.equal(await documentCount(outputRoot), 1 + ROUTE_LOCALES.length * 2 + TRANSFER_ROUTES.length);
	assert.equal(await readFile(join(outputRoot, 'framescaper/en/index.html'), 'utf8').catch(() => null), null);
	const root = await readFile(join(outputRoot, 'index.html'), 'utf8');
	const framescaper = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	const embedded = await readFile(join(outputRoot, 'embed/de/index.html'), 'utf8');
	for (const html of [root, framescaper, embedded]) {
		assertInstallLinks(html, 'framescaper');
		assert.match(html, /<html lang="[\w-]+" dir="\w+" data-product="framescaper">/u);
		assert.match(html, /<title>Framescaper<\/title>/u);
	}
	assert.doesNotMatch(framescaper, /manifest-soundscaper|soundscaper-180|\/framescaper\//u);
});

test('a Framescaper build self-canonicalizes to its own origin on every locale alternate', async (context) => {
	const outputRoot = await generateRoutes(context, { SCAPE_PRODUCT: 'framescaper' });
	const framescaper = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	const embedded = await readFile(join(outputRoot, 'embed/en/index.html'), 'utf8');

	assert.match(framescaper, /<link rel="canonical" href="https:\/\/framescaper\.org\/en\/" \/>/u);
	assert.match(embedded, /<link rel="canonical" href="https:\/\/framescaper\.org\/embed\/en\/" \/>/u);
	assert.doesNotMatch(framescaper, /soundscaper\.org/u);
	const alternates = Array.from(framescaper.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/gu));
	assert.equal(alternates.length, ROUTE_LOCALES.length + 1);
	for (const [, hreflang, href] of alternates) {
		const locale = hreflang === 'x-default' ? 'en' : hreflang;
		assert.equal(href, `https://framescaper.org/${locale}/`);
	}
});

test('a configured Framescaper site overrides the default origin without disturbing Soundscaper', async (context) => {
	const framescaperRoot = await generateRoutes(context, {
		SCAPE_PRODUCT: 'framescaper',
		FRAMESCAPER_SITE: 'https://preview.framescaper.org',
		SOUNDSCAPER_SITE: 'https://preview.soundscaper.org',
	});
	const soundscaperRoot = await generateRoutes(context, { SOUNDSCAPER_SITE: 'https://preview.soundscaper.org' });

	assert.match(
		await readFile(join(framescaperRoot, 'en/index.html'), 'utf8'),
		/<link rel="canonical" href="https:\/\/preview\.framescaper\.org\/en\/" \/>/u,
	);
	assert.match(
		await readFile(join(soundscaperRoot, 'framescaper/en/index.html'), 'utf8'),
		/<link rel="canonical" href="https:\/\/preview\.soundscaper\.org\/framescaper\/en\/" \/>/u,
	);
});

test('an unknown build product is refused rather than silently served as Soundscaper', async (context) => {
	await assert.rejects(
		() => generateRoutes(context, { SCAPE_PRODUCT: 'lightscaper' }),
		/Unsupported web build product: lightscaper/u,
	);
});

test('stable install metadata and icon URLs require revalidation', async (context) => {
	const shared = await readFile('public/_headers', 'utf8');
	assert.match(shared, /\/offline-icons\/\*\n\tCache-Control: no-cache/u);
	assert.match(shared, /\/logo\/\*\n\tCache-Control: no-cache/u);
	assert.match(shared, /\/manifest-\*\.webmanifest\n\tCache-Control: no-cache/u);

	const soundscaper = await readFile(join(await generateRoutes(context, {}), '_headers'), 'utf8');
	assert.match(soundscaper, /\/service-worker\.js\n\tCache-Control: no-store\n\tService-Worker-Allowed: \/\n/u);
	assert.match(soundscaper, /\/framescaper\/service-worker\.js\n\tCache-Control: no-store\n\tService-Worker-Allowed: \/framescaper\//u);

	const framescaper = await readFile(
		join(await generateRoutes(context, { SCAPE_PRODUCT: 'framescaper' }), '_headers'),
		'utf8',
	);
	assert.match(framescaper, /\/service-worker\.js\n\tCache-Control: no-store\n\tService-Worker-Allowed: \/\n/u);
	assert.doesNotMatch(framescaper, /\/framescaper\/service-worker\.js/u);
	assert.equal(framescaper.includes('@product-document-rules@'), false);
});

async function generateRoutes(context, environment) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-install-routes-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, 'index.html'), `<!doctype html>
<html lang="en" dir="ltr" data-product="soundscaper">
	<head><!-- route-head --><title>Soundscaper</title></head>
	<body><div id="app"></div></body>
</html>`);
	await writeFile(join(outputRoot, '_headers'), await readFile('public/_headers', 'utf8'));
	await execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
		cwd: process.cwd(),
		env: { ...process.env, SCAPE_PRODUCT: '', SOUNDSCAPER_SITE: '', FRAMESCAPER_SITE: '', ...environment },
	});
	return outputRoot;
}

async function documentCount(root) {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries.filter((entry) => entry.isFile() && entry.name === 'index.html').length;
}

function assertInstallLinks(html, productId) {
	assert.match(html, new RegExp(`<link rel="manifest" href="/manifest-${productId}\\.webmanifest" data-product-manifest \\/>`, 'u'));
	assert.match(html, new RegExp(`<link rel="apple-touch-icon" sizes="180x180" href="/offline-icons/${productId}-180\\.png" data-product-install-icon \\/>`, 'u'));
}
