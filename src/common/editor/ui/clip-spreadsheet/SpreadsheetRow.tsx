/* SPDX-License-Identifier: AGPL-3.0-only */
import { memo, type RefObject } from 'react';
import type { ClipSpreadsheetEdit } from '../../clip-spreadsheet.ts';
import type { SpreadsheetCell } from './clipboard.ts';
import type { SpreadsheetRowPresentation } from './row-presentation.ts';

export interface SpreadsheetCellDraft extends SpreadsheetCell {
	readonly clipId: string;
	readonly value: string;
}

export interface SpreadsheetRowActions {
	finishEdit(): boolean;
	selectCell(cell: SpreadsheetCell, extend?: boolean): void;
	beginEdit(cell: SpreadsheetCell): void;
	updateDraft(draft: SpreadsheetCellDraft | null): void;
	apply(edits: readonly ClipSpreadsheetEdit[]): boolean;
	selectRow(row: number, extend: boolean): void;
	isDraftActive(): boolean;
	registerCell(row: number, column: number, element: HTMLElement | null): void;
}

interface SpreadsheetRowProps {
	readonly presentation: SpreadsheetRowPresentation;
	readonly rowIndex: number;
	readonly selectedLeft: number;
	readonly selectedRight: number;
	readonly activeColumn: number;
	readonly draft: SpreadsheetCellDraft | null;
	readonly blocked: boolean;
	readonly inputRef: RefObject<HTMLInputElement | null>;
	readonly actions: SpreadsheetRowActions;
}

export const SpreadsheetRow = memo(function SpreadsheetRow({
	presentation, rowIndex, selectedLeft, selectedRight, activeColumn, draft, blocked, inputRef, actions,
}: SpreadsheetRowProps) {
	const { row, cells } = presentation;
	return <tr>
		<th scope="row"><button type="button" tabIndex={-1} aria-label={presentation.label}
			onClick={event => actions.selectRow(rowIndex, event.shiftKey)}>{rowIndex + 1}</button></th>
		{cells.map(column => {
			const cell = { row: rowIndex, column: column.column };
			const editing = draft?.clipId === row.id && draft.column === column.column;
			return <td key={column.id} role="gridcell" data-row={rowIndex} data-column={column.id}
				ref={element => actions.registerCell(rowIndex, column.column, element)}
				aria-selected={selectedLeft >= 0 && column.column >= selectedLeft && column.column <= selectedRight}
				aria-readonly={blocked || !column.editable} tabIndex={activeColumn === column.column ? 0 : -1} title={column.title}
				onMouseDown={event => {
					if (event.button !== 0 || editing) return;
					if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
					if (actions.finishEdit()) actions.selectCell(cell, event.shiftKey);
				}}
				onMouseEnter={event => { if (event.buttons === 1 && !actions.isDraftActive()) actions.selectCell(cell, true); }}
				onDoubleClick={() => { if (column.id !== 'reversed' && column.id !== 'inverted') actions.beginEdit(cell); }}>
				{editing && draft ? <input ref={inputRef} aria-label={column.label} value={draft.value}
					onChange={event => actions.updateDraft({ ...draft, value: event.currentTarget.value })}
					onBlur={() => { actions.finishEdit(); }} /> : column.id === 'reversed' || column.id === 'inverted'
					? <input type="checkbox" aria-label={column.label} tabIndex={-1} checked={row.cells[column.id] === 'true'}
						disabled={blocked || !column.editable} onChange={event => {
							actions.apply([{ clipId: row.id, column: column.id, value: String(event.currentTarget.checked) }]);
						}} /> : row.cells[column.id]}
			</td>;
		})}
	</tr>;
});
