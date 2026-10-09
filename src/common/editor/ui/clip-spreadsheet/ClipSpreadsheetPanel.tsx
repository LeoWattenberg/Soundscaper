/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { CLIP_SPREADSHEET_COPY_BY_LOCALE } from '../../../i18n/editor-clip-spreadsheet-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import {
	CLIP_SPREADSHEET_COLUMNS, findMissingClipSpreadsheetEditSources, getClipSpreadsheetRows, isClipSpreadsheetCellEditable,
	type ClipSpreadsheetEdit,
} from '../../clip-spreadsheet.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { findMissingClipSpreadsheetSources, type ClipSpreadsheetNewRow } from '../../clip-spreadsheet-insert.ts';
import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import { SpreadsheetRow, type SpreadsheetCellDraft, type SpreadsheetRowActions } from './SpreadsheetRow.tsx';
import { createSpreadsheetCellIndex, useSpreadsheetRowIdentity, useSpreadsheetRows } from './row-presentation.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	normalizeSpreadsheetRange, serializeSpreadsheetTsv,
	type SpreadsheetCell, type SpreadsheetRange,
} from './clipboard.ts';
import { matchClipSpreadsheetSourceFiles, planClipSpreadsheetPaste } from './paste.ts';
import { spreadsheetOwnsKeyboard } from './keyboard-ownership.ts';
import './clip-spreadsheet.css';

interface SpreadsheetController {
	readonly actions: {
		readonly clip: {
			editSpreadsheet(projectId: string, edits: readonly ClipSpreadsheetEdit[]): unknown;
			pasteSpreadsheet(projectId: string, edits: readonly ClipSpreadsheetEdit[], rows: readonly ClipSpreadsheetNewRow[],
				files?: readonly { readonly reference: string; readonly file: File }[]): Promise<unknown>;
		};
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
	readonly fileService?: {
		readonly isDesktop: boolean;
		chooseFiles(request: { purpose: string; multiple: boolean }): Promise<readonly unknown[]>;
		withReadDescriptors(descriptors: readonly unknown[], request: Record<string, never>, consume: (files: readonly File[]) => Promise<void>): Promise<unknown>;
	};
}

interface PendingPaste {
	readonly project: NonNullable<SpreadsheetSnapshot['project']>;
	readonly plan: ReturnType<typeof planClipSpreadsheetPaste>;
	readonly missing: readonly string[];
}

type CellDraft = SpreadsheetCellDraft;
const ORIGIN: SpreadsheetCell = { row: 0, column: 0 };

export default function ClipSpreadsheetPanel(props: ClipSpreadsheetPanelProps) {
	return <ClipSpreadsheetSurface key={props.snapshot.project?.id ?? ''} {...props} />;
}

function ClipSpreadsheetSurface({ controller, snapshot, copy, fileService }: ClipSpreadsheetPanelProps) {
	const labels = useMemo(() => resolveEditorCopyScope('clipSpreadsheet', CLIP_SPREADSHEET_COPY_BY_LOCALE.en, copy), [copy]);
	const rows = useMemo(() => getClipSpreadsheetRows(snapshot.project), [snapshot.project]);
	const [anchor, setAnchor] = useState(ORIGIN);
	const [focus, setFocus] = useState(ORIGIN);
	const [hasSelection, setHasSelection] = useState(false);
	const [draft, setDraft] = useState<CellDraft | null>(null);
	const draftRef = useRef<CellDraft | null>(null);
	const selectDraftOnFocus = useRef(true);
	const updateDraft = (value: CellDraft | null): void => { draftRef.current = value; setDraft(value); };
	const [error, setError] = usePresentationFeedback(copy);
	const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
	const [pasting, setPasting] = useState(false);
	const tableRef = useRef<HTMLTableElement>(null);
	const restoreGridFocus = useRef<SpreadsheetCell | 'grid' | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const filesRef = useRef<HTMLInputElement>(null);
	const alive = useRef(true);
	const liveProject = useRef(snapshot.project);
	liveProject.current = snapshot.project;
	const blocked = selectAudioEditorEditBlock(snapshot).blocked || pasting;
	const liveBlocked = useRef(blocked);
	liveBlocked.current = blocked;
	const columns = CLIP_SPREADSHEET_COLUMNS;
	const range = hasSelection ? normalizeSpreadsheetRange(clampCell(anchor), clampCell(focus)) : null;
	const active = clampCell(focus);
	const projectId = snapshot.project?.id;
	const rowIdentity = useSpreadsheetRowIdentity(rows);
	const rowPresentation = useSpreadsheetRows(rows, labels);
	const cellIndex = useMemo(createSpreadsheetCellIndex, []);
	const liveRowActions = useRef<SpreadsheetRowActions>(null);
	const rowActions = useMemo<SpreadsheetRowActions>(() => ({
		finishEdit: () => liveRowActions.current!.finishEdit(),
		selectCell: (cell, extend) => liveRowActions.current!.selectCell(cell, extend),
		beginEdit: cell => liveRowActions.current!.beginEdit(cell),
		updateDraft: value => liveRowActions.current!.updateDraft(value),
		apply: edits => liveRowActions.current!.apply(edits),
		selectRow: (row, extend) => liveRowActions.current!.selectRow(row, extend),
		isDraftActive: () => liveRowActions.current!.isDraftActive(),
		registerCell: cellIndex.register,
	}), [cellIndex]);

	useEffect(() => {
		alive.current = true;
		const frame = requestAnimationFrame(() => {
			const activeElement = tableRef.current?.ownerDocument.activeElement;
			if (!activeElement?.closest('[data-workspace-panel-menu]')) tableRef.current?.focus();
		});
		return () => { cancelAnimationFrame(frame); alive.current = false; };
	}, []);
	useEffect(() => {
		setAnchor(ORIGIN); setFocus(ORIGIN); setHasSelection(false); draftRef.current = null; setDraft(null); setError('');
	}, [rowIdentity, setError]);
	useEffect(() => {
		if (draftRef.current) {
			inputRef.current?.focus();
			if (selectDraftOnFocus.current) inputRef.current?.select();
		}
	}, [draft?.clipId, draft?.row, draft?.column]);
	useEffect(() => { if (blocked) { draftRef.current = null; setDraft(null); } }, [blocked]);
	useEffect(() => {
		const target = restoreGridFocus.current;
		if (!pendingPaste && !error && !pasting && target) {
			restoreGridFocus.current = null;
			if (target === 'grid') tableRef.current?.focus({ preventScroll: true });
			else focusCell(target, true);
		}
	});

	function clampCell(cell: SpreadsheetCell): SpreadsheetCell {
		return { row: Math.max(0, Math.min(rows.length - 1, cell.row)), column: Math.max(0, Math.min(columns.length - 1, cell.column)) };
	}
	function focusCell(cell: SpreadsheetCell, preventScroll = false): void {
		cellIndex.focus(cell.row, cell.column, preventScroll);
	}
	function selectCell(cell: SpreadsheetCell, extend = false): void {
		const next = clampCell(cell);
		setHasSelection(true);
		if (!extend || !hasSelection) setAnchor(next);
		setFocus(next);
		focusCell(next);
	}
	function selectRange(next: SpreadsheetRange, deferFocus = false): void {
		setHasSelection(true);
		setAnchor({ row: next.top, column: next.left });
		const cell = { row: next.bottom, column: next.right };
		setFocus(cell);
		if (deferFocus) restoreGridFocus.current = cell;
		else focusCell(cell, true);
	}
	function selectAll(): void {
		if (rows.length && finishEdit()) selectRange({ top: 0, left: 0, bottom: rows.length - 1, right: columns.length - 1 });
	}
	function clearSelection(): void {
		if (!finishEdit()) { inputRef.current?.focus(); return; }
		setHasSelection(false); tableRef.current?.focus({ preventScroll: true });
	}
	function apply(edits: readonly ClipSpreadsheetEdit[]): boolean {
		if (blocked || !projectId || !snapshot.project) return false;
		try {
			const missing = findMissingClipSpreadsheetEditSources(snapshot.project, edits);
			if (missing.length) {
				setPendingPaste({ project: snapshot.project, plan: { edits, newRows: [], range: range ?? normalizeSpreadsheetRange(active, active) }, missing });
				setError('');
				return true;
			}
			controller.actions.clip.editSpreadsheet(projectId, edits);
			setError('');
			return true;
		} catch (cause) { setError(feedbackFailure(cause)); return false; }
	}
	function beginEdit(cell: SpreadsheetCell, initial?: string): void {
		const row = rows[cell.row];
		const column = columns[cell.column];
		if (blocked || !row || !column || !isClipSpreadsheetCellEditable(row, column.id)) return;
		if (!hasSelection) selectCell(cell);
		if (column.id === 'reversed' || column.id === 'inverted') {
			if (initial !== undefined) return;
			apply([{ clipId: row.id, column: column.id, value: String(row.cells[column.id] !== 'true') }]);
			return;
		}
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
		if (!range) return '';
		return serializeSpreadsheetTsv(rows.slice(range.top, range.bottom + 1).map(row => (
			columns.slice(range.left, range.right + 1).map(column => row.cells[column.id])
		)));
	}
	async function pasteText(text: string, selected = range): Promise<void> {
		if (blocked || !snapshot.project) return;
		try {
			const plan = planClipSpreadsheetPaste(text, selected, rows);
			const missing = [...new Set([
				...findMissingClipSpreadsheetEditSources(snapshot.project, plan.edits),
				...findMissingClipSpreadsheetSources(snapshot.project, plan.newRows),
			])];
			const pending = { project: snapshot.project, plan, missing };
			setPendingPaste(null); setError('');
			if (missing.length) setPendingPaste(pending);
			else await completePaste(pending);
		} catch (cause) { setError(feedbackFailure(cause)); }
	}
	async function completePaste(pending: PendingPaste, files: readonly File[] = []): Promise<void> {
		if (!alive.current) return;
		if (liveBlocked.current || liveProject.current !== pending.project) {
			setPendingPaste(null); setError(labels.projectChanged); return;
		}
		setPasting(true); liveBlocked.current = true;
		try {
			const matched = matchClipSpreadsheetSourceFiles(pending.missing, files);
			await withWebFileLoadLimitContext(() => controller.actions.clip.pasteSpreadsheet(
				pending.project.id, pending.plan.edits, pending.plan.newRows,
				[...matched].map(([reference, file]) => ({ reference, file })),
			));
			if (alive.current) {
				setPendingPaste(null); setError(''); updateDraft(null);
				if (!pending.plan.newRows.length) selectRange(pending.plan.range, true);
				else { setHasSelection(false); restoreGridFocus.current = 'grid'; }
			}
		} catch (cause) { if (alive.current) setError(feedbackFailure(cause)); }
		finally { if (alive.current) setPasting(false); }
	}
	async function chooseReferencedFiles(): Promise<void> {
		const pending = pendingPaste;
		if (!pending || blocked) return;
		if (!fileService?.isDesktop) { filesRef.current?.click(); return; }
		try {
			const descriptors = await fileService.chooseFiles({ purpose: 'audio', multiple: true });
			await fileService.withReadDescriptors(descriptors, {}, async files => {
				if (files.length) await completePaste(pending, files);
			});
		} catch (cause) { if (alive.current) setError(feedbackFailure(cause)); }
	}
	function historyAction(action: 'undo' | 'redo'): void {
		if (blocked) return;
		try { controller.actions.edit[action](); updateDraft(null); setError(''); }
		catch (cause) { setError(feedbackFailure(cause)); }
	}
	function handleKey(event: KeyboardEvent<HTMLTableElement>): void {
		if (event.defaultPrevented || !spreadsheetOwnsKeyboard(event, draft !== null)) return;
		if (event.key === 'Escape' && !draft) {
			if (hasSelection) { event.preventDefault(); event.stopPropagation(); clearSelection(); }
			return;
		}
		const tabLeavesGrid = event.key === 'Tab' && !draft && (!hasSelection || (event.shiftKey
			? active.row === 0 && active.column === 0
			: active.row === rows.length - 1 && active.column === columns.length - 1));
		if (tabLeavesGrid) return;
		event.stopPropagation();
		if (event.target instanceof HTMLButtonElement) return;
		if (draft) {
			if (event.nativeEvent?.isComposing) return;
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
		if (!rows.length) return;
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
		else if (event.key === 'Enter' || event.key === 'F2' || (event.code === 'Space' && ['reversed', 'inverted'].includes(columns[active.column]!.id))) {
			event.preventDefault(); if (!hasSelection) selectCell(active); beginEdit(active);
		}
		else if (event.key.length === 1 && !modifier && !event.altKey) { event.preventDefault(); beginEdit(active, event.key); }
	}
	function nextCell(cell: SpreadsheetCell, direction: 'horizontal' | 'vertical', step: number): SpreadsheetCell {
		if (direction === 'vertical') return clampCell({ ...cell, row: cell.row + step });
		const index = Math.max(0, Math.min(rows.length * columns.length - 1, cell.row * columns.length + cell.column + step));
		return { row: Math.floor(index / columns.length), column: index % columns.length };
	}
	function headerRange(kind: 'row' | 'column', index: number, extend: boolean): void {
		if (!rows.length || (draft && !finishEdit())) return;
		const extending = extend && hasSelection;
		const nextAnchor = kind === 'row'
			? { row: extending ? anchor.row : index, column: 0 }
			: { row: 0, column: extending ? anchor.column : index };
		const nextFocus = kind === 'row'
			? { row: index, column: columns.length - 1 }
			: { row: rows.length - 1, column: index };
		setHasSelection(true);
		setAnchor(nextAnchor); setFocus(nextFocus); focusCell(nextFocus, true);
	}

	liveRowActions.current = { finishEdit, selectCell, beginEdit, updateDraft, apply, selectRow: (row, extend) => headerRange('row', row, extend), isDraftActive: () => draft !== null, registerCell: cellIndex.register };
	const closeFeedback = (): void => { if (!pasting) { setPendingPaste(null); setError(''); } };
	return <div className="audio-editor-clip-spreadsheet" data-clip-spreadsheet>
		<div className="audio-editor-clip-spreadsheet__content" onKeyDown={event => {
			if (spreadsheetOwnsKeyboard(event, draft !== null) && (!['Escape', 'Tab'].includes(event.key) || draft)) event.stopPropagation();
		}}>
			<input ref={filesRef} type="file" multiple hidden accept="audio/*,.aac,.aif,.aiff,.bw64,.flac,.m4a,.mp2,.mp3,.oga,.ogg,.opus,.rf64,.wav,.wave,.wavpack,.wv"
				onChange={event => {
					const files = Array.from(event.currentTarget.files ?? []);
					event.currentTarget.value = '';
					if (pendingPaste && files.length) void completePaste(pendingPaste, files);
				}} />
			<div className="audio-editor-clip-spreadsheet__scroll" onMouseDown={event => {
				if (event.button === 0 && event.target === event.currentTarget) { event.preventDefault(); clearSelection(); }
			}}>
				<table ref={tableRef} role="grid" aria-label={labels.title} aria-multiselectable="true" aria-busy={pasting}
					aria-readonly={blocked} tabIndex={hasSelection ? -1 : 0}
					onKeyDown={handleKey}
					onCopy={event => {
						if (draft) return;
						event.preventDefault(); event.stopPropagation();
						if (!range) return;
						try { event.clipboardData.setData('text/plain', copyText()); setError(''); }
						catch (cause) { setError(feedbackFailure(cause)); }
					}}
					onPaste={event => {
						if (draft && !/[\t\r\n]/u.test(event.clipboardData.getData('text/plain'))) return;
						event.preventDefault(); event.stopPropagation(); updateDraft(null); void pasteText(event.clipboardData.getData('text/plain'));
					}}>
					<thead><tr>
						<th scope="col"><button type="button" tabIndex={-1} aria-label={labels.selectAll} onClick={selectAll}>#</button></th>
						{columns.map((column, index) => <th key={column.id} scope="col" aria-readonly={!column.editable}>
							<button type="button" tabIndex={-1} onClick={event => headerRange('column', index, event.shiftKey)}>{labels[column.id]}</button>
						</th>)}
					</tr></thead>
					<tbody>{rowPresentation.map((presentation, rowIndex) => {
						const selected = range !== null && rowIndex >= range.top && rowIndex <= range.bottom;
						return <SpreadsheetRow key={presentation.row.id} presentation={presentation} rowIndex={rowIndex}
							selectedLeft={selected ? range.left : -1} selectedRight={selected ? range.right : -1}
							activeColumn={hasSelection && active.row === rowIndex ? active.column : -1}
							draft={draft?.clipId === presentation.row.id ? draft : null} blocked={blocked} inputRef={inputRef} actions={rowActions} />;
					})}</tbody>
				</table>
			</div>
		</div>
		{(pendingPaste || error) && createPortal(<AudioEditorDialogShell title={labels.title} onClose={closeFeedback}
			footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
				{pendingPaste && <Button variant="secondary" disabled={blocked} onClick={() => { void chooseReferencedFiles(); }}>{labels.loadFiles}</Button>}
				<Button variant="secondary" disabled={pasting} onClick={closeFeedback}>{pendingPaste ? labels.cancelPaste : labels.close}</Button>
			</>} />}>
			{pendingPaste && <><p>{labels.missingFiles}</p><ul>{pendingPaste.missing.map(reference => <li key={reference}>{reference}</li>)}</ul></>}
			{pasting && <p role="status">{labels.pasting}</p>}
			{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
		</AudioEditorDialogShell>, tableRef.current?.closest('[data-audio-editor]') ?? document.body)}
	</div>;
}
