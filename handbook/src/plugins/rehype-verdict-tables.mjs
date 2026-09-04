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
 * A table opts in by shape rather than by frontmatter or a wrapper element, so
 * that authoring stays plain Markdown: every body cell outside the first
 * column has to be a bare verdict. That deliberately excludes tables where a
 * Yes/No column sits beside prose or identifiers - the generated effect and
 * plug-in inventories - because a red `No` next to `Realtime rack` would read
 * as a fault rather than as a fact about where the effect runs. It also means
 * one non-verdict cell added later turns the colouring off for that table
 * instead of colouring part of it, which is the failure that is noticed.
 *
 * Colour is redundant here: the word stays in the cell as text, so nothing is
 * conveyed by hue alone.
 */

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
	return visit;
}
