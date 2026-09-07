/**
 * Gives a heading the id its source writes out, as `## Heading {#the-id}`.
 *
 * Astro derives a heading's id from its text, and a translated heading has
 * different text, so an anchor link into it would break the moment either end
 * of the link is translated: a link destination is protected during
 * translation and keeps the English id, while the heading it names no longer
 * has one. A heading that is linked to therefore writes its id out, the
 * translator carries `{#the-id}` through as protected text, and every language
 * answers to the same anchor.
 *
 * Astro's own heading-id pass keeps an id that is already set, so this runs
 * before it and only has to remove the marker from the rendered text.
 * `scripts/lib/handbook-content-check.mjs` refuses an anchor that names a
 * heading without one, so no link can rely on a derived id.
 */
const MARKER = /\s*\{#([A-Za-z][\w-]*)\}\s*$/u;

function applyMarker(node) {
	for (let index = node.children.length - 1; index >= 0; index -= 1) {
		const child = node.children[index];
		if (child.type !== 'text') return;
		const match = child.value.match(MARKER);
		if (!match) return;
		node.properties = { ...node.properties, id: match[1] };
		child.value = child.value.slice(0, match.index).trimEnd();
		if (!child.value) node.children.splice(index, 1);
		return;
	}
}

function visit(node) {
	if (node?.type === 'element' && /^h[1-6]$/u.test(node.tagName) && node.children?.length) applyMarker(node);
	for (const child of node?.children ?? []) visit(child);
}

export default function rehypeHandbookHeadingIds() {
	return visit;
}
