/**
 * Colour-codes the Yes/Partial/No cells of a comparison matrix.
 *
 * The comparison pages are written as ordinary Markdown tables whose cells
 * read `Yes`, `Partial` or `No`, optionally followed by an em-dash and the
 * detail that qualifies the verdict. Reading a column of a hundred such cells
 * as prose is slow, so this transform tags each one for the stylesheet: the
 * cell gets `verdict-cell verdict-cell--<state>` and the verdict word itself
 * is wrapped in `<span class="verdict verdict--<state>">`, with the em-dash
 * separator dropped because the styled word now does that work.
 *
 * A table is coloured when its page asked for it - `VERDICT_TABLE_PAGES` below
 * - and its own shape agrees: every body cell outside the first column has to
 * be a verdict. The shape rule alone used to be the whole test, which claimed
 * tables that never meant a verdict; it is kept as the second half because it
 * excludes tables where a Yes/No column sits beside prose or identifiers - the
 * generated effect and plug-in inventories - where a red `No` next to
 * `Realtime rack` would read as a fault rather than as a fact about where the
 * effect runs, and because one non-verdict cell added later then turns the
 * colouring off for that table instead of colouring part of it, which is the
 * failure that is noticed.
 *
 * Colour is redundant here: the word stays in the cell as text, so nothing is
 * conveyed by hue alone.
 */

/**
 * The pages whose tables are comparison matrices, as `src/content/docs` paths.
 *
 * Colouring cannot be claimed by shape alone, because a table can match the
 * shape by accident: `reference/generated/platforms.md` lists three browser
 * engines against a `Tested automatically` column that reads `Yes` three
 * times, so shape alone tints it green and badges every cell with a pass/fail
 * verdict that reference page never claimed - and would paint a row red the
 * day `scripts/docs-reference.mjs` regenerates it with a `No` for an engine
 * that is not tested yet. A page has to ask for the colouring, and a generated
 * page never asks.
 *
 * The request lives here rather than in the page because neither annotation a
 * page could carry reaches this transform: Astro renders Markdown with the
 * frontmatter its collection schema has already validated, so a key Starlight's
 * schema does not know is gone by the time the tree is built, and raw HTML in
 * Markdown is still an unparsed `raw` node at this point because
 * `@astrojs/markdown-remark` applies `rehype-raw` after the configured plugins.
 * Authoring therefore stays plain Markdown, and a new comparison page is one
 * line here.
 */
const VERDICT_TABLE_PAGES = ['start/how-soundscaper-compares.md'];

const CONTENT_ROOT = 'src/content/docs';

/**
 * Whether the page being rendered asked for the colouring. Astro supplies the
 * source path of the Markdown file; a render that has no path - the content
 * loader's `renderMarkdown()` API - is left plain rather than guessed at.
 */
function optedIn(file) {
	const path = typeof file?.path === 'string' ? file.path.replaceAll('\\', '/') : '';
	return VERDICT_TABLE_PAGES.some((page) => path.endsWith(`/${CONTENT_ROOT}/${page}`));
}

const VERDICT_STATES = new Map([
	['Yes', 'yes'],
	['Partial', 'partial'],
	['No', 'no'],
]);

// The exact separator the comparison sources are written with.
const DETAIL_SEPARATOR = ' — ';

const elementChildren = (node, tagNames) =>
	(node?.children ?? []).filter((child) => child.type === 'element' && tagNames.includes(child.tagName));

/**
 * Body rows of a table, whichever way the source grouped them. Markdown tables
 * come out as thead + tbody, but raw HTML in a page may use neither.
 */
function bodyRows(table) {
	const rows = elementChildren(table, ['tr']);
	for (const section of elementChildren(table, ['tbody', 'tfoot'])) {
		rows.push(...elementChildren(section, ['tr']));
	}
	return rows;
}

const comparisonCells = (row) => elementChildren(row, ['td', 'th']).slice(1);

/**
 * Reads a cell as a verdict, or returns null when it is anything else. Only the
 * leading text node is inspected, so `Yes — \`.sscape\`, a portable archive`
 * still resolves even though the rest of the cell is markup.
 */
function readVerdict(cell) {
	const [first] = cell.children ?? [];
	if (first?.type !== 'text') return null;
	for (const [word, state] of VERDICT_STATES) {
		if (first.value.startsWith(word + DETAIL_SEPARATOR)) {
			return { word, state, detail: first.value.slice(word.length + DETAIL_SEPARATOR.length) };
		}
		if (cell.children.length === 1 && first.value.trim() === word) {
			return { word, state, detail: '' };
		}
	}
	return null;
}

function addClasses(node, ...added) {
	node.properties ??= {};
	const existing = node.properties.className;
	const classes = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
	node.properties.className = [...classes, ...added];
}

function markCell(cell, verdict) {
	addClasses(cell, 'verdict-cell', `verdict-cell--${verdict.state}`);
	const badge = {
		type: 'element',
		tagName: 'span',
		properties: { className: ['verdict', `verdict--${verdict.state}`] },
		children: [{ type: 'text', value: verdict.word }],
	};
	// The separator the badge replaced still has to leave a word space behind,
	// including when the detail opens with markup rather than with text.
	const trailing = cell.children.slice(1);
	const detail = verdict.detail || trailing.length > 0 ? [{ type: 'text', value: ` ${verdict.detail}` }] : [];
	cell.children = [badge, ...detail, ...trailing];
}

function decorate(table) {
	const rows = bodyRows(table);
	const verdicts = [];
	for (const row of rows) {
		for (const cell of comparisonCells(row)) {
			const verdict = readVerdict(cell);
			// One prose cell is enough to say this is not a comparison matrix.
			if (!verdict) return;
			verdicts.push([cell, verdict]);
		}
	}
	if (verdicts.length === 0) return;
	addClasses(table, 'verdict-table');
	for (const [cell, verdict] of verdicts) markCell(cell, verdict);
}

const visit = (node) => {
	if (node?.type === 'element' && node.tagName === 'table') {
		decorate(node);
		return;
	}
	for (const child of node?.children ?? []) visit(child);
};

export default function rehypeVerdictTables() {
	return (tree, file) => {
		if (optedIn(file)) visit(tree);
	};
}
