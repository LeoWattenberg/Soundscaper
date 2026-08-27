#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { bundledCopyForLocale } from '../src/common/i18n/catalogs.js';
import { ROUTE_LOCALES } from '../src/common/i18n/locales.js';
import { PRODUCT_IDS, productLocalePath, productProfile } from '../src/common/products.js';
import {
	renderTransferDocument,
	TRANSFER_PAGE_DEV_MODULE_URL,
	TRANSFER_PAGE_ENTRY_MODULE,
	TRANSFER_ROUTES,
} from '../src/common/transfer/transfer-routes.js';

const BUILD_MANIFEST = '.offline-build-manifest.json';
const outputRoot = resolve(process.argv[2] || 'dist');
const template = await readFile(resolve(outputRoot, 'index.html'), 'utf8');
const site = new URL(process.env.SOUNDSCAPER_SITE || 'https://soundscaper.org');
let routeCount = 0;

for (const productId of PRODUCT_IDS) {
	for (const descriptor of ROUTE_LOCALES) {
		for (const embedded of [false, true]) {
			const route = productRoute(productId, descriptor.locale, embedded);
			const output = resolve(outputRoot, `.${route}index.html`);
			await mkdir(dirname(output), { recursive: true });
			await writeFile(output, routeDocument(template, { descriptor, productId, route, embedded }), 'utf8');
			routeCount += 1;
		}
	}
}
await writeFile(resolve(outputRoot, 'index.html'), template.replace(
	'<!-- route-head -->',
	productInstallHead('soundscaper'),
), 'utf8');

const transferAssets = await resolveTransferPageAssets(outputRoot);
for (const route of TRANSFER_ROUTES) {
	const output = resolve(outputRoot, `.${route.path}index.html`);
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, renderTransferDocument({
		role: route.role,
		canonical: new URL(route.path, site).href,
		...transferAssets,
	}), 'utf8');
}

console.log(
	`Generated ${routeCount} localized product routes`
	+ ` and ${TRANSFER_ROUTES.length} transfer routes from ${transferAssets.moduleUrl}.`,
);

/**
 * Point the transfer documents at the already-built transfer chunk.
 *
 * The transfer pages are not products and must not load the application entry,
 * but they also must not be a second bundler pass: the chunk exists because
 * `src/common/site/route.js` reaches `transfer-page-entry.ts` through a dynamic
 * import, so Vite has already emitted it, hashed it and recorded it - along with
 * its static imports - in the build manifest. Reading that record is all it
 * takes to serve a standalone page that mounts no site shell and no editor: the
 * transitive static imports recorded there are the page's whole eager cost, and
 * today that is five chunks with no editor chunk among them.
 *
 * What those five do include is React. `transfer-page-entry.ts` loads its
 * archive runtime through a dynamic import, so rolldown injects
 * `vite/preload-helper` into the transfer chunk, and that helper belongs to the
 * `$initial`-tagged `site-entry` group in `scripts/lib/build-chunk-groups.mjs` -
 * the group that also owns react-dom. The page renders no React component, but
 * it does download the renderer, and the manifest says so. Nothing here can
 * decide otherwise: dropping those preload links would only delay chunks the
 * transfer chunk statically imports anyway, so the fix, if it is wanted, is to
 * give the preload helper an owner of its own in the chunk groups.
 * `tests/project-transfer-standalone-page-chunks.test.ts` measures the emitted
 * documents and holds this paragraph to what actually ships.
 *
 * When there is no manifest the output root did not come from a Vite build (the
 * route generator is also exercised against a bare fixture), so the pages fall
 * back to the dev-server URL for the same module, which is exactly what the dev
 * server serves.
 */
async function resolveTransferPageAssets(root) {
	let manifest;
	try {
		manifest = JSON.parse(await readFile(resolve(root, BUILD_MANIFEST), 'utf8'));
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		return { moduleUrl: TRANSFER_PAGE_DEV_MODULE_URL, modulePreloads: [], stylesheets: [] };
	}
	const record = manifest[TRANSFER_PAGE_ENTRY_MODULE];
	if (!record?.file) {
		throw new Error(
			`The build manifest has no chunk for ${TRANSFER_PAGE_ENTRY_MODULE}. The transfer pages`
			+ ' cannot be generated without it; check that src/common/site/route.js still imports it.',
		);
	}
	const modulePreloads = new Set();
	const stylesheets = new Set();
	const pending = [TRANSFER_PAGE_ENTRY_MODULE];
	const seen = new Set();
	while (pending.length) {
		const key = pending.pop();
		if (seen.has(key)) continue;
		seen.add(key);
		const entry = manifest[key];
		if (!entry) continue;
		if (key !== TRANSFER_PAGE_ENTRY_MODULE && entry.file) modulePreloads.add(`/${entry.file}`);
		for (const stylesheet of entry.css || []) stylesheets.add(`/${stylesheet}`);
		for (const imported of entry.imports || []) pending.push(imported);
	}
	return {
		moduleUrl: `/${record.file}`,
		modulePreloads: [...modulePreloads].sort(),
		stylesheets: [...stylesheets].sort(),
	};
}

function routeDocument(html, { descriptor, productId, route, embedded }) {
	const profile = productProfile(productId);
	const copy = bundledCopyForLocale(descriptor.locale);
	const description = productId === 'framescaper' ? copy.framescaperMetaDescription : copy.metaDescription;
	const alternates = ROUTE_LOCALES.map(({ locale }) => {
		const href = new URL(productRoute(productId, locale, embedded), site).href;
		return `<link rel="alternate" hreflang="${escapeHtml(locale)}" href="${escapeHtml(href)}" />`;
	});
	alternates.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(new URL(productRoute(productId, 'en', embedded), site).href)}" />`);
	const icons = productId === 'framescaper'
		? '<link rel="icon" type="image/svg+xml" href="/logo/framescaper-icon.svg" data-product-icon />'
		: [
			'<link rel="icon" type="image/svg+xml" href="/logo/logo-klein-schwarz.svg" media="(prefers-color-scheme: light)" data-product-icon />',
			'<link rel="icon" type="image/svg+xml" href="/logo/logo-klein-weiß.svg" media="(prefers-color-scheme: dark)" data-product-icon />',
		].join('\n\t\t');
	const head = [
		productInstallHead(productId),
		`<meta name="description" content="${escapeHtml(description)}" />`,
		icons,
		`<link rel="canonical" href="${escapeHtml(new URL(route, site).href)}" />`,
		...alternates,
	].join('\n\t\t');
	return html
		.replace(/<html\b[^>]*>/iu, `<html lang="${escapeHtml(descriptor.locale)}" dir="${descriptor.direction}" data-product="${productId}">`)
		.replace('<!-- route-head -->', head)
		.replace(/<title>[^<]*<\/title>/iu, `<title>${escapeHtml(profile.name)}</title>`);
}

function productRoute(productId, locale, embedded) {
	const route = productLocalePath(productId, locale);
	if (!embedded) return route;
	return productId === 'framescaper'
		? `/framescaper/embed/${locale}/`
		: `/embed/${locale}/`;
}

function productInstallHead(productId) {
	return [
		`<link rel="manifest" href="/manifest-${productId}.webmanifest" data-product-manifest />`,
		`<link rel="apple-touch-icon" sizes="180x180" href="/offline-icons/${productId}-180.png" data-product-install-icon />`,
	].join('\n\t\t');
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}
