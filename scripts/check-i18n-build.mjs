#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { localePath, ROUTE_LOCALES } from '../src/i18n/locales.js';

const outputRoot = resolve('dist');
const site = new URL(process.env.ASTRO_SITE || 'https://soundscaper.org');
const translationsBaseUrl = new URL(process.env.PUBLIC_TRANSLATIONS_BASE_URL
	|| 'https://translations.soundscaper.org/runtime/translations/audacity/4/');
let routeCount = 0;

for (const descriptor of ROUTE_LOCALES) {
	for (const embedded of [false, true]) {
		verifyRoute(descriptor, embedded);
		routeCount += 1;
	}
}

verifyTranslationCsp();
console.log(`Verified ${routeCount} localized routes and the translation CSP.`);

function verifyRoute(descriptor, embedded) {
	const route = localePath(descriptor.locale, { embedded });
	const html = readFileSync(resolve(outputRoot, `.${route}index.html`), 'utf8');
	const htmlTag = html.match(/<html\b[^>]*>/iu)?.[0];
	assert(htmlTag, `${route} has no html element`);
	const htmlAttributes = parseAttributes(htmlTag);
	assert(htmlAttributes.lang === descriptor.locale,
		`${route} has lang=${htmlAttributes.lang || '<missing>'}; expected ${descriptor.locale}`);
	assert(htmlAttributes.dir === descriptor.direction,
		`${route} has dir=${htmlAttributes.dir || '<missing>'}; expected ${descriptor.direction}`);

	const links = Array.from(html.matchAll(/<link\b[^>]*>/giu), ([tag]) => parseAttributes(tag));
	const canonicals = links.filter((attributes) => attributes.rel === 'canonical');
	const expectedCanonical = new URL(route, site).href;
	assert(canonicals.length === 1 && canonicals[0].href === expectedCanonical,
		`${route} canonical does not equal ${expectedCanonical}`);

	const alternates = links.filter((attributes) => attributes.rel === 'alternate' && attributes.hreflang);
	const expectedAlternates = new Map(ROUTE_LOCALES.map(({ locale }) => [
		locale,
		new URL(localePath(locale, { embedded }), site).href,
	]));
	expectedAlternates.set('x-default', new URL(localePath('en', { embedded }), site).href);
	assert(alternates.length === expectedAlternates.size,
		`${route} has ${alternates.length} locale alternates; expected ${expectedAlternates.size}`);
	const seen = new Set();
	for (const alternate of alternates) {
		assert(!seen.has(alternate.hreflang), `${route} duplicates hreflang=${alternate.hreflang}`);
		seen.add(alternate.hreflang);
		assert(expectedAlternates.get(alternate.hreflang) === alternate.href,
			`${route} has an unexpected href for hreflang=${alternate.hreflang}`);
	}
	assert(seen.size === expectedAlternates.size
		&& Array.from(expectedAlternates.keys()).every((locale) => seen.has(locale)),
		`${route} is missing one or more committed hreflang alternates`);
}

function verifyTranslationCsp() {
	const headers = readFileSync(resolve(outputRoot, '_headers'), 'utf8');
	const policies = Array.from(headers.matchAll(/^\s*Content-Security-Policy:\s*(.+)$/gimu), ([, policy]) => policy.trim());
	assert(policies.length === 1, `dist/_headers contains ${policies.length} Content-Security-Policy headers; expected one`);
	const directives = policies[0].split(';').map((directive) => directive.trim().split(/\s+/u)).filter((parts) => parts[0]);
	const connectSources = directives.find(([name]) => name === 'connect-src');
	assert(connectSources, 'Content-Security-Policy has no connect-src directive');
	const origin = translationsBaseUrl.origin;
	assert(connectSources.slice(1).filter((source) => source === origin).length === 1,
		`connect-src must contain ${origin} exactly once`);
	for (const [name, ...sources] of directives) {
		if (name !== 'connect-src') assert(!sources.includes(origin), `${origin} must not appear in CSP ${name}`);
	}
}

function parseAttributes(tag) {
	return Object.fromEntries(Array.from(tag.matchAll(/\s([:\w-]+)=(?:"([^"]*)"|'([^']*)')/gu), (match) => [
		match[1].toLowerCase(),
		match[2] ?? match[3] ?? '',
	]));
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
