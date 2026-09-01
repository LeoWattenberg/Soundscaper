/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { handbookPlan, webBuildRouting } from '../scripts/lib/product-web-routing.mjs';

const execFileAsync = promisify(execFile);

/**
 * The handbook is served from a path on the product origin rather than
 * `docs.soundscaper.org`, so nothing about it is reachable unless the product
 * build stages it and the origin's own routing accounts for it. These tests
 * hold the two halves of that to each other.
 */
test('the handbook base path is one authority both the build and the editor read', () => {
	assert.deepEqual(handbookPlan('soundscaper'), {
		basePath: '/docs',
		scope: '/docs/',
		assetScope: '/docs/_astro/',
	});
	assert.equal(handbookPlan('framescaper'), null);
	assert.throws(() => handbookPlan('lightscaper'), /Unsupported web build product/u);
	assert.deepEqual(webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' }).handbook, handbookPlan('soundscaper'));
});

test('the origin names the handbook sitemap from a robots file only its root can carry', async (context) => {
	const outputRoot = await fixture(context);
	await generateRoutes(outputRoot, 'soundscaper');
	assert.equal(
		await readFile(join(outputRoot, 'robots.txt'), 'utf8'),
		'User-agent: *\nAllow: /\n\nSitemap: https://soundscaper.org/docs/sitemap-index.xml\n',
	);

	const framescaperRoot = await fixture(context);
	await generateRoutes(framescaperRoot, 'framescaper');
	assert.equal(
		await readFile(join(framescaperRoot, 'robots.txt'), 'utf8'),
		'User-agent: *\nAllow: /\n',
	);
});

test('staging copies the handbook under its base path, and only into the build that hosts it', async (context) => {
	const outputRoot = await fixture(context);
	const handbook = await handbookFixture(context, '/docs/');
	await stage(outputRoot, 'soundscaper', handbook);
	assert.equal(await readFile(join(outputRoot, 'docs/index.html'), 'utf8'), indexFor('/docs/'));
	assert.equal(await readFile(join(outputRoot, 'docs/reference/index.html'), 'utf8'), 'reference');

	const framescaperRoot = await fixture(context);
	await stage(framescaperRoot, 'framescaper', handbook);
	await assert.rejects(() => readFile(join(framescaperRoot, 'docs/index.html'), 'utf8'), /ENOENT/u);
});

/**
 * Astro bakes the base into every asset URL at build time, so a stale build is
 * not a subset of a correct one - it is a complete-looking site whose every
 * stylesheet and script points at a path the deployment does not serve.
 */
test('staging refuses a handbook built for a different base path', async (context) => {
	const outputRoot = await fixture(context);
	const stale = await handbookFixture(context, '/');
	await assert.rejects(
		() => stage(outputRoot, 'soundscaper', stale),
		/was not built for the base path \/docs\//u,
	);

	const missing = await mkdtemp(join(tmpdir(), 'scape-handbook-missing-'));
	context.after(() => rm(missing, { recursive: true, force: true }));
	await assert.rejects(() => stage(outputRoot, 'soundscaper', missing), /no handbook build/u);
});

test('staging refuses to overwrite a product route standing at the handbook base path', async (context) => {
	const outputRoot = await fixture(context);
	const handbook = await handbookFixture(context, '/docs/');
	await mkdir(join(outputRoot, 'docs'), { recursive: true });
	await writeFile(join(outputRoot, 'docs/index.html'), 'a product document');
	await assert.rejects(() => stage(outputRoot, 'soundscaper', handbook), /already emits \/docs\//u);
	assert.equal(await readFile(join(outputRoot, 'docs/index.html'), 'utf8'), 'a product document');
});

function indexFor(base) {
	return `<!doctype html><link rel="stylesheet" href="${base}_astro/common.css"><title>Handbook</title>`;
}

async function fixture(context) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'scape-handbook-hosting-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await writeFile(join(outputRoot, 'index.html'), `<!doctype html>
<html lang="en" dir="ltr" data-product="soundscaper">
	<head><!-- route-head --><title>Soundscaper</title></head>
	<body><div id="app"></div></body>
</html>`);
	await writeFile(join(outputRoot, '_headers'), await readFile('public/_headers', 'utf8'));
	return outputRoot;
}

async function handbookFixture(context, base) {
	const root = await mkdtemp(join(tmpdir(), 'scape-handbook-build-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, 'index.html'), indexFor(base));
	await writeFile(join(root, 'sitemap-index.xml'), '<sitemapindex />');
	await mkdir(join(root, 'reference'), { recursive: true });
	await writeFile(join(root, 'reference/index.html'), 'reference');
	return root;
}

function generateRoutes(outputRoot, productId) {
	return execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
		cwd: process.cwd(),
		env: { ...process.env, SCAPE_PRODUCT: productId },
	});
}

function stage(outputRoot, productId, handbookRoot) {
	return execFileAsync(process.execPath, ['scripts/stage-handbook-build.mjs', outputRoot, handbookRoot], {
		cwd: process.cwd(),
		env: { ...process.env, SCAPE_PRODUCT: productId },
	});
}
