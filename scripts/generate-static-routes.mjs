#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { bundledCopyForLocale } from '../src/common/i18n/catalogs.js';
import { ROUTE_LOCALES } from '../src/common/i18n/locales.js';
import { PRODUCT_IDS, productLocalePath, productProfile } from '../src/common/products.js';

const outputRoot = resolve(process.argv[2] || 'dist');
const template = await readFile(resolve(outputRoot, 'index.html'), 'utf8');
const site = new URL(process.env.SOUNDSCAPER_SITE || 'https://soundscaper.org');
let routeCount = 0;

for (const productId of PRODUCT_IDS) {
	for (const descriptor of ROUTE_LOCALES) {
		const route = productLocalePath(productId, descriptor.locale);
		const output = resolve(outputRoot, `.${route}index.html`);
		await mkdir(dirname(output), { recursive: true });
		await writeFile(output, routeDocument(template, { descriptor, productId, route }), 'utf8');
		routeCount += 1;
	}
}
await writeFile(resolve(outputRoot, 'index.html'), template.replace(
	'<!-- route-head -->',
	productInstallHead('soundscaper'),
), 'utf8');

console.log(`Generated ${routeCount} localized product routes.`);

function routeDocument(html, { descriptor, productId, route }) {
	const profile = productProfile(productId);
	const copy = bundledCopyForLocale(descriptor.locale);
	const description = productId === 'framescaper' ? copy.framescaperMetaDescription : copy.metaDescription;
	const alternates = ROUTE_LOCALES.map(({ locale }) => {
		const href = new URL(productLocalePath(productId, locale), site).href;
		return `<link rel="alternate" hreflang="${escapeHtml(locale)}" href="${escapeHtml(href)}" />`;
	});
	alternates.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(new URL(productLocalePath(productId, 'en'), site).href)}" />`);
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
