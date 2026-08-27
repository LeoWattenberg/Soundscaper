#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { bundledCopyForLocale } from '../src/common/i18n/catalogs.js';
import { ROUTE_LOCALES } from '../src/common/i18n/locales.js';
import { productProfile } from '../src/common/products.js';

import { composeProductHeaders, documentRoute, webBuildRouting } from './lib/product-web-routing.mjs';

const outputRoot = resolve(process.argv[2] || 'dist');
const template = await readFile(resolve(outputRoot, 'index.html'), 'utf8');
const routing = webBuildRouting();
const site = routing.site;
const rootPlan = routing.plans.find(({ root }) => root);
if (!rootPlan) throw new Error(`Web build ${routing.productId} has no document plan at the origin root.`);
let routeCount = 0;

for (const plan of routing.plans) {
	for (const descriptor of ROUTE_LOCALES) {
		for (const embedded of [false, true]) {
			const route = documentRoute(plan, descriptor.locale, embedded);
			const output = resolve(outputRoot, `.${route}index.html`);
			await mkdir(dirname(output), { recursive: true });
			await writeFile(output, routeDocument(template, { descriptor, plan, route, embedded }), 'utf8');
			routeCount += 1;
		}
	}
}
await writeFile(resolve(outputRoot, 'index.html'), rootDocument(template, rootPlan), 'utf8');
await writeFile(
	resolve(outputRoot, '_headers'),
	composeProductHeaders(await readFile(resolve(outputRoot, '_headers'), 'utf8'), routing),
	'utf8',
);

console.log(`Generated ${routeCount} localized ${routing.productId} routes canonical to ${site.origin}.`);

function routeDocument(html, { descriptor, plan, route, embedded }) {
	const productId = plan.productId;
	const copy = bundledCopyForLocale(descriptor.locale);
	const description = productId === 'framescaper' ? copy.framescaperMetaDescription : copy.metaDescription;
	const alternates = ROUTE_LOCALES.map(({ locale }) => {
		const href = new URL(documentRoute(plan, locale, embedded), site).href;
		return `<link rel="alternate" hreflang="${escapeHtml(locale)}" href="${escapeHtml(href)}" />`;
	});
	alternates.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(new URL(documentRoute(plan, 'en', embedded), site).href)}" />`);
	const head = [
		productInstallHead(productId),
		`<meta name="description" content="${escapeHtml(description)}" />`,
		productIcons(productId),
		`<link rel="canonical" href="${escapeHtml(new URL(route, site).href)}" />`,
		...alternates,
	].join('\n\t\t');
	return productDocument(html, productId, descriptor)
		.replace('<!-- route-head -->', head);
}

function rootDocument(html, plan) {
	return productDocument(html, plan.productId, { locale: 'en', direction: 'ltr' })
		.replace('<!-- route-head -->', productInstallHead(plan.productId));
}

function productDocument(html, productId, descriptor) {
	return html
		.replace(/<html\b[^>]*>/iu, `<html lang="${escapeHtml(descriptor.locale)}" dir="${descriptor.direction}" data-product="${productId}">`)
		.replace(/<title>[^<]*<\/title>/iu, `<title>${escapeHtml(productProfile(productId).name)}</title>`);
}

function productIcons(productId) {
	return productId === 'framescaper'
		? '<link rel="icon" type="image/svg+xml" href="/logo/framescaper-icon.svg" data-product-icon />'
		: [
			'<link rel="icon" type="image/svg+xml" href="/logo/logo-klein-schwarz.svg" media="(prefers-color-scheme: light)" data-product-icon />',
			'<link rel="icon" type="image/svg+xml" href="/logo/logo-klein-weiß.svg" media="(prefers-color-scheme: dark)" data-product-icon />',
		].join('\n\t\t');
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
