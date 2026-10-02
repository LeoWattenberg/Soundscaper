/* SPDX-License-Identifier: AGPL-3.0-only */

export const MAX_SPREADSHEET_CELLS = 100_000;
export const MAX_SPREADSHEET_TEXT_LENGTH = 4_000_000;

export interface SpreadsheetCell {
	row: number;
	column: number;
}

export interface SpreadsheetRange {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

export interface SpreadsheetPasteCell extends SpreadsheetCell {
	value: string;
}

type SpreadsheetMatrix = readonly (readonly string[])[];

function isCoordinate(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function assertCellCount(count: number): void {
	if (count > MAX_SPREADSHEET_CELLS) throw new Error('Spreadsheet data is too large.');
}

function assertTextLength(length: number): void {
	if (length > MAX_SPREADSHEET_TEXT_LENGTH) throw new Error('Spreadsheet data is too large.');
}

function matrixWidth(matrix: SpreadsheetMatrix): number {
	const width = matrix[0]?.length ?? 0;
	if (!matrix.length || !width) throw new Error('Spreadsheet data is empty.');
	assertCellCount(matrix.length * width);
	if (matrix.some((row) => row.length !== width)) {
		throw new Error('Spreadsheet data must be rectangular.');
	}
	return width;
}

export function normalizeSpreadsheetRange(anchor: SpreadsheetCell, focus: SpreadsheetCell): SpreadsheetRange {
	if (![anchor.row, anchor.column, focus.row, focus.column].every(isCoordinate)) {
		throw new Error('Invalid spreadsheet selection range.');
	}
	return {
		top: Math.min(anchor.row, focus.row),
		left: Math.min(anchor.column, focus.column),
		bottom: Math.max(anchor.row, focus.row),
		right: Math.max(anchor.column, focus.column),
	};
}

/** Parse the quoted tab-separated format used by spreadsheet clipboard exports. */
export function parseSpreadsheetTsv(text: string): string[][] {
	assertTextLength(text.length);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let state: 'unquoted' | 'quoted' | 'closed' = 'unquoted';
	let cellCount = 0;
	let endedRecord = false;
	const finishCell = () => {
		assertCellCount(++cellCount);
		row.push(field);
		field = '';
		state = 'unquoted';
	};
	const finishRow = () => {
		finishCell();
		if (rows.length && row.length !== rows[0].length) {
			throw new Error('Spreadsheet data must be rectangular.');
		}
		rows.push(row);
		row = [];
	};
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		endedRecord = false;
		if (state === 'quoted') {
			if (character === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					state = 'closed';
				}
			} else {
				field += character;
			}
			continue;
		}
		if (character === '\t') {
			finishCell();
		} else if (character === '\r' || character === '\n') {
			finishRow();
			endedRecord = true;
			if (character === '\r' && text[index + 1] === '\n') index += 1;
		} else if (state === 'closed') {
			throw new Error('Invalid text after a quoted spreadsheet cell.');
		} else if (character === '"') {
			if (field.length) throw new Error('Invalid quote in a spreadsheet cell.');
			state = 'quoted';
		} else {
			field += character;
		}
	}
	if (state === 'quoted') throw new Error('Unclosed quote in a spreadsheet cell.');
	// Spreadsheet applications append one record separator to copied rows.
	if (!endedRecord) finishRow();
	return rows;
}

export function serializeSpreadsheetTsv(matrix: SpreadsheetMatrix): string {
	matrixWidth(matrix);
	let length = 0;
	return matrix.map((row, rowIndex) => row.map((value, columnIndex) => {
		assertTextLength(value.length);
		const encoded = /[\t\r\n"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
		length += encoded.length + (columnIndex > 0 ? 1 : rowIndex > 0 ? 2 : 0);
		assertTextLength(length);
		return encoded;
	}).join('\t')).join('\r\n');
}

/** Return an atomic paste plan; the caller validates clip properties before applying it. */
export function planSpreadsheetPaste(
	matrix: SpreadsheetMatrix,
	range: SpreadsheetRange,
	rowCount: number,
	columnCount: number,
): SpreadsheetPasteCell[] {
	const sourceWidth = matrixWidth(matrix);
	if (![rowCount, columnCount].every(isCoordinate)) throw new Error('Invalid spreadsheet dimensions.');
	if (![range.top, range.left, range.bottom, range.right].every(isCoordinate)
		|| range.top > range.bottom || range.left > range.right) {
		throw new Error('Invalid spreadsheet selection range.');
	}
	const singleCell = range.top === range.bottom && range.left === range.right;
	const height = singleCell ? matrix.length : range.bottom - range.top + 1;
	const width = singleCell ? sourceWidth : range.right - range.left + 1;
	if (range.top + height > rowCount || range.left + width > columnCount) {
		throw new Error('Pasted cells extend outside the spreadsheet.');
	}
	if (height % matrix.length !== 0 || width % sourceWidth !== 0) {
		throw new Error('Pasted data dimensions do not fit the selected range.');
	}
	assertCellCount(height * width);
	const cells: SpreadsheetPasteCell[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let column = 0; column < width; column += 1) {
			cells.push({
				row: range.top + row,
				column: range.left + column,
				value: matrix[row % matrix.length][column % sourceWidth],
			});
		}
	}
	return cells;
}
