import { HANDBOOK_SOURCE_LOCALE, handbookLocaleForPath, handbookLocaleRoute } from '../../../scripts/lib/handbook-locales.mjs';
import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

const PRODUCT_ORIGINS = Object.freeze({
	soundscaper: 'https://soundscaper.org',
	framescaper: 'https://framescaper.org',
});

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
const CONTENT_MARKER = 'src/content/docs/';
const FRAMESCAPER_SOURCE_PREFIX = '/framescaper';

function rebaseImage(value, base) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
	return value === base || value.startsWith(`${base}/`) ? value : `${base}${value}`;
}

function productPrefix(base, locale) {
	const route = handbookLocaleRoute(locale);
	return route === '/' ? base : `${base}${route.replace(/\/$/u, '')}`;
}

function framescaperPath(value) {
	if (value === FRAMESCAPER_SOURCE_PREFIX) return '/';
	return value.startsWith(`${FRAMESCAPER_SOURCE_PREFIX}/`)
		? value.slice(FRAMESCAPER_SOURCE_PREFIX.length)
		: null;
}

function rebaseLink(value, productId, prefix, base) {
	if (typeof value !== 'string') return value;
	if (value.startsWith('https://soundscaper.org/framescaper/')) {
		return value.replace('https://soundscaper.org/framescaper/', 'https://framescaper.org/');
	}
	if (!value.startsWith('/') || value.startsWith('//')) return value;
	if (value === base || value.startsWith(`${base}/`)) return value;
	const framesPath = framescaperPath(value);
	if (productId === 'soundscaper') {
		return framesPath === null
			? `${prefix}${value}`
			: `${PRODUCT_ORIGINS.framescaper}${prefix}${framesPath}`;
	}
	if (value === '/') return `${prefix}/`;
	return framesPath === null
		? `${PRODUCT_ORIGINS.soundscaper}${prefix}${value}`
		: `${prefix}${framesPath}`;
}

function rewriteRetiredFramescaperEditorText(node) {
	for (const child of node?.children ?? []) {
		if (child?.type === 'text') {
			child.value = child.value.replaceAll('soundscaper.org/framescaper/', 'framescaper.org/');
		} else rewriteRetiredFramescaperEditorText(child);
	}
}

/** The locale a page is written in, from the content path Astro renders it from. */
function localeOfDocument(file) {
	const path = String(file?.path ?? file?.history?.at(-1) ?? '').replaceAll('\\', '/');
	const index = path.lastIndexOf(CONTENT_MARKER);
	return index < 0 ? HANDBOOK_SOURCE_LOCALE : handbookLocaleForPath(path.slice(index + CONTENT_MARKER.length));
}

function visit(node, productId, prefix, base) {
	if (node?.type === 'element') {
		if (node.tagName === 'a' && node.properties?.href) {
			const retiredFramescaperEditor = typeof node.properties.href === 'string'
				&& node.properties.href.startsWith('https://soundscaper.org/framescaper/');
			node.properties.href = rebaseLink(node.properties.href, productId, prefix, base);
			if (retiredFramescaperEditor) rewriteRetiredFramescaperEditorText(node);
		}
		if (node.tagName === 'img' && node.properties?.src) node.properties.src = rebaseImage(node.properties.src, base);
	}
	for (const child of node?.children ?? []) visit(child, productId, prefix, base);
}

export default function rehypeHandbookBase({ productId = 'soundscaper' } = {}) {
	if (!Object.hasOwn(PRODUCT_ORIGINS, productId)) {
		throw new Error(`Unsupported handbook product: ${String(productId)}.`);
	}
	const base = handbookPlan(productId).basePath;
	return (tree, file) => {
		const prefix = productPrefix(base, localeOfDocument(file));
		visit(tree, productId, prefix, base);
	};
}
