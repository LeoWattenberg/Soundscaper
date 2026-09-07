import { readdir, readFile } from 'node:fs/promises';
import { extname, posix, relative, resolve, sep } from 'node:path';

import {
	HANDBOOK_SOURCE_LOCALE,
	handbookLocaleForPath,
	handbookLocaleRoute,
	handbookTranslationLocales,
} from './handbook-locales.mjs';
import { handbookPlan } from './product-web-routing.mjs';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;
const MARKDOWN_LINK_PATTERN = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;
const FRONTMATTER_LINK_PATTERN = /^\s+link:\s*(\S+)\s*$/gmu;

/**
 * The handbook is served under a base path, and the two kinds of link in a page
 * reach it by opposite routes.
 *
 * A Markdown body link passes through `rehype-handbook-base.mjs`, which
 * supplies the base at build time, so a body link that already carries one
 * would be served doubled. A frontmatter link is data read by a Starlight
 * component, which no Markdown transform ever sees, so it has to carry the
 * base itself or it lands on the editor's routes instead of the handbook's.
 *
 * Neither mistake is visible in a page's own build output, so both are checked
 * here against the same base the site is configured with.
 *
 * A translated page adds the language to both rules. Its body links are the
 * English ones it was translated from, so they stay base-free and
 * language-free and the transform supplies both; its frontmatter links have to
 * carry the language as well as the base, or a hero action drops the reader
 * back into English.
 */
const BASE = handbookPlan('soundscaper').basePath;
/** Heading ids written out in the source, which survive translation unchanged. */
const EXPLICIT_HEADING_ID_PATTERN = /\{#([A-Za-z][\w-]*)\}\s*$/u;

export async function auditHandbookContent(rootDirectory) {
	const root = resolve(rootDirectory);
	const files = (await markdownFiles(root)).sort();
	// One page map per language, keyed by the route below the language segment,
	// so a link written once in English resolves the same way in every
	// translation of the page that carries it.
	const pages = new Map([[HANDBOOK_SOURCE_LOCALE, new Map()]]);
	const errors = [];

	for (const filePath of files) {
		const source = await readFile(filePath, 'utf8');
		const relativePath = portableRelative(root, filePath);
		const frontmatter = source.match(FRONTMATTER_PATTERN)?.[1];
		if (!frontmatter) {
			errors.push(`${relativePath}: missing frontmatter`);
		} else {
			if (!/^title:\s*\S+/mu.test(frontmatter)) errors.push(`${relativePath}: missing frontmatter title`);
			if (!/^description:\s*\S+/mu.test(frontmatter)) errors.push(`${relativePath}: missing frontmatter description`);
		}

		const locale = handbookLocaleForPath(relativePath);
		if (!pages.has(locale)) pages.set(locale, new Map());
		pages.get(locale).set(pageRoute(relativePath, locale), {
			filePath,
			relativePath,
			locale,
			source,
			frontmatter: frontmatter ?? '',
			...headingIds(source),
		});
	}

	const english = pages.get(HANDBOOK_SOURCE_LOCALE);
	for (const [locale, localePages] of pages) {
		for (const page of localePages.values()) {
			if (locale !== HANDBOOK_SOURCE_LOCALE && !english.has(pageRoute(page.relativePath, locale))) {
				errors.push(`${page.relativePath}: translates a page that no longer exists in English`);
			}
			auditPageLinks(page, { english, localePages, errors });
		}
	}

	return Object.freeze({
		pages: files.length,
		locales: Object.freeze([HANDBOOK_SOURCE_LOCALE, ...handbookTranslationLocales(root)]),
		errors: Object.freeze(errors.sort()),
	});
}

function auditPageLinks(page, { english, localePages, errors }) {
	const languageBase = `${BASE}${handbookLocaleRoute(page.locale)}`.replace(/\/$/u, '');
	for (const rawTarget of markdownLinkTargets(page.source)) {
		if (isExternalTarget(rawTarget)) continue;
		if (carriesBase(rawTarget)) {
			errors.push(`${page.relativePath}: body link ${rawTarget} must omit the ${BASE} base`);
			continue;
		}
		const [pathPart, fragment = ''] = rawTarget.split('#', 2);
		const targetRoute = resolveTargetRoute(pathPart, pageRoute(page.relativePath, page.locale));
		if (!targetRoute) continue;
		// Every page exists in English, and Starlight serves a route for it in
		// every language, so English is what a route has to name. A fragment is
		// read in the page the reader actually lands on: the translation when
		// there is one, and the English page it falls back to when there is not.
		const targetPage = english.get(targetRoute);
		if (!targetPage) {
			errors.push(`${page.relativePath}: unresolved route ${rawTarget}`);
			continue;
		}
		const renderedPage = localePages.get(targetRoute) ?? targetPage;
		const anchor = fragment && decodeURIComponent(fragment);
		if (!anchor) continue;
		if (renderedPage.explicitHeadings.has(anchor)) continue;
		errors.push(renderedPage.headings.has(anchor)
			? `${page.relativePath}: anchor ${rawTarget} names a heading whose id comes from its text; write it out as {#${anchor}}`
			: `${page.relativePath}: unresolved anchor ${rawTarget}`);
	}
	for (const rawTarget of frontmatterLinkTargets(page.frontmatter)) {
		if (isExternalTarget(rawTarget)) continue;
		if (rawTarget !== languageBase && !rawTarget.startsWith(`${languageBase}/`)) {
			errors.push(`${page.relativePath}: frontmatter link ${rawTarget} must carry the ${languageBase} base`);
			continue;
		}
		const [pathPart] = rawTarget.slice(languageBase.length).split('#', 2);
		const targetRoute = resolveTargetRoute(pathPart, pageRoute(page.relativePath, page.locale));
		if (targetRoute && !english.has(targetRoute)) {
			errors.push(`${page.relativePath}: unresolved route ${rawTarget}`);
		}
	}
}

/** A page's route below its language segment, so every language shares one route space. */
function pageRoute(relativePath, locale) {
	const segments = relativePath.split('/');
	return routeForMarkdown(locale === HANDBOOK_SOURCE_LOCALE ? relativePath : segments.slice(1).join('/'));
}

async function markdownFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map(async (entry) => {
		const entryPath = resolve(directory, entry.name);
		if (entry.isDirectory()) return markdownFiles(entryPath);
		return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
	}));
	return nested.flat();
}

function routeForMarkdown(relativePath) {
	const withoutExtension = relativePath.slice(0, -extname(relativePath).length);
	const withoutIndex = withoutExtension === 'index'
		? ''
		: withoutExtension.replace(/\/index$/u, '');
	return `/${withoutIndex ? `${withoutIndex}/` : ''}`;
}

function resolveTargetRoute(pathPart, sourceRoute) {
	if (!pathPart) return sourceRoute;
	if (/\.(?:avif|gif|jpe?g|pdf|png|svg|webp|wav)$/iu.test(pathPart)) return null;

	let path = pathPart;
	if (!path.startsWith('/')) path = posix.resolve(sourceRoute, path);
	path = path.replace(/\.md$/u, '').replace(/\/index$/u, '');
	return path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/gu, '')}/`;
}

function markdownLinkTargets(source) {
	return [...source.matchAll(MARKDOWN_LINK_PATTERN)].map((match) => match[1]);
}

function frontmatterLinkTargets(frontmatter) {
	return [...frontmatter.matchAll(FRONTMATTER_LINK_PATTERN)].map((match) => match[1]);
}

function carriesBase(target) {
	return target === BASE || target.startsWith(`${BASE}/`);
}

function isExternalTarget(target) {
	return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target);
}

/**
 * The ids a page's headings are reachable by, and which of them were written out.
 *
 * A heading translates, and with it the id Astro derives from its text, so an
 * anchor link would break the moment either end of it is translated - the link
 * destination is protected during translation and keeps the English id, while
 * the heading it names no longer has one. A heading that is linked to
 * therefore writes its id out as `{#id}`, which the translator protects like
 * code and returns unchanged, and only a written-out id may be linked to.
 */
function headingIds(source) {
	const headings = new Set();
	const explicitHeadings = new Set();
	for (const match of source.matchAll(/^#{2,6}\s+(.+)$/gmu)) {
		const explicit = match[1].match(EXPLICIT_HEADING_ID_PATTERN);
		if (explicit) explicitHeadings.add(explicit[1]);
		headings.add(explicit ? explicit[1] : slugifyHeading(match[1]));
	}
	return { headings, explicitHeadings };
}

function slugifyHeading(heading) {
	return heading
		.replace(/[`*_~]/gu, '')
		.replace(/<[^>]+>/gu, '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
		.replace(/\s+/gu, '-')
		.replace(/-+/gu, '-');
}

function portableRelative(root, filePath) {
	return relative(root, filePath).split(sep).join('/');
}
