/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { generateOfflineApplicationShell } from '../scripts/lib/offline-application-shell.mjs';

test('offline shell generation inventories exact route URLs and emits installable product manifests', async (context) => {
	const outputRoot = await shellFixture(context);
	const first = await generateOfflineApplicationShell({
		outputRoot,
		repositoryRoot: resolve('.'),
	});
	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8'));
	const urls = audit.assets.map(({ url }) => url);

	assert.equal(first.releaseId, audit.releaseId);
	assert.match(audit.releaseId, /^[a-f\d]{64}$/u);
	assert.deepEqual(urls, [...urls].sort());
	assert.deepEqual(urls.filter((url) => url.endsWith('/') || url.endsWith('.js')), [
		'/',
		'/assets/application-abc.js',
		'/en/',
		'/framescaper/en/',
	]);
	assert.equal(urls.includes('/_headers'), false);
	assert.equal(urls.includes('/assets/application-abc.js.map'), false);
	assert.equal(urls.includes('/offline-shell.json'), false);
	assert.equal(urls.includes('/service-worker.js'), false);

	for (const descriptor of audit.assets) {
		const path = descriptor.url.endsWith('/')
			? join(outputRoot, descriptor.url.slice(1), 'index.html')
			: join(outputRoot, descriptor.url.slice(1));
		const bytes = await readFile(path);
		assert.equal(descriptor.byteLength, bytes.byteLength, descriptor.url);
		assert.equal(descriptor.sha256, createHash('sha256').update(bytes).digest('hex'), descriptor.url);
	}

	const soundscaper = JSON.parse(await readFile(join(outputRoot, 'manifest-soundscaper.webmanifest'), 'utf8'));
	const framescaper = JSON.parse(await readFile(join(outputRoot, 'manifest-framescaper.webmanifest'), 'utf8'));
	assert.deepEqual(
		{ id: soundscaper.id, scope: soundscaper.scope, startUrl: soundscaper.start_url },
		{ id: '/soundscaper', scope: '/', startUrl: '/en/' },
	);
	assert.deepEqual(
		{ id: framescaper.id, scope: framescaper.scope, startUrl: framescaper.start_url },
		{ id: '/framescaper', scope: '/framescaper/', startUrl: '/framescaper/en/' },
	);
	for (const manifest of [soundscaper, framescaper]) {
		assert.equal(manifest.display, 'standalone');
		assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ['192x192', '512x512']);
		for (const icon of manifest.icons) assert.equal((await readFile(join(outputRoot, icon.src))).subarray(1, 4).toString(), 'PNG');
	}
	for (const productId of ['soundscaper', 'framescaper']) {
		const appleIcon = await readFile(join(outputRoot, 'offline-icons', `${productId}-180.png`));
		assert.equal(appleIcon.subarray(1, 4).toString(), 'PNG');
	}
	assert.match(await readFile(join(outputRoot, 'service-worker.js'), 'utf8'), new RegExp(audit.releaseId, 'u'));

	const second = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });
	assert.equal(second.releaseId, first.releaseId, 'identical output produces an identical release ID');
});

test('one changed shell byte produces a different release without considering control or source-map files', async (context) => {
	const outputRoot = await shellFixture(context);
	const first = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });

	await writeFile(join(outputRoot, '_headers'), 'changed control metadata');
	await writeFile(join(outputRoot, 'assets/application-abc.js.map'), 'changed source map');
	const ignored = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });
	assert.equal(ignored.releaseId, first.releaseId);

	await writeFile(join(outputRoot, 'assets/application-abc.js'), 'export const application = 2;');
	const changed = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });
	assert.notEqual(changed.releaseId, first.releaseId);
});

async function shellFixture(context) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-offline-shell-test-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await Promise.all([
		fixtureFile(outputRoot, 'index.html', '<!doctype html><title>Root</title>'),
		fixtureFile(outputRoot, 'en/index.html', '<!doctype html><title>Soundscaper</title>'),
		fixtureFile(outputRoot, 'framescaper/en/index.html', '<!doctype html><title>Framescaper</title>'),
		fixtureFile(outputRoot, 'assets/application-abc.js', 'export const application = 1;'),
		fixtureFile(outputRoot, 'assets/application-abc.js.map', '{}'),
		fixtureFile(outputRoot, '_headers', 'test headers'),
	]);
	return outputRoot;
}

async function fixtureFile(root, relativePath, contents) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}
