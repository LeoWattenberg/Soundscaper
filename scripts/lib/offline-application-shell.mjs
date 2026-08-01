/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import {
	offlineServiceWorkerTemplateSha256,
	renderOfflineServiceWorker,
} from './offline-service-worker.mjs';

const MAXIMUM_ASSET_BYTES = 25 * 1024 * 1024;
const MAXIMUM_AGGREGATE_BYTES = 256 * 1024 * 1024;
const MAXIMUM_ASSET_COUNT = 4_096;
const CONTROL_FILES = new Set(['_headers', '_redirects', 'offline-shell.json', 'service-worker.js']);

export async function generateOfflineApplicationShell({ outputRoot, repositoryRoot }) {
	const root = resolve(outputRoot);
	const repository = resolve(repositoryRoot);
	await generateProductArtifacts({ outputRoot: root, repositoryRoot: repository });
	const assets = await collectShellAssets(root);
	const workerSha256 = offlineServiceWorkerTemplateSha256();
	const identity = { schemaVersion: 1, workerSha256, assets };
	const releaseId = sha256(Buffer.from(JSON.stringify(identity)));
	const configuration = Object.freeze({ schemaVersion: 1, releaseId, workerSha256, assets });
	await writeFile(resolve(root, 'offline-shell.json'), `${JSON.stringify(configuration, null, 2)}\n`, 'utf8');
	await writeFile(resolve(root, 'service-worker.js'), renderOfflineServiceWorker(configuration), 'utf8');
	return Object.freeze({ releaseId, assetCount: assets.length });
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
