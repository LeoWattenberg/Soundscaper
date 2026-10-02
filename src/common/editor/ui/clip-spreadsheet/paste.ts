/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	CLIP_SPREADSHEET_COLUMNS,
	type ClipSpreadsheetColumnId,
	type ClipSpreadsheetEdit,
	type ClipSpreadsheetRow,
} from '../../clip-spreadsheet.ts';
import type { ClipSpreadsheetNewRow } from '../../clip-spreadsheet-insert.ts';
import {
	MAX_SPREADSHEET_CELLS,
	parseSpreadsheetTsv,
	planSpreadsheetPaste,
	type SpreadsheetRange,
} from './clipboard.ts';

export interface ClipSpreadsheetPastePlan {
	readonly edits: readonly ClipSpreadsheetEdit[];
	readonly newRows: readonly ClipSpreadsheetNewRow[];
	readonly range: SpreadsheetRange;
}

/** Append only when no cells are selected; otherwise overwrite existing clips. */
export function planClipSpreadsheetPaste(
	text: string,
	range: SpreadsheetRange | null,
	rows: readonly ClipSpreadsheetRow[],
): ClipSpreadsheetPastePlan {
	const matrix = parseSpreadsheetTsv(text);
	if (range && (![range.top, range.left, range.bottom, range.right].every(value => Number.isSafeInteger(value) && value >= 0)
		|| range.top > range.bottom || range.left > range.right
		|| range.bottom >= rows.length)) {
		throw new RangeError('Invalid spreadsheet paste range.');
	}
	const columnCount = CLIP_SPREADSHEET_COLUMNS.length;
	const fullRow = range && range.top === range.bottom && range.left === 0 && range.right === columnCount - 1;
	const selected = fullRow && matrix.length > 1 ? { ...range, bottom: range.top + matrix.length - 1 }
		: range ?? { top: rows.length, left: 0, bottom: rows.length, right: 0 };
	const rowCount = range ? rows.length : rows.length + matrix.length;
	const cells = planSpreadsheetPaste(matrix, selected, rowCount, columnCount);
	const edits: ClipSpreadsheetEdit[] = [];
	const newRows = new Map<number, Partial<Record<ClipSpreadsheetColumnId, string>>>();
	let bottom = selected.top;
	let right = selected.left;
	for (const cell of cells) {
		const column = CLIP_SPREADSHEET_COLUMNS[cell.column]!.id;
		const clip = rows[cell.row];
		if (clip) edits.push({ clipId: clip.id, column, value: cell.value });
		else {
			const values = newRows.get(cell.row) ?? {};
			values[column] = cell.value;
			newRows.set(cell.row, values);
		}
		bottom = Math.max(bottom, cell.row);
		right = Math.max(right, cell.column);
	}
	return {
		edits,
		// Source presence and all clip properties are validated together by the domain planner.
		newRows: [...newRows.values()],
		range: { top: selected.top, left: selected.left, bottom, right },
	};
}

export interface ClipSpreadsheetSourceFile {
	readonly name: string;
	readonly webkitRelativePath?: string;
	readonly relativePath?: string;
	readonly path?: string;
}

interface SourceReference {
	readonly path: string;
	readonly basename: string;
	readonly windows: boolean;
}

/** Match only files already granted by a chooser; path strings never authorize disk reads. */
export function matchClipSpreadsheetSourceFiles<SourceFile extends ClipSpreadsheetSourceFile>(
	references: readonly string[],
	files: readonly SourceFile[],
): ReadonlyMap<string, SourceFile> {
	if (references.length > MAX_SPREADSHEET_CELLS || files.length > MAX_SPREADSHEET_CELLS) {
		throw new RangeError('Spreadsheet source selection is too large.');
	}
	const exact = new Map<string, Set<SourceFile>>();
	const basenames = new Map<string, Set<SourceFile>>();
	const windowsBasenames = new Map<string, Set<SourceFile>>();
	const selected = new Set(files);
	for (const file of selected) {
		for (const value of new Set([file.name, file.webkitRelativePath, file.relativePath, file.path].filter((value): value is string => Boolean(value)))) {
			const reference = sourceReference(value);
			addMatch(exact, reference.path, file);
			addMatch(basenames, reference.basename, file);
			addMatch(windowsBasenames, reference.basename.toLowerCase(), file);
		}
	}
	const matched = new Map<string, SourceFile>();
	const referencesByFile = new Map<SourceFile, string>();
	for (const value of references) {
		const reference = sourceReference(value);
		const candidates = exact.get(reference.path)
			?? (reference.windows ? windowsBasenames.get(reference.basename.toLowerCase()) : basenames.get(reference.basename));
		if (!candidates?.size) throw new RangeError(`Selected source file is missing: ${value}`);
		if (candidates.size !== 1) throw new RangeError(`Selected source file is ambiguous: ${value}`);
		const file = candidates.values().next().value!;
		const previous = referencesByFile.get(file);
		if (previous !== undefined && previous !== reference.path) {
			throw new RangeError(`Distinct source paths are ambiguous for the selected file: ${value}`);
		}
		referencesByFile.set(file, reference.path);
		matched.set(value, file);
	}
	if (referencesByFile.size !== selected.size) throw new RangeError('Some selected files do not match the requested source files.');
	return matched;
}

function addMatch<SourceFile>(index: Map<string, Set<SourceFile>>, key: string, file: SourceFile): void {
	const matches = index.get(key) ?? new Set<SourceFile>();
	matches.add(file);
	index.set(key, matches);
}

function sourceReference(value: string): SourceReference {
	if (typeof value !== 'string' || !value.trim() || value.length > 4_096 || value.includes('\0')) {
		throw new RangeError('Invalid spreadsheet source reference.');
	}
	let path = value.trim();
	let windows = /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\');
	if (/^file:/iu.test(path)) {
		try {
			const url = new URL(path);
			if (url.protocol !== 'file:' || url.search || url.hash || url.username || url.password) throw new Error();
			path = decodeURIComponent(url.pathname);
			if (/^\/[a-z]:\//iu.test(path)) { path = path.slice(1); windows = true; }
			if (url.hostname && url.hostname !== 'localhost') { path = `//${url.hostname}${path}`; windows = true; }
		} catch { throw new RangeError('Invalid spreadsheet source file URL reference.'); }
	} else if (!windows && /^[a-z][a-z\d+.-]*:/iu.test(path)) {
		throw new RangeError('Spreadsheet source references must name local files.');
	}
	path = path.replaceAll('\\', '/');
	const prefix = path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : '';
	const segments: string[] = [];
	for (const segment of path.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..' && segments.length && segments.at(-1) !== '..') segments.pop();
		else segments.push(segment);
	}
	path = `${prefix}${segments.join('/')}`;
	if (windows) path = path.toLowerCase();
	const basename = path.split('/').at(-1) ?? '';
	if (!basename || basename === '..') throw new RangeError('Invalid spreadsheet source reference.');
	return { path, basename, windows };
}
