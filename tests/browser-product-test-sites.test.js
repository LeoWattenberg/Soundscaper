/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import test from 'node:test';

import {
	ordinaryBrowserProductSitePlan,
	prepareOrdinaryBrowserProductSites,
	recordBrowserProductSiteEvidence,
	vitePreviewServer,
	verifyBrowserProductSite,
} from '../scripts/lib/browser-product-test-sites.mjs';

test('ordinary browser product sites use separate validated loopback origins', () => {
	const plan = ordinaryBrowserProductSitePlan({
		PLAYWRIGHT_PORT: '4510',
		PLAYWRIGHT_FRAMESCAPER_PORT: '4517',
	});
	assert.deepEqual(plan.sites.map(({ productId, origin }) => ({ productId, origin })), [
		{ productId: 'soundscaper', origin: 'http://127.0.0.1:4510' },
		{ productId: 'framescaper', origin: 'http://127.0.0.1:4517' },
	]);
	const server = vitePreviewServer(plan.sites[1]);
	assert.equal(server.url, 'http://127.0.0.1:4517/en/');
	assert.match(server.command, /vite\.js preview --outDir \.wrangler\/browser-products\/framescaper/u);
	assert.match(server.command, /--host 127\.0\.0\.1/u);
	assert.match(server.command, /--port 4517/u);
	assert.match(server.command, /--strictPort/u);
	assert.equal(server.ignoreHTTPSErrors, undefined);

	assert.throws(
		() => ordinaryBrowserProductSitePlan({
			PLAYWRIGHT_PORT: '4510',
			PLAYWRIGHT_FRAMESCAPER_PORT: '4510',
		}),
		/different ports/u,
	);
	assert.throws(
		() => ordinaryBrowserProductSitePlan({ PLAYWRIGHT_PORT: 'not-a-port' }),
		/integer port/u,
	);
});

test('ordinary site preparation authenticates Framescaper before copying Soundscaper unchanged', async () => {
	const directory = await browserFixtureDirectory();
	const relativeDirectory = relative(resolve('.'), directory).split('\\').join('/');
	const plan = {
		sites: [
			browserSite('soundscaper', '4540', `${relativeDirectory}/soundscaper`),
			browserSite('framescaper', '4541', `${relativeDirectory}/framescaper`),
		],
	};
	const soundscaperSource = `${relativeDirectory}/soundscaper-source`;
	const productionRedirect = '/framescaper/en/ https://framescaper.org/en/ 301\n';
	try {
		await writeBrowserProductFixture(resolve(soundscaperSource), 'soundscaper', productionRedirect);
		await writeBrowserProductFixture(resolve(plan.sites[1].outputDirectory), 'framescaper');
		await recordBrowserProductSiteEvidence(plan.sites[1]);
		await writeFile(resolve(plan.sites[1].outputDirectory, '_headers'), 'corrupted\n', 'utf8');

		await assert.rejects(
			() => prepareOrdinaryBrowserProductSites(plan, { soundscaperBuildDirectory: soundscaperSource }),
			/verified framescaper browser file changed/u,
		);
		await assert.rejects(
			() => readFile(resolve(plan.sites[0].outputDirectory, '_redirects'), 'utf8'),
			/ENOENT/u,
			'the Soundscaper copy must not begin before Framescaper authenticates',
		);

		await writeFile(resolve(plan.sites[1].outputDirectory, '_headers'), 'headers\n', 'utf8');
		await prepareOrdinaryBrowserProductSites(plan, { soundscaperBuildDirectory: soundscaperSource });
		assert.equal(
			await readFile(resolve(plan.sites[0].outputDirectory, '_redirects'), 'utf8'),
			productionRedirect,
		);
		await assert.doesNotReject(() => verifyBrowserProductSite(plan.sites[0]));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('browser product evidence detects a corrupted downloaded build', async () => {
	const directory = await browserFixtureDirectory();
	const relativeDirectory = relative(resolve('.'), directory).split('\\').join('/');
	const site = Object.freeze({
		productId: 'framescaper',
		origin: 'http://127.0.0.1:4531',
		peerOrigin: 'http://127.0.0.1:4530',
		outputDirectory: relativeDirectory,
	});
	try {
		await mkdir(resolve(directory, 'en'), { recursive: true });
		for (const [path, contents] of [
			['en/index.html', '<html data-product="framescaper"></html>'],
			['_headers', '/*\n\tX-Content-Type-Options: nosniff\n'],
			['_redirects', '# no retired routes\n'],
			['offline-shell.json', '{}\n'],
			['service-worker.js', 'addEventListener("fetch", () => {});\n'],
			['manifest-framescaper.webmanifest', '{}\n'],
		]) await writeFile(resolve(directory, path), contents, 'utf8');
		await recordBrowserProductSiteEvidence(site);
		await assert.doesNotReject(() => verifyBrowserProductSite(site));
		await writeFile(resolve(directory, '_headers'), 'corrupted\n', 'utf8');
		await assert.rejects(() => verifyBrowserProductSite(site), /browser file changed: _headers/u);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

async function browserFixtureDirectory() {
	const root = resolve('.wrangler');
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(resolve(root, 'browser-product-site-test-'));
	assert.match(basename(directory), /^browser-product-site-test-/u);
	return directory;
}

function browserSite(productId, port, outputDirectory) {
	const peerPort = port === '4540' ? '4541' : '4540';
	return Object.freeze({
		productId,
		origin: `http://127.0.0.1:${port}`,
		peerOrigin: `http://127.0.0.1:${peerPort}`,
		outputDirectory,
	});
}

async function writeBrowserProductFixture(directory, productId, redirects = '# no redirects\n') {
	await mkdir(resolve(directory, 'en'), { recursive: true });
	for (const [path, contents] of [
		['en/index.html', `<html data-product="${productId}"></html>`],
		['_headers', 'headers\n'],
		['_redirects', redirects],
		['offline-shell.json', '{}\n'],
		['service-worker.js', 'addEventListener("fetch", () => {});\n'],
		[`manifest-${productId}.webmanifest`, '{}\n'],
	]) await writeFile(resolve(directory, path), contents, 'utf8');
}
