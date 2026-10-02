/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { CLIP_SPREADSHEET_COPY_BY_LOCALE } from '../../../i18n/editor-clip-spreadsheet-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import {
	CLIP_SPREADSHEET_COLUMNS, getClipSpreadsheetRows, isClipSpreadsheetCellEditable,
	type ClipSpreadsheetEdit, type ClipSpreadsheetRow,
} from '../../clip-spreadsheet.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import {
	normalizeSpreadsheetRange, parseSpreadsheetTsv, planSpreadsheetPaste, serializeSpreadsheetTsv,
	type SpreadsheetCell, type SpreadsheetRange,
} from './clipboard.ts';
import './clip-spreadsheet.css';

interface SpreadsheetController {
	readonly actions: {
		readonly clip: { editSpreadsheet(projectId: string, edits: readonly ClipSpreadsheetEdit[]): unknown };
		readonly edit: { undo(): unknown; redo(): unknown };
	};
}

interface SpreadsheetSnapshot extends AudioEditorEditBlockingSnapshot {
	readonly project?: { readonly id: string } | null;
	readonly history?: { readonly canUndo: boolean; readonly canRedo: boolean };
}

interface ClipSpreadsheetPanelProps {
	readonly controller: SpreadsheetController;
	readonly snapshot: SpreadsheetSnapshot;
	readonly copy: Readonly<Record<string, string>>;
}

interface CellDraft extends SpreadsheetCell { readonly clipId: string; readonly value: string }
const ORIGIN: SpreadsheetCell = { row: 0, column: 0 };

export default function ClipSpreadsheetPanel(props: ClipSpreadsheetPanelProps) {
	return <ClipSpreadsheetSurface key={props.snapshot.project?.id ?? ''} {...props} />;
}

function ClipSpreadsheetSurface({ controller, snapshot, copy }: ClipSpreadsheetPanelProps) {
	const labels = resolveEditorCopyScope('clipSpreadsheet', CLIP_SPREADSHEET_COPY_BY_LOCALE.en, copy);
	const rows = useMemo(() => getClipSpreadsheetRows(snapshot.project), [snapshot.project]);
	const [anchor, setAnchor] = useState(ORIGIN);
	const [focus, setFocus] = useState(ORIGIN);
	const [draft, setDraft] = useState<CellDraft | null>(null);
	const draftRef = useRef<CellDraft | null>(null);
	const selectDraftOnFocus = useRef(true);
	const updateDraft = (value: CellDraft | null): void => { draftRef.current = value; setDraft(value); };
	const [error, setError] = usePresentationFeedback(copy);
	const tableRef = useRef<HTMLTableElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const alive = useRef(true);
	const liveProject = useRef(snapshot.project);
	liveProject.current = snapshot.project;
	const descriptionId = useId();
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const liveBlocked = useRef(blocked);
	liveBlocked.current = blocked;
	const columns = CLIP_SPREADSHEET_COLUMNS;
	const range = normalizeSpreadsheetRange(clampCell(anchor), clampCell(focus));
	const active = clampCell(focus);
	const projectId = snapshot.project?.id;
	const rowIdentity = rows.map(({ id }) => id).join('\0');

	useEffect(() => {
		alive.current = true;
		return () => { alive.current = false; };
	}, []);
	useEffect(() => {
		setAnchor(ORIGIN); setFocus(ORIGIN); draftRef.current = null; setDraft(null); setError('');
	}, [rowIdentity, setError]);
	useEffect(() => {
		if (draftRef.current) {
			inputRef.current?.focus();
			if (selectDraftOnFocus.current) inputRef.current?.select();
		}
	}, [draft?.clipId, draft?.row, draft?.column]);
	useEffect(() => { if (blocked) { draftRef.current = null; setDraft(null); } }, [blocked]);

	function clampCell(cell: SpreadsheetCell): SpreadsheetCell {
		return { row: Math.max(0, Math.min(rows.length - 1, cell.row)), column: Math.max(0, Math.min(columns.length - 1, cell.column)) };
	}
	function focusCell(cell: SpreadsheetCell, preventScroll = false): void {
		tableRef.current?.querySelector<HTMLElement>(`[data-row="${cell.row}"][data-column="${columns[cell.column]?.id}"]`)?.focus({ preventScroll });
	}
	function selectCell(cell: SpreadsheetCell, extend = false): void {
		const next = clampCell(cell);
		if (!extend) setAnchor(next);
		setFocus(next);
		focusCell(next);
	}
	function selectRange(next: SpreadsheetRange): void {
		setAnchor({ row: next.top, column: next.left });
		const cell = { row: next.bottom, column: next.right };
		setFocus(cell); focusCell(cell, true);
	}
	function selectAll(): void {
		if (rows.length && finishEdit()) selectRange({ top: 0, left: 0, bottom: rows.length - 1, right: columns.length - 1 });
	}
	function apply(edits: readonly ClipSpreadsheetEdit[]): boolean {
		if (blocked || !projectId) return false;
		try {
			controller.actions.clip.editSpreadsheet(projectId, edits);
			setError('');
			return true;
		} catch (cause) { setError(feedbackFailure(cause)); return false; }
	}
	function beginEdit(cell: SpreadsheetCell, initial?: string): void {
		const row = rows[cell.row];
		const column = columns[cell.column];
		if (blocked || !row || !column || !isClipSpreadsheetCellEditable(row, column.id)) return;
		setError('');
		selectDraftOnFocus.current = initial === undefined;
		updateDraft({ ...cell, clipId: row.id, value: initial ?? row.cells[column.id] });
	}
	function finishEdit(): boolean {
		const current = draftRef.current;
		if (!current) return true;
		const column = columns[current.column];
		draftRef.current = null;
		if (!column || !apply([{ clipId: current.clipId, column: column.id, value: current.value }])) {
			draftRef.current = current;
			return false;
		}
		updateDraft(null);
		return true;
	}
	function copyText(): string {
		return serializeSpreadsheetTsv(rows.slice(range.top, range.bottom + 1).map(row => (
			columns.slice(range.left, range.right + 1).map(column => row.cells[column.id])
		)));
	}
	function pasteText(text: string, selected = range, targetRows = rows): void {
		if (blocked || !rows.length) return;
		try {
			const cells = planSpreadsheetPaste(parseSpreadsheetTsv(text), selected, targetRows.length, columns.length);
			const edits = cells.map(cell => ({ clipId: targetRows[cell.row]!.id, column: columns[cell.column]!.id, value: cell.value }));
			if (apply(edits) && cells.length) {
				updateDraft(null);
				selectRange({ top: selected.top, left: selected.left, bottom: Math.max(...cells.map(cell => cell.row)), right: Math.max(...cells.map(cell => cell.column)) });
			}
		} catch (cause) { setError(feedbackFailure(cause)); }
	}
	async function clipboardAction(action: 'copy' | 'paste'): Promise<void> {
		const project = snapshot.project;
		try {
			if (action === 'copy') await navigator.clipboard.writeText(copyText());
			else {
				const text = await navigator.clipboard.readText();
				if (!alive.current || liveProject.current !== project || liveBlocked.current) return;
				pasteText(text);
			}
		} catch { if (alive.current) setError(labels.clipboardUnavailable); }
	}
	function historyAction(action: 'undo' | 'redo'): void {
		if (blocked) return;
		try { controller.actions.edit[action](); updateDraft(null); setError(''); }
		catch (cause) { setError(feedbackFailure(cause)); }
	}
	function handleKey(event: KeyboardEvent<HTMLTableElement>): void {
		if (event.key === 'Escape' && !draft) return;
		const tabLeavesGrid = event.key === 'Tab' && !draft && (event.shiftKey
			? active.row === 0 && active.column === 0
			: active.row === rows.length - 1 && active.column === columns.length - 1);
		if (tabLeavesGrid) return;
		event.stopPropagation();
		if (!rows.length || event.target instanceof HTMLButtonElement) return;
		if (draft) {
			if (event.key === 'Escape') {
				event.preventDefault(); updateDraft(null); setError(''); focusCell(active);
			} else if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				if (finishEdit()) selectCell(nextCell(active, event.key === 'Tab' ? 'horizontal' : 'vertical', event.shiftKey ? -1 : 1));
			}
			return;
		}
		const modifier = event.ctrlKey || event.metaKey;
		if (event.code === 'Space' && (modifier || event.shiftKey)) {
			event.preventDefault(); headerRange(modifier ? 'column' : 'row', modifier ? active.column : active.row, false); return;
		}
		if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return; }
		if (modifier && ['z', 'y'].includes(event.key.toLowerCase())) {
			event.preventDefault(); historyAction(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); return;
		}
		const directions: Record<string, SpreadsheetCell> = {
			ArrowUp: { row: active.row - 1, column: active.column },
			ArrowDown: { row: active.row + 1, column: active.column },
			ArrowLeft: { row: active.row, column: active.column - 1 },
			ArrowRight: { row: active.row, column: active.column + 1 },
			Home: { row: modifier ? 0 : active.row, column: 0 },
			End: { row: modifier ? rows.length - 1 : active.row, column: columns.length - 1 },
		};
		const next = directions[event.key];
		if (next) { event.preventDefault(); selectCell(next, event.shiftKey); }
		else if (event.key === 'Tab') { event.preventDefault(); selectCell(nextCell(active, 'horizontal', event.shiftKey ? -1 : 1)); }
		else if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginEdit(active); }
		else if (event.key.length === 1 && !modifier && !event.altKey) { event.preventDefault(); beginEdit(active, event.key); }
	}
	function nextCell(cell: SpreadsheetCell, direction: 'horizontal' | 'vertical', step: number): SpreadsheetCell {
		if (direction === 'vertical') return clampCell({ ...cell, row: cell.row + step });
		const index = Math.max(0, Math.min(rows.length * columns.length - 1, cell.row * columns.length + cell.column + step));
		return { row: Math.floor(index / columns.length), column: index % columns.length };
	}
	function cellSelected(row: number, column: number): boolean {
		return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
	}
	function headerRange(kind: 'row' | 'column', index: number, extend: boolean): void {
		if (!rows.length || (draft && !finishEdit())) return;
		const nextAnchor = kind === 'row'
			? { row: extend ? anchor.row : index, column: 0 }
			: { row: 0, column: extend ? anchor.column : index };
		const nextFocus = kind === 'row'
			? { row: index, column: columns.length - 1 }
			: { row: rows.length - 1, column: index };
		setAnchor(nextAnchor); setFocus(nextFocus); focusCell(nextFocus, true);
	}

	return <div className="audio-editor-clip-spreadsheet" data-clip-spreadsheet aria-describedby={descriptionId}>
		<div className="audio-editor-clip-spreadsheet__content" onKeyDown={event => { if (!['Escape', 'Tab'].includes(event.key) || draft) event.stopPropagation(); }}>
			<p id={descriptionId}>{labels.description}</p>
			<div className="audio-editor-clip-spreadsheet__actions">
				<Button variant="secondary" disabled={!rows.length || Boolean(draft)} onClick={() => { void clipboardAction('copy'); }}>{labels.copy}</Button>
				<Button variant="secondary" disabled={blocked || !rows.length || Boolean(draft)} onClick={() => { void clipboardAction('paste'); }}>{labels.paste}</Button>
				<Button variant="secondary" disabled={blocked || !snapshot.history?.canUndo} onClick={() => historyAction('undo')}>{labels.undo}</Button>
				<Button variant="secondary" disabled={blocked || !snapshot.history?.canRedo} onClick={() => historyAction('redo')}>{labels.redo}</Button>
			</div>
			{blocked && <p role="status">{labels.editingBlocked}</p>}
			{rows.length === 0 ? <p>{labels.empty}</p> : <div className="audio-editor-clip-spreadsheet__scroll">
				<table ref={tableRef} role="grid" aria-label={labels.title} aria-multiselectable="true"
					onKeyDown={handleKey}
					onCopy={event => {
						if (draft) return;
						event.preventDefault(); event.stopPropagation();
						try { event.clipboardData.setData('text/plain', copyText()); setError(''); }
						catch (cause) { setError(feedbackFailure(cause)); }
					}}
					onPaste={event => {
						if (draft && !/[\t\r\n]/u.test(event.clipboardData.getData('text/plain'))) return;
						event.preventDefault(); event.stopPropagation(); pasteText(event.clipboardData.getData('text/plain'));
					}}>
					<thead><tr>
						<th scope="col"><button type="button" tabIndex={-1} aria-label={labels.selectAll} onClick={selectAll}>#</button></th>
						{columns.map((column, index) => <th key={column.id} scope="col" aria-readonly={!column.editable}>
							<button type="button" tabIndex={-1} onClick={event => headerRange('column', index, event.shiftKey)}>{labels[column.id]}</button>
						</th>)}
					</tr></thead>
					<tbody>{rows.map((row: ClipSpreadsheetRow, rowIndex: number) => <tr key={row.id}>
						<th scope="row"><button type="button" tabIndex={-1} aria-label={formatLocalizedTemplate(labels.selectRow, { row: rowIndex + 1 })}
							onClick={event => headerRange('row', rowIndex, event.shiftKey)}>{rowIndex + 1}</button></th>
						{columns.map((column, columnIndex) => {
							const cell = { row: rowIndex, column: columnIndex };
							const editable = isClipSpreadsheetCellEditable(row, column.id);
							const editing = draft?.clipId === row.id && draft.column === columnIndex;
							return <td key={column.id} role="gridcell" data-row={rowIndex} data-column={column.id}
								aria-selected={cellSelected(rowIndex, columnIndex)} aria-readonly={blocked || !editable}
								tabIndex={active.row === rowIndex && active.column === columnIndex ? 0 : -1}
								title={editable ? undefined : row.pitchLinked && column.id === 'pitch' ? labels.linkedPitchReadOnly : labels.readOnly}
								onMouseDown={event => {
									if (event.button !== 0 || editing) return;
									event.preventDefault(); if (finishEdit()) selectCell(cell, event.shiftKey);
								}}
								onMouseEnter={event => { if (event.buttons === 1 && !draft) selectCell(cell, true); }}
								onDoubleClick={() => beginEdit(cell)}>
								{editing ? <input ref={inputRef} aria-label={labels[column.id]} value={draft.value}
									onChange={event => updateDraft({ ...draft, value: event.currentTarget.value })}
									onBlur={() => { finishEdit(); }} /> : row.cells[column.id]}
							</td>;
						})}
					</tr>)}</tbody>
				</table>
			</div>}
			<p className="audio-editor-clip-spreadsheet__hint">{labels.readOnly}</p>
			{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
		</div>
	</div>;
}
