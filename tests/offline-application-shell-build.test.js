/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	generateOfflineApplicationShell,
	MAXIMUM_INSTALL_ASSET_BYTES,
	MAXIMUM_INSTALL_ASSET_COUNT,
} from '../scripts/lib/offline-application-shell.mjs';

test('each product install core retains the approved request and byte ceilings', () => {
	assert.equal(MAXIMUM_INSTALL_ASSET_COUNT, 128);
	assert.equal(MAXIMUM_INSTALL_ASSET_BYTES, 8 * 1024 * 1024);
});

test('offline shell generation inventories exact route URLs and emits installable product manifests', async (context) => {
	const outputRoot = await shellFixture(context);
	const first = await generateOfflineApplicationShell({
		outputRoot,
		repositoryRoot: resolve('.'),
	});
	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8'));
	const urls = audit.assets.map(({ url }) => url);

	assert.equal(audit.schemaVersion, 2);
	assert.deepEqual(Object.keys(audit.workers), ['soundscaper']);
	assert.deepEqual(urls, [...urls].sort());
	assert.deepEqual(urls.filter((url) => url.endsWith('/') || url.endsWith('.js')), [
		'/',
		'/assets/application-abc.js',
		'/assets/framescaper-core.js',
		'/assets/optional-dialog.js',
		'/assets/output-worklet.js',
		'/assets/shared.js',
		'/assets/soundscaper-core.js',
		'/embed/en/',
		'/en/',
	]);
	assert.equal(urls.includes('/_headers'), false);
	assert.equal(urls.includes('/assets/application-abc.js.map'), false);
	assert.equal(urls.includes('/offline-shell.json'), false);
	assert.equal(urls.includes('/service-worker.js'), false);
	assert.equal(urls.includes('/framescaper/service-worker.js'), false);
	assert.equal(urls.includes('/.offline-build-manifest.json'), false);
	assert.equal(await readFile(join(outputRoot, '.offline-build-manifest.json'), 'utf8').catch(() => null), null);

	const soundWorker = audit.workers.soundscaper;
	assert.deepEqual(soundWorker.fallbacks, { standard: '/en/', embedded: '/embed/en/' });
	assert.deepEqual(
		soundWorker.installUrls.filter((url) => url.endsWith('.js')),
		['/assets/application-abc.js', '/assets/shared.js', '/assets/soundscaper-core.js'],
	);
	assert.equal(soundWorker.installUrls.includes('/assets/optional-dialog.js'), false);
	for (const optionalAsset of [
		'/assets/core-font.woff2',
		'/assets/output-worklet.js',
		'/assets/plugin.ny',
		'/assets/runtime-codec.wasm',
	]) assert.equal(urls.includes(optionalAsset), true, optionalAsset);
	for (const worker of [soundWorker]) {
		assert.equal(worker.installUrls.includes('/assets/core-icon.png'), true);
		for (const optionalAsset of [
			'/assets/core-font.woff2',
			'/assets/output-worklet.js',
			'/assets/plugin.ny',
			'/assets/runtime-codec.wasm',
		]) assert.equal(worker.installUrls.includes(optionalAsset), false, optionalAsset);
	}
	assert.ok(soundWorker.installAssetCount < audit.assets.length);

	for (const descriptor of audit.assets) {
		const path = descriptor.url.endsWith('/')
			? join(outputRoot, descriptor.url.slice(1), 'index.html')
			: join(outputRoot, descriptor.url.slice(1));
		const bytes = await readFile(path);
		assert.equal(descriptor.byteLength, bytes.byteLength, descriptor.url);
		assert.equal(descriptor.sha256, createHash('sha256').update(bytes).digest('hex'), descriptor.url);
	}

	const soundscaper = JSON.parse(await readFile(join(outputRoot, 'manifest-soundscaper.webmanifest'), 'utf8'));
	assert.deepEqual(
		{ id: soundscaper.id, scope: soundscaper.scope, startUrl: soundscaper.start_url },
		{ id: '/soundscaper', scope: '/', startUrl: '/en/' },
	);
	for (const manifest of [soundscaper]) {
		assert.equal(manifest.display, 'standalone');
		assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ['192x192', '512x512']);
		for (const icon of manifest.icons) assert.equal((await readFile(join(outputRoot, icon.src))).subarray(1, 4).toString(), 'PNG');
	}
	for (const productId of ['soundscaper']) {
		const appleIcon = await readFile(join(outputRoot, 'offline-icons', `${productId}-180.png`));
		assert.equal(appleIcon.subarray(1, 4).toString(), 'PNG');
	}
	assert.match(await readFile(join(outputRoot, 'service-worker.js'), 'utf8'), new RegExp(soundWorker.releaseId, 'u'));
	assert.equal(await readFile(join(outputRoot, 'framescaper/service-worker.js'), 'utf8').catch(() => null), null);
	assert.equal(await readFile(join(outputRoot, 'manifest-framescaper.webmanifest'), 'utf8').catch(() => null), null);
	assert.equal(await readFile(join(outputRoot, 'logo/framescaper-icon.svg'), 'utf8').catch(() => null), null);

	const second = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });
	assert.deepEqual(second.releaseIds, first.releaseIds, 'identical output produces identical release IDs');
});

test('a Framescaper build installs one root-scoped worker and manifest for its own origin', async (context) => {
	const outputRoot = await shellFixture(context, ['en', 'embed/en']);
	await generateOfflineApplicationShell({
		outputRoot,
		repositoryRoot: resolve('.'),
		environment: { SCAPE_PRODUCT: 'framescaper' },
	});
	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8'));

	assert.deepEqual(Object.keys(audit.workers), ['framescaper']);
	const worker = audit.workers.framescaper;
	assert.equal(worker.scriptUrl, '/service-worker.js');
	assert.equal(worker.scope, '/');
	assert.deepEqual(worker.foreignScopes, []);
	assert.deepEqual(worker.fallbacks, { standard: '/en/', embedded: '/embed/en/' });
	assert.deepEqual(
		worker.installUrls.filter((url) => url.endsWith('/')),
		['/', '/embed/en/', '/en/'],
	);
	assert.equal(worker.installUrls.includes('/assets/soundscaper-core.js'), false);
	assert.equal(worker.installUrls.includes('/manifest-framescaper.webmanifest'), true);
	assert.equal(await readFile(join(outputRoot, 'framescaper/service-worker.js'), 'utf8').catch(() => null), null);
	assert.equal(await readFile(join(outputRoot, 'manifest-soundscaper.webmanifest'), 'utf8').catch(() => null), null);
	assert.match(await readFile(join(outputRoot, 'service-worker.js'), 'utf8'), new RegExp(worker.releaseId, 'u'));

	const manifest = JSON.parse(await readFile(join(outputRoot, 'manifest-framescaper.webmanifest'), 'utf8'));
	assert.deepEqual(
		{ id: manifest.id, scope: manifest.scope, startUrl: manifest.start_url },
		{ id: '/framescaper', scope: '/', startUrl: '/en/' },
	);
});

test('the Soundscaper build owns one root worker that declines the retired prefix', async (context) => {
	const outputRoot = await shellFixture(context);
	await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.'), environment: {} });
	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8'));

	// The origin answers `/framescaper/` with a redirect, so its worker must
	// decline that prefix: the navigation fallback would otherwise read
	// `framescaper` as a locale segment and serve this product's shell there.
	assert.deepEqual(audit.workers.soundscaper.foreignScopes, ['/framescaper/']);
	assert.equal(audit.workers.soundscaper.scriptUrl, '/service-worker.js');
	assert.deepEqual(Object.keys(audit.workers), ['soundscaper']);
});

test('one changed shell byte produces a different release without considering control or source-map files', async (context) => {
	const outputRoot = await shellFixture(context);
	const first = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });

	await writeFile(join(outputRoot, '_headers'), 'changed control metadata');
	await writeFile(join(outputRoot, 'assets/application-abc.js.map'), 'changed source map');
	const ignored = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });
	assert.deepEqual(ignored.releaseIds, first.releaseIds);

	await writeFile(join(outputRoot, 'assets/application-abc.js'), 'export const application = 2;');
	const changed = await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });
	assert.notDeepEqual(changed.releaseIds, first.releaseIds);
});

test('generation rejects an install-core descriptor above the in-flight byte ceiling', async (context) => {
	const outputRoot = await shellFixture(context);
	await writeFile(join(outputRoot, 'assets/application-abc.js'), Buffer.alloc(4 * 1024 * 1024 + 1, 1));
	await assert.rejects(
		generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') }),
		/install asset exceeds its in-flight byte limit/iu,
	);
});

async function shellFixture(context, routes = ['en', 'embed/en']) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-offline-shell-test-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await Promise.all([
		fixtureFile(outputRoot, 'index.html', '<!doctype html><title>Root</title>'),
		...routes.map((route) => fixtureFile(outputRoot, `${route}/index.html`, `<!doctype html><title>${route}</title>`)),
		fixtureFile(outputRoot, 'assets/application-abc.js', 'export const application = 1;'),
		fixtureFile(outputRoot, 'assets/core-font.woff2', 'font'),
		fixtureFile(outputRoot, 'assets/core-icon.png', 'image'),
		fixtureFile(outputRoot, 'assets/shared.js', 'export const shared = 1;'),
		fixtureFile(outputRoot, 'assets/output-worklet.js', 'self.onmessage = () => undefined;'),
		fixtureFile(outputRoot, 'assets/plugin.ny', 'return s;'),
		fixtureFile(outputRoot, 'assets/runtime-codec.wasm', 'wasm'),
		fixtureFile(outputRoot, 'assets/soundscaper-core.js', 'export const soundscaper = 1;'),
		fixtureFile(outputRoot, 'assets/framescaper-core.js', 'export const framescaper = 1;'),
		fixtureFile(outputRoot, 'assets/optional-dialog.js', 'export const optional = 1;'),
		fixtureFile(outputRoot, 'assets/application-abc.js.map', '{}'),
		fixtureFile(outputRoot, 'logo/framescaper-icon.svg', '<svg viewBox="0 0 1 1" />'),
		fixtureFile(outputRoot, 'logo/logo-klein-schwarz.svg', '<svg viewBox="0 0 1 1" />'),
		fixtureFile(outputRoot, 'logo/logo-klein-weiß.svg', '<svg viewBox="0 0 1 1" />'),
		fixtureFile(outputRoot, '_headers', 'test headers'),
		fixtureFile(outputRoot, '.offline-build-manifest.json', JSON.stringify({
			'index.html': {
				file: 'assets/application-abc.js',
				isEntry: true,
				imports: ['_shared.js'],
				dynamicImports: [
					'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx',
					'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
				],
			},
			'_shared.js': {
				file: 'assets/shared.js',
				assets: [
					'assets/core-font.woff2',
					'assets/core-icon.png',
					'assets/output-worklet.js',
					'assets/plugin.ny',
					'assets/runtime-codec.wasm',
				],
			},
			'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx': {
				file: 'assets/soundscaper-core.js', imports: ['_shared.js'], isDynamicEntry: true,
				dynamicImports: ['_optional.js'],
			},
			'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx': {
				file: 'assets/framescaper-core.js', imports: ['_shared.js'], isDynamicEntry: true,
			},
			'_optional.js': { file: 'assets/optional-dialog.js', isDynamicEntry: true },
		})),
	]);
	return outputRoot;
}

async function fixtureFile(root, relativePath, contents) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}
