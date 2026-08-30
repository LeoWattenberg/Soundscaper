/* SPDX-License-Identifier: AGPL-3.0-only */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

const SOUNDSCAPER_CUSTODY_MODULES = Object.freeze(new Set([
	'/src/common/cross-product-handoff-intent.ts',
	'/src/common/editor/project-schema-identity.ts',
	'/src/common/editor/scape-project-document.js',
	'/src/common/editor/video-timing-asset-reference.js',
]));

const SOUNDSCAPER_FORBIDDEN_RENDERER_MODULE = /(?:\/src\/framescaper\/|\/src\/common\/(?:editor|i18n)\/[^?]*(?:framescaper|web-?vcr)|\/src\/common\/editor\/[^?]*display-capture[^/]*|\/src\/common\/transfer\/(?:cross-product-handoff-conversion|transfer-archive-runtime)\.ts)/iu;

const SOUNDSCAPER_FORBIDDEN_RENDERER_ASSET = /(?:^|\/)(?:framescaper[^/]*|[^/]*Framescaper[^/]*|WebVcr[^/]*)(?:$|\.)/iu;
const SOUNDSCAPER_FORBIDDEN_RENDERER_CONTENT = /(?:framescaperDesktop|framescaper:v1:(?:native-services|capture)|FRAMESCAPER_WEB_VCR_|framescaper-(?:capture|web-vcr)-sandbox-preload)/u;

/** Reject implementation modules that do not belong in a selected renderer package. */
export function assertDesktopRendererProductIsolation(bundleValue, productIdValue) {
	const productId = rendererProduct(productIdValue);
	const bundle = rendererBundle(bundleValue);
	if (productId === 'framescaper') return;
	for (const output of Object.values(bundle)) {
		if (output?.type === 'asset') {
			if (soundscaperRendererAssetForbidden(output.fileName)) {
				throw new Error(`Soundscaper renderer package contains forbidden asset ${output.fileName}.`);
			}
			continue;
		}
		if (output?.type !== 'chunk') continue;
		const forbidden = Object.keys(output.modules ?? {}).find(soundscaperRendererModuleForbidden);
		if (forbidden) {
			throw new Error(
				`Soundscaper renderer package contains ${output.fileName}: forbidden module ${forbidden}.`,
			);
		}
		if (SOUNDSCAPER_FORBIDDEN_RENDERER_ASSET.test(output.fileName)) {
			throw new Error(`Soundscaper renderer package contains forbidden asset ${output.fileName}.`);
		}
		const marker = SOUNDSCAPER_FORBIDDEN_RENDERER_CONTENT.exec(output.code ?? '')?.[0];
		if (marker !== undefined) {
			throw new Error(
				`Soundscaper renderer package contains callable Framescaper marker ${marker} in ${output.fileName}.`,
			);
		}
	}
}

/** True only for callable product/video implementation, never shared schema custody. */
export function soundscaperRendererModuleForbidden(moduleIdValue) {
	const moduleId = normalizedModuleId(moduleIdValue);
	if (SOUNDSCAPER_CUSTODY_MODULES.has(repositoryModuleSuffix(moduleId))) return false;
	return SOUNDSCAPER_FORBIDDEN_RENDERER_MODULE.test(moduleId);
}

/** Paths copied from public/ that have no place in a Soundscaper renderer. */
export function soundscaperRendererAssetForbidden(pathValue) {
	const path = normalizedOutputPath(pathValue);
	return path === 'logo/framescaper-icon.svg'
		|| SOUNDSCAPER_FORBIDDEN_RENDERER_ASSET.test(path);
}

/** Select the public tree before Vite emits it; no product file is removed after emission. */
export function desktopRendererProductPublicAssetFiles(productIdValue, filesValue) {
	const productId = rendererProduct(productIdValue);
	if (!Array.isArray(filesValue) || filesValue.some((path) => typeof path !== 'string')) {
		throw new TypeError('Desktop renderer public asset inventory must be an array of paths.');
	}
	const files = filesValue.map(normalizedOutputPath);
	if (new Set(files).size !== files.length) {
		throw new TypeError('Desktop renderer public asset inventory contains duplicates.');
	}
	return Object.freeze(files.filter((path) => productId === 'framescaper'
		|| !soundscaperRendererAssetForbidden(path)));
}

/** Emit a product-selected Vite public tree when the default public copier is disabled. */
export function emitDesktopRendererProductPublicAssets(repositoryRootValue, productIdValue) {
	const productId = rendererProduct(productIdValue);
	if (typeof repositoryRootValue !== 'string' || repositoryRootValue === '') {
		throw new TypeError('Desktop renderer repository root is required.');
	}
	const publicRoot = resolve(repositoryRootValue, 'public');
	return {
		name: 'kw-emit-desktop-renderer-product-public-assets',
		apply: 'build',
		async buildStart() {
			const files = await collectPublicFiles(publicRoot);
			for (const fileName of desktopRendererProductPublicAssetFiles(productId, files)) {
				this.emitFile({
					type: 'asset',
					fileName,
					source: await readFile(join(publicRoot, fileName)),
				});
			}
		},
	};
}

/** Vite/Rolldown hook that admits only a product-selected renderer graph. */
export function enforceDesktopRendererProductIsolation(productIdValue) {
	const productId = rendererProduct(productIdValue);
	return {
		name: 'kw-enforce-desktop-renderer-product-isolation',
		apply: 'build',
		generateBundle: { order: 'pre', handler(_options, bundle) {
			if (productId === 'framescaper') return;
			for (const output of Object.values(bundle)) {
				if (output?.type !== 'chunk') continue;
				const modules = Object.keys(output.modules ?? {});
				const forbidden = modules.filter(soundscaperRendererModuleForbidden);
				if (!forbidden.length) continue;
				const permitted = modules.filter((moduleId) => !soundscaperRendererModuleForbidden(moduleId));
				if (permitted.length) {
					throw new Error(
						`Soundscaper renderer chunk ${output.fileName} mixes deferred implementation `
						+ `${forbidden[0]} with ${permitted[0]}.`,
					);
				}
			}
			assertNoStaticDeferredModuleDependency(this, bundle);
			assertNoStaticDeferredRendererDependency(bundle);
			assertDesktopRendererProductIsolation(bundle, productId);
		} },
	};
}

function assertNoStaticDeferredModuleDependency(context, bundle) {
	const bootstrap = Object.values(bundle).find((output) => output?.type === 'chunk'
		&& Object.keys(output.modules ?? {}).some((id) => normalizedModuleId(id)
			.endsWith('/src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx')));
	const root = bootstrap && Object.keys(bootstrap.modules ?? {}).find((id) => normalizedModuleId(id)
		.endsWith('/src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx'));
	if (!root) return;
	const pending = [[root]];
	const visited = new Set();
	while (pending.length) {
		const chain = pending.shift();
		const moduleId = chain.at(-1);
		if (visited.has(moduleId)) continue;
		visited.add(moduleId);
		if (soundscaperRendererModuleForbidden(moduleId)) {
			throw new Error(
				`Soundscaper renderer statically imports deferred module ${moduleId} via `
				+ chain.map(repositoryModuleSuffix).join(' -> '),
			);
		}
		const info = context.getModuleInfo(moduleId);
		for (const imported of info?.importedIds ?? []) pending.push([...chain, imported]);
	}
}

function assertNoStaticDeferredRendererDependency(bundle) {
	const bootstrap = Object.values(bundle).find((output) => output?.type === 'chunk'
		&& Object.keys(output.modules ?? {}).some((id) => normalizedModuleId(id)
			.endsWith('/src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx')));
	if (!bootstrap) return;
	const pending = [[bootstrap.fileName]];
	const visited = new Set();
	while (pending.length) {
		const chain = pending.shift();
		const fileName = chain.at(-1);
		if (visited.has(fileName)) continue;
		visited.add(fileName);
		const output = bundle[fileName];
		if (output?.type !== 'chunk') continue;
		const forbidden = Object.keys(output.modules ?? {}).find(soundscaperRendererModuleForbidden);
		if (forbidden) {
			throw new Error(
				`Soundscaper renderer statically imports deferred module ${forbidden} via ${chain.join(' -> ')}.`,
			);
		}
		for (const imported of output.imports ?? []) pending.push([...chain, imported]);
	}
}

function rendererBundle(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop renderer bundle must be an object.');
	}
	return value;
}

function rendererProduct(value) {
	if (typeof value !== 'string' || !PRODUCT_IDS.includes(value)) {
		throw new RangeError('Desktop renderer isolation requires a selected product.');
	}
	return value;
}

function normalizedModuleId(value) {
	if (typeof value !== 'string' || value === '') return '';
	return value.replaceAll('\\', '/').split('?')[0];
}

function repositoryModuleSuffix(value) {
	const index = value.lastIndexOf('/src/');
	return index < 0 ? value : value.slice(index);
}

function normalizedOutputPath(value) {
	if (typeof value !== 'string' || value === '') {
		throw new TypeError('Desktop renderer output path must be a non-empty string.');
	}
	const path = value.replaceAll('\\', '/').replace(/^\.\//u, '');
	if (path.startsWith('/') || path.split('/').some((part) => part === '' || part === '..')) {
		throw new TypeError('Desktop renderer output path must be relative and normalized.');
	}
	return path;
}

async function collectPublicFiles(root, relativeRoot = '') {
	const entries = await readdir(join(root, relativeRoot), { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
		const relativePath = relativeRoot === '' ? entry.name : `${relativeRoot}/${entry.name}`;
		if (entry.isDirectory()) files.push(...await collectPublicFiles(root, relativePath));
		else if (entry.isFile()) files.push(relativePath);
		else throw new Error(`Desktop renderer public asset is not a regular file: ${relativePath}.`);
	}
	return files;
}
