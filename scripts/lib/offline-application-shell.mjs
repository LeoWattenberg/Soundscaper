/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import {
	offlineServiceWorkerTemplateSha256,
	renderOfflineServiceWorker,
} from './offline-service-worker.mjs';

const MAXIMUM_ASSET_BYTES = 25 * 1024 * 1024;
const MAXIMUM_AGGREGATE_BYTES = 256 * 1024 * 1024;
const MAXIMUM_ASSET_COUNT = 4_096;
export const MAXIMUM_INSTALL_ASSET_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_INSTALL_ASSET_COUNT = 128;
const BUILD_MANIFEST = '.offline-build-manifest.json';
const CONTROL_FILES = new Set([
	BUILD_MANIFEST,
	'_headers',
	'_redirects',
	'framescaper/service-worker.js',
	'offline-shell.json',
	'service-worker.js',
]);
const PRODUCT_ENTRIES = Object.freeze({
	framescaper: 'src/framescaper/ui/FramescaperAudioEditorBootstrapV31.tsx',
	soundscaper: 'src/soundscaper/ui/SoundscaperAudioEditorBootstrapV30.tsx',
});
const PRODUCT_WORKERS = Object.freeze({
	framescaper: Object.freeze({
		fallbacks: Object.freeze({ standard: '/framescaper/en/', embedded: '/framescaper/embed/en/' }),
		scope: '/framescaper/',
		scriptUrl: '/framescaper/service-worker.js',
	}),
	soundscaper: Object.freeze({
		fallbacks: Object.freeze({ standard: '/en/', embedded: '/embed/en/' }),
		scope: '/',
		scriptUrl: '/service-worker.js',
	}),
});

export async function generateOfflineApplicationShell({ outputRoot, repositoryRoot }) {
	const root = resolve(outputRoot);
	const repository = resolve(repositoryRoot);
	const previousAudit = await readJsonIfPresent(resolve(root, 'offline-shell.json'));
	const buildManifestPath = resolve(root, BUILD_MANIFEST);
	const buildManifest = await readJsonIfPresent(buildManifestPath);
	await generateProductArtifacts({ outputRoot: root, repositoryRoot: repository });
	const assets = await collectShellAssets(root);
	const workerSha256 = offlineServiceWorkerTemplateSha256();
	const workers = {};
	const releaseIds = {};
	for (const productId of ['framescaper', 'soundscaper']) {
		const worker = PRODUCT_WORKERS[productId];
		const installUrls = buildManifest
			? productInstallUrls({ assets, buildManifest, productId, worker })
			: previousInstallUrls({ assets, previousAudit, productId });
		const installAssets = installUrls.map((url) => assets.find((asset) => asset.url === url));
		validateInstallAssets(installAssets, productId);
		const identity = Object.freeze({
			schemaVersion: 2,
			productId,
			scope: worker.scope,
			workerSha256,
			fallbacks: worker.fallbacks,
			assets,
			installUrls,
		});
		const releaseId = sha256(Buffer.from(JSON.stringify(identity)));
		const configuration = Object.freeze({ ...identity, releaseId });
		const output = resolve(root, `.${worker.scriptUrl}`);
		await mkdir(dirname(output), { recursive: true });
		await writeFile(output, renderOfflineServiceWorker(configuration), 'utf8');
		const installByteLength = installAssets.reduce((total, asset) => total + asset.byteLength, 0);
		workers[productId] = Object.freeze({
			scriptUrl: worker.scriptUrl,
			scope: worker.scope,
			releaseId,
			workerSha256,
			installUrls,
			installAssetCount: installAssets.length,
			installByteLength,
		});
		releaseIds[productId] = releaseId;
	}
	const audit = Object.freeze({ schemaVersion: 2, assets, workers });
	await writeFile(resolve(root, 'offline-shell.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
	if (buildManifest) await unlink(buildManifestPath);
	return Object.freeze({ releaseIds: Object.freeze(releaseIds), assetCount: assets.length });
}

function productInstallUrls({ assets, buildManifest, productId, worker }) {
	if (!plainObject(buildManifest)) throw new Error('Offline build manifest is invalid.');
	const entryKey = Object.keys(buildManifest).find((key) => buildManifest[key]?.isEntry === true);
	if (!entryKey) throw new Error('Offline build manifest has no application entry.');
	const urls = new Set([
		worker.fallbacks.standard,
		worker.fallbacks.embedded,
		`/manifest-${productId}.webmanifest`,
		`/offline-icons/${productId}-180.png`,
		`/offline-icons/${productId}-192.png`,
		`/offline-icons/${productId}-512.png`,
	]);
	if (productId === 'soundscaper') urls.add('/');
	for (const logo of productId === 'framescaper'
		? ['/logo/framescaper-icon.svg']
		: ['/logo/logo-klein-schwarz.svg', '/logo/logo-klein-weiß.svg']) urls.add(logo);
	for (const key of [entryKey, PRODUCT_ENTRIES[productId]]) {
		for (const url of staticManifestClosure(buildManifest, key)) urls.add(url);
	}
	const assetUrls = new Set(assets.map(({ url }) => url));
	for (const url of urls) {
		if (!assetUrls.has(url)) throw new Error(`Offline ${productId} install asset is missing: ${url}`);
	}
	return Object.freeze([...urls].sort());
}

function staticManifestClosure(manifest, rootKey) {
	const pending = [rootKey];
	const visited = new Set();
	const urls = new Set();
	while (pending.length > 0) {
		const key = pending.pop();
		if (visited.has(key)) continue;
		visited.add(key);
		const entry = manifest[key];
		if (!plainObject(entry) || typeof entry.file !== 'string') {
			throw new Error(`Offline build manifest entry is missing: ${key}`);
		}
		for (const path of [entry.file, ...stringArray(entry.css)]) {
			urls.add(`/${path.replace(/^\/+/, '')}`);
		}
		for (const path of stringArray(entry.assets)) {
			if (installCoreAsset(path)) urls.add(`/${path.replace(/^\/+/, '')}`);
		}
		for (const imported of stringArray(entry.imports)) pending.push(imported);
	}
	return urls;
}

function installCoreAsset(path) {
	if (/\.(?:woff2?|[ot]tf|wasm|ny)$/iu.test(path)) return false;
	return !/(?:^|[/_.-])(?:worker|worklet)(?:[/_.-]|$)/iu.test(path);
}

function previousInstallUrls({ assets, previousAudit, productId }) {
	const urls = previousAudit?.schemaVersion === 2
		? previousAudit.workers?.[productId]?.installUrls
		: null;
	if (!Array.isArray(urls)) {
		throw new Error(`Offline build manifest is missing and no prior ${productId} install inventory is available.`);
	}
	const assetUrls = new Set(assets.map(({ url }) => url));
	if (urls.some((url) => typeof url !== 'string' || !assetUrls.has(url))) {
		throw new Error(`Prior ${productId} install inventory no longer matches the build output.`);
	}
	return Object.freeze([...urls]);
}

function validateInstallAssets(assets, productId) {
	if (assets.length < 1 || assets.length > MAXIMUM_INSTALL_ASSET_COUNT || assets.some((asset) => !asset)) {
		throw new Error(`Offline ${productId} install inventory exceeds its asset-count limit.`);
	}
	if (assets.some((asset) => asset.byteLength > 4 * 1024 * 1024)) {
		throw new Error(`Offline ${productId} install asset exceeds its in-flight byte limit.`);
	}
	const totalBytes = assets.reduce((total, asset) => total + asset.byteLength, 0);
	if (!Number.isSafeInteger(totalBytes) || totalBytes > MAXIMUM_INSTALL_ASSET_BYTES) {
		throw new Error(`Offline ${productId} install inventory exceeds its byte limit.`);
	}
}

async function readJsonIfPresent(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

function plainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value) {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
		throw new Error('Offline build manifest contains a malformed path list.');
	}
	return value;
}

async function collectShellAssets(root) {
	const paths = await walk(root);
	const descriptors = [];
	let aggregateBytes = 0;
	for (const path of paths) {
		const relativePath = relative(root, path).split(sep).join('/');
		if (excluded(relativePath)) continue;
		const details = await stat(path);
		if (!details.isFile()) throw new Error(`Offline shell asset is not a regular file: ${relativePath}`);
		if (details.size < 1 || details.size > MAXIMUM_ASSET_BYTES) {
			throw new Error(`Offline shell asset has an invalid byte length: ${relativePath}`);
		}
		aggregateBytes += details.size;
		if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > MAXIMUM_AGGREGATE_BYTES) {
			throw new Error('Offline shell exceeds its aggregate byte limit.');
		}
		const bytes = await readFile(path);
		descriptors.push(Object.freeze({
			url: publicUrl(relativePath),
			byteLength: bytes.byteLength,
			sha256: sha256(bytes),
		}));
		if (descriptors.length > MAXIMUM_ASSET_COUNT) throw new Error('Offline shell has too many assets.');
	}
	descriptors.sort((left, right) => left.url < right.url ? -1 : left.url > right.url ? 1 : 0);
	for (let index = 1; index < descriptors.length; index += 1) {
		if (descriptors[index - 1].url === descriptors[index].url) {
			throw new Error(`Offline shell has a duplicate public URL: ${descriptors[index].url}`);
		}
	}
	if (!descriptors.some(({ url }) => url === '/')) throw new Error('Offline shell root document is missing.');
	return Object.freeze(descriptors);
}

async function generateProductArtifacts({ outputRoot, repositoryRoot }) {
	const products = [
		{
			id: 'soundscaper',
			name: 'Soundscaper',
			description: 'Local-first multitrack audio editor',
			scope: '/',
			startUrl: '/en/',
			source: resolve(repositoryRoot, 'public/logo/logo-klein-schwarz.svg'),
		},
		{
			id: 'framescaper',
			name: 'Framescaper',
			description: 'Local-first video effects and compositing editor',
			scope: '/framescaper/',
			startUrl: '/framescaper/en/',
			source: resolve(repositoryRoot, 'public/logo/framescaper-icon.svg'),
		},
	];
	for (const product of products) {
		for (const size of [180, 192, 512]) {
			const output = resolve(outputRoot, `offline-icons/${product.id}-${size}.png`);
			await mkdir(dirname(output), { recursive: true });
			await writeFile(output, await renderSquarePng(product.source, size));
		}
		const manifest = {
			id: `/${product.id}`,
			name: product.name,
			short_name: product.name,
			description: product.description,
			lang: 'en',
			dir: 'ltr',
			start_url: product.startUrl,
			scope: product.scope,
			display: 'standalone',
			background_color: '#1b1b1b',
			theme_color: '#1b1b1b',
			icons: [192, 512].map((size) => ({
				src: `offline-icons/${product.id}-${size}.png`,
				sizes: `${size}x${size}`,
				type: 'image/png',
				purpose: 'any',
			})),
		};
		await writeFile(
			resolve(outputRoot, `manifest-${product.id}.webmanifest`),
			`${JSON.stringify(manifest, null, 2)}\n`,
			'utf8',
		);
	}
}

async function renderSquarePng(sourcePath, size) {
	const source = await readFile(sourcePath, 'utf8');
	const rootTag = source.match(/<svg\b[^>]*>/u)?.[0];
	const viewBox = rootTag?.match(/\bviewBox="([^"]+)"/u)?.[1]
		?.trim().split(/\s+/u).map(Number);
	if (!rootTag || viewBox?.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
		throw new Error(`Offline icon source has no finite SVG viewBox: ${sourcePath}`);
	}
	const [x, y, width, height] = viewBox;
	const side = Math.max(width, height);
	const squareViewBox = [x - ((side - width) / 2), y - ((side - height) / 2), side, side].join(' ');
	const squareRoot = rootTag
		.replace(/\bwidth="[^"]*"/u, `width="${String(size)}"`)
		.replace(/\bheight="[^"]*"/u, `height="${String(size)}"`)
		.replace(/\bviewBox="[^"]*"/u, `viewBox="${squareViewBox}"`);
	const squareSource = source.replace(/<text\b[\s\S]*?<\/text>/gu, '').replace(rootTag, squareRoot);
	const rendered = new Resvg(squareSource, {
		fitTo: { mode: 'width', value: size },
		font: { loadSystemFonts: false },
	}).render();
	if (rendered.width !== size || rendered.height !== size) {
		throw new Error(`Offline icon raster is ${rendered.width}x${rendered.height}; expected ${size}x${size}.`);
	}
	return rendered.asPng();
}

async function walk(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const paths = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Offline shell output contains a symbolic link: ${path}`);
		if (entry.isDirectory()) paths.push(...await walk(path));
		else paths.push(path);
	}
	return paths;
}

function excluded(relativePath) {
	const name = relativePath.split('/').at(-1);
	return CONTROL_FILES.has(relativePath) || relativePath.startsWith('.vite/') || name?.endsWith('.map');
}

function publicUrl(relativePath) {
	if (relativePath === 'index.html') return '/';
	if (relativePath.endsWith('/index.html')) return `/${relativePath.slice(0, -'index.html'.length)}`;
	return `/${relativePath}`;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
