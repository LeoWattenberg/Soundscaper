import { HANDBOOK_SOURCE_LOCALE, handbookLocaleForPath, handbookLocaleRoute } from '../../../scripts/lib/handbook-locales.mjs';
import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

/**
 * Rebases the root-absolute links handbook Markdown is written with.
 *
 * The handbook is served from a path on the product origin, so `/reference/`
 * in a Markdown source is not the page it names - on `soundscaper.org` that
 * path belongs to the editor, and a single-segment one such as
 * `/soundscaper/` collides with a locale document route. Astro rebases the
 * links its own components render but leaves Markdown link targets exactly as
 * written, so this transform supplies the base for them.
 *
 * A translated page carries the English links it was translated from, and a
 * reader who follows one must stay in the language they are reading, so the
 * page's own locale is supplied with the base. Starlight generates a route for
 * every page in every language and fills an untranslated one with the English
 * text, so a link into a language never lands on a page that does not exist.
 *
 * Images are the exception: they live in `public/` and are the same file in
 * every language, so they take the base alone.
 *
 * Authoring stays base-free and language-free on purpose.
 * `scripts/lib/handbook-content-check.mjs` resolves the same root-absolute
 * targets against the page tree to prove every one of them names a page that
 * exists, and a base written into the sources would have to be stripped again
 * there and re-checked here.
 */
const BASE = handbookPlan('soundscaper').basePath;
const CONTENT_MARKER = 'src/content/docs/';

function rebase(value, prefix) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
	return value === BASE || value.startsWith(`${BASE}/`) ? value : `${prefix}${value}`;
}

/** The locale a page is written in, from the content path Astro renders it from. */
function localeOfDocument(file) {
	const path = String(file?.path ?? file?.history?.at(-1) ?? '').replaceAll('\\', '/');
	const index = path.lastIndexOf(CONTENT_MARKER);
	return index < 0 ? HANDBOOK_SOURCE_LOCALE : handbookLocaleForPath(path.slice(index + CONTENT_MARKER.length));
}

function visit(node, prefix) {
	if (node?.type === 'element') {
		if (node.tagName === 'a' && node.properties?.href) node.properties.href = rebase(node.properties.href, prefix);
		if (node.tagName === 'img' && node.properties?.src) node.properties.src = rebase(node.properties.src, BASE);
	}
	for (const child of node?.children ?? []) visit(child, prefix);
}

export default function rehypeHandbookBase() {
	return (tree, file) => {
		const route = handbookLocaleRoute(localeOfDocument(file));
		visit(tree, route === '/' ? BASE : `${BASE}${route.replace(/\/$/u, '')}`);
	};
}
