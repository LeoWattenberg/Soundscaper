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
 * Authoring stays base-free on purpose. `scripts/lib/handbook-content-check.mjs`
 * resolves the same root-absolute targets against the page tree to prove every
 * one of them names a page that exists, and a base written into the sources
 * would have to be stripped again there and re-checked here.
 */
const BASE = handbookPlan('soundscaper').basePath;

function rebase(value) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
	return value === BASE || value.startsWith(`${BASE}/`) ? value : `${BASE}${value}`;
}

const visit = (node) => {
	if (node?.type === 'element') {
		if (node.tagName === 'a' && node.properties?.href) node.properties.href = rebase(node.properties.href);
		if (node.tagName === 'img' && node.properties?.src) node.properties.src = rebase(node.properties.src);
	}
	for (const child of node?.children ?? []) visit(child);
};

export default function rehypeHandbookBase() {
	return visit;
}
