import { readdir, readFile } from 'node:fs/promises';
import { extname, posix, relative, resolve, sep } from 'node:path';

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
 */
const BASE = handbookPlan('soundscaper').basePath;

export async function auditHandbookContent(rootDirectory) {
	const root = resolve(rootDirectory);
	const files = (await markdownFiles(root)).sort();
	const pages = new Map();
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

		const route = routeForMarkdown(relativePath);
		pages.set(route, {
			filePath,
			relativePath,
			source,
			frontmatter: frontmatter ?? '',
			headings: headingIds(source),
		});
	}

	for (const page of pages.values()) {
		for (const rawTarget of markdownLinkTargets(page.source)) {
			if (isExternalTarget(rawTarget)) continue;
			if (carriesBase(rawTarget)) {
				errors.push(`${page.relativePath}: body link ${rawTarget} must omit the ${BASE} base`);
				continue;
			}
			const [pathPart, fragment = ''] = rawTarget.split('#', 2);
			const targetRoute = resolveTargetRoute(pathPart, page.relativePath);
			if (!targetRoute) continue;
			const targetPage = pages.get(targetRoute);
			if (!targetPage) {
				errors.push(`${page.relativePath}: unresolved route ${rawTarget}`);
				continue;
			}
			if (fragment && !targetPage.headings.has(decodeURIComponent(fragment))) {
				errors.push(`${page.relativePath}: unresolved anchor ${rawTarget}`);
			}
		}
		for (const rawTarget of frontmatterLinkTargets(page.frontmatter)) {
			if (isExternalTarget(rawTarget)) continue;
			if (!carriesBase(rawTarget)) {
				errors.push(`${page.relativePath}: frontmatter link ${rawTarget} must carry the ${BASE} base`);
				continue;
			}
			const [pathPart] = rawTarget.slice(BASE.length).split('#', 2);
			const targetRoute = resolveTargetRoute(pathPart, page.relativePath);
			if (targetRoute && !pages.has(targetRoute)) {
				errors.push(`${page.relativePath}: unresolved route ${rawTarget}`);
			}
		}
	}

	return Object.freeze({ pages: files.length, errors: Object.freeze(errors.sort()) });
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

function resolveTargetRoute(pathPart, sourceRelativePath) {
	if (!pathPart) return routeForMarkdown(sourceRelativePath);
	if (/\.(?:avif|gif|jpe?g|pdf|png|svg|webp|wav)$/iu.test(pathPart)) return null;

	let path = pathPart;
	if (!path.startsWith('/')) {
		const sourceRoute = routeForMarkdown(sourceRelativePath);
		path = posix.resolve(sourceRoute, path);
	}
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

function headingIds(source) {
	return new Set([...source.matchAll(/^#{2,6}\s+(.+)$/gmu)].map((match) => slugifyHeading(match[1])));
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
