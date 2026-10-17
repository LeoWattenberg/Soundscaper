/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import { generateOfflineApplicationShell } from '../scripts/lib/offline-application-shell.mjs';
import { isShareTargetSubmission } from '../scripts/lib/offline-share-target-worker.mjs';
import {
	activateOfflineShell,
	handleOfflineShellFetch,
	installOfflineShell,
	validateOfflineShellConfiguration,
} from '../scripts/lib/offline-service-worker.mjs';
import {
	productIconNames,
	productInstallScreenshots,
	productScreenshotNames,
	productWebManifest,
} from '../scripts/lib/product-web-manifest.mjs';
import { MemoryCacheStorage, shellConfiguration, shellResponse } from './helpers/offline-shell-fixtures.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const lightscaperEntry = 'src/lightscaper/ui/LightscaperBootstrap.tsx';
const currentProducts = ['soundscaper', 'framescaper'] as const;

interface InstallIcon {
	readonly src: string;
	readonly sizes: string;
	readonly purpose: string;
}

interface ShellAsset {
	readonly url: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface ShellWorker {
	readonly scriptUrl: string;
	readonly scope: string;
	readonly installUrls: readonly string[];
	readonly installAssetCount: number;
	readonly installByteLength: number;
}

interface ShellAudit {
	readonly schemaVersion: 2;
	readonly assets: readonly ShellAsset[];
	readonly workers: Readonly<Record<string, ShellWorker>>;
}

test('Lightscaper installs its registered surface without claiming unavailable project or media workflows', () => {
	const manifest = productWebManifest({
		id: 'lightscaper', name: 'Lightscaper', description: 'Local-first photo library and develop editor',
		startUrl: '/en/', scope: '/', categories: ['photo', 'productivity', 'utilities'], media: [],
	}) as Record<string, unknown>;
	assert.equal(manifest.id, '/lightscaper');
	assert.equal(manifest.name, 'Lightscaper');
	assert.equal(manifest.start_url, '/en/');
	assert.equal(manifest.scope, '/');
	assert.equal(manifest.display, 'standalone');
	assert.deepEqual(manifest.launch_handler, { client_mode: ['navigate-existing', 'auto'] });
	for (const field of ['screenshots', 'file_handlers', 'share_target', 'shortcuts']) {
		assert.equal(Object.hasOwn(manifest, field), false, `${field} requires an implemented workflow`);
	}
	assert.deepEqual(productScreenshotNames('lightscaper'), []);
	assert.deepEqual(productInstallScreenshots('lightscaper'), []);
	const icons = manifest.icons as readonly InstallIcon[];
	assert.deepEqual(icons.map(({ sizes, purpose }) => `${purpose} ${sizes}`), [
		'any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512',
	]);
});

test('a Lightscaper build precaches its own root-scoped shell and rasterizes real branding', async (context) => {
	const outputRoot = await shellFixture(context);
	const first = await generateOfflineApplicationShell({
		outputRoot, repositoryRoot, environment: { SCAPE_PRODUCT: 'lightscaper' },
	});
	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8')) as ShellAudit;
	assert.equal(audit.schemaVersion, 2);
	assert.deepEqual(Object.keys(audit.workers), ['lightscaper']);
	const worker = audit.workers.lightscaper;
	assert.equal(worker.scriptUrl, '/service-worker.js');
	assert.equal(worker.scope, '/');
	assert.deepEqual(worker.installUrls.filter((url) => url.endsWith('.js')), [
		'/assets/application.js', '/assets/lightscaper-shell.js', '/assets/shared.js',
	]);
	for (const path of ['/', '/en/', '/embed/en/', '/manifest-lightscaper.webmanifest']) {
		assert.ok(worker.installUrls.includes(path), path);
	}
	for (const product of ['soundscaper', 'framescaper', 'lightscaper', 'mindscaper']) {
		assert.ok(worker.installUrls.includes(`/logo/${product}.svg`));
	}
	assert.equal(worker.installUrls.some((url) => url.includes('screenshot') || url.endsWith('.wasm')), false);
	assert.ok(worker.installAssetCount <= 128);
	assert.ok(worker.installByteLength <= 12 * 1024 * 1024);
	for (const name of productIconNames('lightscaper')) {
		const bytes = await readFile(join(outputRoot, `offline-icons/${name}.png`));
		const size = Number(name.split('-').at(-1));
		assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
		assert.equal(bytes.readUInt32BE(16), size);
		assert.equal(bytes.readUInt32BE(20), size);
	}
	for (const product of currentProducts) {
		assert.equal(await readFile(join(outputRoot, `manifest-${product}.webmanifest`)).catch(() => null), null);
		assert.equal(audit.assets.some(({ url }) => url.startsWith(`/offline-icons/${product}-`)), false);
		assert.equal(audit.assets.some(({ url }) => url.startsWith(`/install-screenshots/${product}-`)), false);
	}
	const second = await generateOfflineApplicationShell({
		outputRoot, repositoryRoot, environment: { SCAPE_PRODUCT: 'lightscaper' },
	});
	assert.deepEqual(second.releaseIds, first.releaseIds, 'identical shell bytes keep the release identity');
});

test('current product install cores retain the Lightscaper navigation mark without its install assets', async (context) => {
	for (const product of currentProducts) {
		const outputRoot = await shellFixture(context);
		await writeFixture(outputRoot, 'offline-icons/lightscaper-192.png', 'stale artwork');
		await writeFixture(outputRoot, 'manifest-lightscaper.webmanifest', '{}');
		await generateOfflineApplicationShell({
			outputRoot, repositoryRoot, environment: { SCAPE_PRODUCT: product },
		});
		const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8')) as ShellAudit;
		assert.ok(audit.workers[product].installUrls.includes('/logo/lightscaper.svg'));
		assert.equal(audit.assets.some(({ url }) => url.startsWith('/offline-icons/lightscaper-')), false);
		assert.equal(audit.assets.some(({ url }) => url === '/manifest-lightscaper.webmanifest'), false);
	}
});

test('Lightscaper worker installs, activates and serves offline navigation using its own completion identity', async () => {
	const configuration = shellConfiguration('d', [], { productId: 'lightscaper' });
	assert.doesNotThrow(() => validateOfflineShellConfiguration(configuration));
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({ configuration, cacheStorage, fetchImpl: async (url: string) => shellResponse(url) });
	let claims = 0;
	await activateOfflineShell({
		configuration, cacheStorage, clients: { claim: async () => { claims += 1; } },
	});
	assert.equal(claims, 1);
	assert.deepEqual(await cacheStorage.keys(), [`soundscaper-application-shell-v2-lightscaper-${configuration.releaseId}`]);
	const result = await handleOfflineShellFetch({
		configuration, cacheStorage, origin: 'https://lightscaper.org',
		request: { method: 'GET', mode: 'navigate', url: 'https://lightscaper.org/de/' },
		fetchImpl: async () => { throw new Error('offline'); },
	});
	assert.equal(await result.text(), 'root shell');
});

test('the empty Lightscaper surface declines share submissions while existing share handlers keep working', () => {
	const request = new Request('https://lightscaper.org/share-target', { method: 'POST' });
	const configuration = { ...shellConfiguration('a'), productId: 'lightscaper' };
	assert.equal(isShareTargetSubmission(request, 'https://lightscaper.org', configuration), false);
	for (const productId of currentProducts) {
		assert.equal(isShareTargetSubmission(request, 'https://lightscaper.org', { ...configuration, productId }), true);
	}
});

async function shellFixture(context: TestContext): Promise<string> {
	const outputRoot = await mkdtemp(join(tmpdir(), 'lightscaper-install-shell-'));
	context.after(async () => { await rm(outputRoot, { recursive: true, force: true }); });
	const files = {
		'index.html': '<!doctype html><title>Lightscaper</title>',
		'en/index.html': '<!doctype html><title>Lightscaper</title>',
		'embed/en/index.html': '<!doctype html><title>Lightscaper</title>',
		'assets/application.js': 'export const application = 1;',
		'assets/lightscaper-shell.js': 'export const photoSurface = true;',
		'assets/shared.js': 'export const shared = 1;',
		'assets/soundscaper-core.js': 'export const audio = true;',
		'assets/framescaper-core.js': 'export const video = true;',
		'assets/optional-runtime.wasm': 'optional runtime',
		'.offline-build-manifest.json': JSON.stringify({
			'index.html': {
				file: 'assets/application.js', isEntry: true, imports: ['_shared.js'],
				dynamicImports: [lightscaperEntry],
			},
			'_shared.js': { file: 'assets/shared.js' },
			[lightscaperEntry]: { file: 'assets/lightscaper-shell.js', imports: ['_shared.js'], isDynamicEntry: true },
			'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx': { file: 'assets/soundscaper-core.js' },
			'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx': { file: 'assets/framescaper-core.js' },
		}),
	};
	await Promise.all(Object.entries(files).map(async ([path, content]) => {
		await writeFixture(outputRoot, path, content);
	}));
	for (const product of ['soundscaper', 'framescaper', 'lightscaper', 'mindscaper']) {
		const path = `logo/${product}.svg`;
		await mkdir(join(outputRoot, 'logo'), { recursive: true });
		await copyFile(join(repositoryRoot, 'public', path), join(outputRoot, path));
	}
	for (const product of currentProducts) {
		await writeFixture(outputRoot, `manifest-${product}.webmanifest`, '{}');
		await writeFixture(outputRoot, `offline-icons/${product}-192.png`, 'stale artwork');
		for (const factor of ['wide', 'narrow']) {
			await writeFixture(outputRoot, `install-screenshots/${product}-${factor}.png`, 'current editor capture');
		}
	}
	return outputRoot;
}

async function writeFixture(root: string, path: string, content: string): Promise<void> {
	const target = join(root, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, content);
}
