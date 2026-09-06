/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { Resvg } from '@resvg/resvg-js';

import {
	createSquareOfflineIconSvg,
	generateOfflineApplicationShell,
	MAXIMUM_INSTALL_ASSET_BYTES,
	MAXIMUM_INSTALL_ASSET_COUNT,
} from '../scripts/lib/offline-application-shell.mjs';
import { pagesCachePolicyDescriptors } from '../scripts/lib/pages-deploy-preflight.mjs';
import {
	MEDIA_FILE_TYPES,
	PROJECT_FILE_EXTENSIONS,
	SCAPE_PROJECT_MIME_TYPE,
} from '../scripts/lib/product-web-manifest.mjs';
import { webBuildRouting } from '../scripts/lib/product-web-routing.mjs';
import { STARTUP_GRAPH_REPORT_FILE } from '../scripts/lib/startup-graph-budget.mjs';
import { SCAPE_MIME_TYPE } from '../src/common/editor/scape-project-format.ts';
import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from '../src/common/project-file-extensions.ts';

const INSTALLED_PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);

/** Every member a product manifest emits, in the order it emits them. */
const MANIFEST_FIELDS = Object.freeze([
	'id', 'name', 'short_name', 'description', 'lang', 'dir', 'start_url', 'scope',
	'display', 'display_override', 'orientation', 'categories',
	'background_color', 'theme_color', 'icons',
	'launch_handler', 'file_handlers', 'shortcuts',
]);

/** The category vocabulary the manifest registry names; anything else is invented. */
const STANDARD_CATEGORIES = Object.freeze([
	'books', 'business', 'education', 'entertainment', 'finance', 'fitness', 'food',
	'games', 'government', 'health', 'kids', 'lifestyle', 'magazines', 'medical',
	'music', 'navigation', 'news', 'personalization', 'photo', 'politics',
	'productivity', 'security', 'shopping', 'social', 'sports', 'travel',
	'utilities', 'weather',
]);

test('each product install core retains the approved request and byte ceilings', () => {
	assert.equal(MAXIMUM_INSTALL_ASSET_COUNT, 128);
	assert.equal(MAXIMUM_INSTALL_ASSET_BYTES, 8 * 1024 * 1024);
});

test('offline icon geometry rewrites only exact root SVG attributes', () => {
	const source = '<svg stroke-width="2" data-width="3" width="10" height="5" viewBox="0 0 10 5"></svg>';
	const square = createSquareOfflineIconSvg(source, 512, 'fixture.svg');
	assert.match(square, /stroke-width="2"/u);
	assert.match(square, /data-width="3"/u);
	assert.match(square, /\swidth="512"/u);
	assert.match(square, /\sheight="512"/u);
	assert.match(square, /viewBox="0 -2\.5 10 10"/u);
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
	assert.equal(urls.includes(`/${STARTUP_GRAPH_REPORT_FILE}`), false);
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
		assert.deepEqual(manifest.icons.map(({ purpose, sizes }) => `${purpose} ${sizes}`), [
			'any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512',
		]);
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

	// The origin answers `/framescaper/` with a redirect and serves the handbook
	// at `/docs/`, so its worker must decline both prefixes: the navigation
	// fallback would otherwise read the first segment as a locale and answer
	// either path with this product's editor shell.
	assert.deepEqual(audit.workers.soundscaper.foreignScopes, ['/docs/', '/framescaper/']);
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

test('both installed products declare the same operating-system integration fields', async (context) => {
	for (const productId of INSTALLED_PRODUCTS) {
		const { manifest } = await productShell(context, productId);
		assert.deepEqual(Object.keys(manifest), [...MANIFEST_FIELDS], productId);
		assert.equal(manifest.display, 'standalone', productId);
		assert.deepEqual(manifest.display_override, ['window-controls-overlay', 'standalone'], productId);
		assert.equal(manifest.orientation, 'any', productId);
		// Two windows over one IndexedDB project is the corruption this prevents:
		// a file opened from the OS steers the window that is already running.
		assert.deepEqual(manifest.launch_handler, { client_mode: ['navigate-existing', 'auto'] }, productId);
		assert.ok(manifest.categories.length > 0, productId);
		for (const category of manifest.categories) {
			assert.ok(STANDARD_CATEGORIES.includes(category), `${productId} claims category ${category}`);
		}
	}
});

test('the project file handler accepts exactly the archive suffixes every product opens', async (context) => {
	// The build script cannot import either TypeScript module, so it keeps a copy
	// of both. This is the assertion that stops the copy from drifting.
	assert.deepEqual([...PROJECT_FILE_EXTENSIONS], [...ACCEPTED_PROJECT_FILE_EXTENSIONS]);
	assert.equal(SCAPE_PROJECT_MIME_TYPE, SCAPE_MIME_TYPE);
	for (const productId of INSTALLED_PRODUCTS) {
		const { manifest } = await productShell(context, productId);
		const [projects] = manifest.file_handlers;
		assert.deepEqual(Object.keys(projects.accept), [SCAPE_MIME_TYPE], productId);
		assert.deepEqual(projects.accept[SCAPE_MIME_TYPE], [...ACCEPTED_PROJECT_FILE_EXTENSIONS], productId);
		assert.equal(projects.action, manifest.start_url, productId);
		assert.equal(projects.name, `${manifest.name} project`, productId);
		assert.ok(projects.icons.length > 0, productId);
	}
});

test('each product handles the media it edits, taken from the suffixes its import picker offers', async (context) => {
	const view = await readFile('src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx', 'utf8');
	const advertised = /AUDIO_EDITOR_AUDIO_FILE_ACCEPT = '([^']+)'/u.exec(view)?.[1].split(',');
	assert.ok(advertised, 'the editor still advertises one audio import accept list');
	const edited = { soundscaper: ['audio'], framescaper: ['audio', 'video'] };
	for (const productId of INSTALLED_PRODUCTS) {
		const { manifest } = await productShell(context, productId);
		const media = manifest.file_handlers.at(-1);
		assert.deepEqual(
			Object.keys(media.accept).sort(),
			edited[productId].flatMap((kind) => Object.keys(MEDIA_FILE_TYPES[kind])).sort(),
			productId,
		);
		assert.equal(media.action, manifest.start_url, productId);
		for (const [type, extensions] of Object.entries(media.accept)) {
			assert.match(type, /^(?:audio|video)\/[a-z0-9.+-]+$/u, `${productId} handles ${type}`);
			assert.ok(extensions.length > 0, `${productId} ${type}`);
			for (const extension of extensions) {
				assert.match(extension, /^\.[a-z0-9]+$/u, `${productId} ${extension}`);
				assert.ok(advertised.includes(extension), `${productId} genuinely imports ${extension}`);
			}
		}
	}
	// Soundscaper edits audio; only Framescaper claims the moving image.
	const audioOnly = await productShell(context, 'soundscaper');
	assert.equal(
		JSON.stringify(audioOnly.manifest.file_handlers).includes('video/'),
		false,
	);
});

test('every manifest action, shortcut and icon resolves inside the product scope', async (context) => {
	for (const productId of INSTALLED_PRODUCTS) {
		const { manifest } = await productShell(context, productId);
		const base = new URL(`https://${productId}.test/manifest-${productId}.webmanifest`);
		const inside = (value, label) => {
			const resolved = new URL(value, base);
			assert.equal(resolved.origin, base.origin, label);
			assert.ok(resolved.pathname.startsWith(manifest.scope), `${label} resolves to ${resolved.pathname}`);
		};
		inside(manifest.start_url, `${productId} start_url`);
		for (const handler of manifest.file_handlers) inside(handler.action, `${productId} ${handler.name} action`);
		for (const shortcut of manifest.shortcuts) {
			inside(shortcut.url, `${productId} ${shortcut.name} url`);
			// A runtime that never reads the launch query still opens the editor.
			assert.ok(shortcut.url.startsWith(manifest.start_url), `${productId} ${shortcut.name}`);
			assert.ok(shortcut.name.length > 0 && shortcut.icons.length > 0, `${productId} ${shortcut.url}`);
		}
		assert.deepEqual(manifest.shortcuts.map(({ name }) => name), ['New project', 'Open a project'], productId);
		for (const icon of [
			...manifest.icons,
			...manifest.file_handlers.flatMap(({ icons }) => icons),
			...manifest.shortcuts.flatMap(({ icons }) => icons),
		]) inside(icon.src, `${productId} icon ${icon.src}`);
	}
});

test('both icon purposes ship at both sizes, and a maskable raster is a file of its own', async (context) => {
	for (const productId of INSTALLED_PRODUCTS) {
		const { audit, manifest, outputRoot } = await productShell(context, productId);
		assert.deepEqual(manifest.icons.map(({ purpose, sizes }) => `${purpose} ${sizes}`), [
			'any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512',
		], productId);
		const digests = new Map();
		for (const icon of manifest.icons) {
			const bytes = await readFile(join(outputRoot, icon.src));
			assert.equal(bytes.subarray(1, 4).toString(), 'PNG', icon.src);
			assert.equal(icon.type, 'image/png', icon.src);
			digests.set(icon.src, createHash('sha256').update(bytes).digest('hex'));
			assert.ok(audit.workers[productId].installUrls.includes(`/${icon.src}`), `${icon.src} is precached`);
		}
		for (const size of [192, 512]) {
			assert.notEqual(
				digests.get(`offline-icons/${productId}-${size}.png`),
				digests.get(`offline-icons/${productId}-maskable-${size}.png`),
				`${productId} rasterizes ${size} twice rather than relabelling one file`,
			);
		}
	}
});

test('a maskable icon pads its artwork into the middle 80% over an opaque plate', () => {
	const source = '<svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" /></svg>';
	const maskable = createSquareOfflineIconSvg(source, 512, 'fixture.svg', { safeZone: 0.8, background: '#ffffff' });
	assert.match(maskable, /viewBox="-1\.25 -1\.25 12\.5 12\.5"/u);
	assert.match(maskable, /<svg[^>]*><rect x="-1\.25" y="-1\.25" width="12\.5" height="12\.5" fill="#ffffff" \/>/u);
	assert.equal(createSquareOfflineIconSvg(source, 512, 'fixture.svg').includes('#ffffff'), false);
	for (const safeZone of [0, -1, 1.25, Number.NaN]) {
		assert.throws(() => createSquareOfflineIconSvg(source, 512, 'fixture.svg', { safeZone }), /safe zone/u);
	}
});

test('the maskable artwork of both product marks stays inside the safe circle', async () => {
	// Android crops a maskable icon into whatever shape a launcher draws, and the
	// one region every shape keeps is the circle whose diameter is 80% of the
	// icon. Padding the artwork into the middle 80% is what puts it there, and
	// this measures the result rather than trusting the geometry.
	const size = 512;
	for (const source of ['public/logo/logo-klein-schwarz.svg', 'public/logo/framescaper-icon.svg']) {
		const svg = createSquareOfflineIconSvg(await readFile(source, 'utf8'), size, source, { safeZone: 0.8 });
		const { pixels } = new Resvg(svg, {
			fitTo: { mode: 'width', value: size },
			font: { loadSystemFonts: false },
		}).render();
		const centre = size / 2;
		let inkRadius = 0;
		for (let y = 0; y < size; y += 1) {
			for (let x = 0; x < size; x += 1) {
				if (pixels[(((y * size) + x) * 4) + 3] <= 8) continue;
				inkRadius = Math.max(inkRadius, Math.hypot((x + 0.5) - centre, (y + 0.5) - centre));
			}
		}
		assert.ok(inkRadius > 0, `${source} rendered nothing`);
		assert.ok(inkRadius <= size * 0.4, `${source} paints ${inkRadius.toFixed(1)}px from the centre`);
	}
});

test('a single-product build drops the other product icons and publishes its own maskable pair', async (context) => {
	const outputRoot = await shellFixture(context);
	const stale = ['framescaper-192', 'framescaper-maskable-192', 'framescaper-maskable-512'];
	for (const name of stale) await fixtureFile(outputRoot, `offline-icons/${name}.png`, 'stale');
	await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.') });
	for (const name of stale) {
		assert.equal(await readFile(join(outputRoot, `offline-icons/${name}.png`)).catch(() => null), null, name);
	}

	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const introduced = [
		'/offline-icons/soundscaper-maskable-192.png',
		'/offline-icons/soundscaper-maskable-512.png',
	];
	const published = pagesCachePolicyDescriptors({ routing, assetPath });
	for (const path of introduced) {
		assert.deepEqual(
			published.find((descriptor) => descriptor.path === path),
			{ path, expectation: 'served', cacheControl: 'no-cache' },
		);
	}
	// The pre-deploy gate reads the deployment being replaced, which cannot
	// already serve a file this build is the first to emit, so it audits neither
	// the routes this build retires nor the artwork it introduces.
	const predecessor = pagesCachePolicyDescriptors({ routing, assetPath, includeRetired: false });
	assert.equal(predecessor.some(({ path }) => introduced.includes(path)), false);
});

async function productShell(context, productId) {
	const outputRoot = await shellFixture(context);
	await generateOfflineApplicationShell({
		outputRoot,
		repositoryRoot: resolve('.'),
		environment: { SCAPE_PRODUCT: productId },
	});
	return {
		outputRoot,
		audit: JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8')),
		manifest: JSON.parse(await readFile(join(outputRoot, `manifest-${productId}.webmanifest`), 'utf8')),
	};
}

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
		fixtureFile(outputRoot, STARTUP_GRAPH_REPORT_FILE, '{"product":"soundscaper","graphs":{}}'),
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
