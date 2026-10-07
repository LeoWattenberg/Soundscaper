/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createRef } from 'react';
import { CLIP_SPREADSHEET_COLUMNS, type ClipSpreadsheetRow } from '../src/common/editor/clip-spreadsheet.ts';
import { SpreadsheetRow, type SpreadsheetRowActions } from '../src/common/editor/ui/clip-spreadsheet/SpreadsheetRow.tsx';
import { createSpreadsheetCellIndex, useSpreadsheetRowIdentity, useSpreadsheetRows } from '../src/common/editor/ui/clip-spreadsheet/row-presentation.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { installResponsivenessTestDom as installReactTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

function labels() { return Object.fromEntries([...CLIP_SPREADSHEET_COLUMNS.map(column => [column.id, column.id]), ['selectRow', 'Select row {row}'], ['readOnly', 'Read only'], ['linkedPitchReadOnly', 'Linked pitch']]); }

test('spreadsheet row identity and editability metadata are retained separately from selection and locale', async () => {
	const dom = installReactTestDom(); let identityReads = 0, editableReads = 0;
	const row: ClipSpreadsheetRow = { get id() { identityReads++; return 'a'; }, kind: 'audio', get editable() { editableReads++; return true; }, pitchLinked: true, cells: Object.fromEntries(CLIP_SPREADSHEET_COLUMNS.map(column => [column.id, ''])) as ClipSpreadsheetRow['cells'] };
	let rows = [row]; let copy = labels(); let identity = '', result: ReturnType<typeof useSpreadsheetRows> = [];
	function Harness({ revision }: { revision: number }) { identity = useSpreadsheetRowIdentity(rows); result = useSpreadsheetRows(rows, copy); return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const first = result, work = { identityReads, editableReads };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(result, first); assert.deepEqual({ identityReads, editableReads }, work); assert.equal(identity, 'a'); assert.equal(result[0]?.cells.find(cell => cell.id === 'pitch')?.editable, false);
		copy = { ...copy, linkedPitchReadOnly: 'Verbunden' }; await act(async () => root.render(<Harness revision={31} />)); assert.notEqual(result, first); assert.equal(identityReads, work.identityReads); assert.equal(result[0]?.cells.find(cell => cell.id === 'pitch')?.title, 'Verbunden');
		rows = [{ ...row, id: 'b', pitchLinked: false }]; await act(async () => root.render(<Harness revision={32} />)); assert.equal(identity, 'b'); assert.equal(result[0]?.cells.find(cell => cell.id === 'pitch')?.editable, true);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('unaffected spreadsheet rows skip cell renders while focus, checkbox and draft callbacks keep current authority', async () => {
	const dom = installReactTestDom(); let reads = 0;
	const cells = { ...Object.fromEntries(CLIP_SPREADSHEET_COLUMNS.map(column => [column.id, 'false'])), get name() { reads++; return 'Original'; } } as ClipSpreadsheetRow['cells'];
	const rows: readonly ClipSpreadsheetRow[] = [{ id: 'a', kind: 'audio', editable: true, cells }]; const copy = labels();
	const inputRef = createRef<HTMLInputElement>(); const applied: unknown[] = [], selected: unknown[] = [], drafts: unknown[] = [];
	const index = createSpreadsheetCellIndex();
	const actions: SpreadsheetRowActions = { finishEdit: () => true, selectCell: (...args) => selected.push(args), beginEdit: () => undefined, updateDraft: value => drafts.push(value), apply: edits => { applied.push(edits); return true; }, selectRow: () => undefined, isDraftActive: () => false, registerCell: index.register };
	let activeColumn = -1; let draft: { row: number; column: number; clipId: string; value: string } | null = null;
	function Harness({ revision }: { revision: number }) { const presentation = useSpreadsheetRows(rows, copy); return <table data-revision={revision}><tbody><SpreadsheetRow presentation={presentation[0]!} rowIndex={0} selectedLeft={-1} selectedRight={-1} activeColumn={activeColumn} draft={draft} blocked={false} inputRef={inputRef} actions={actions} /></tbody></table>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const work = reads;
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />)); assert.equal(reads, work);
		index.focus(0, 0, true); assert.equal(dom.container.ownerDocument.activeElement === dom.one('[data-column="name"]'), true);
		activeColumn = 0; await act(async () => root.render(<Harness revision={31} />)); assert.equal(reactProps(dom.one('[data-column="name"]')).tabIndex, 0);
		const checkbox = dom.one('[aria-label="reversed"]'); await act(async () => { reactProps(checkbox).onChange({ currentTarget: { checked: true } }); });
		assert.deepEqual(applied, [[{ clipId: 'a', column: 'reversed', value: 'true' }]]);
		draft = { row: 0, column: 0, clipId: 'a', value: 'Draft' }; await act(async () => root.render(<Harness revision={32} />));
		await act(async () => { reactProps(dom.one('[aria-label="name"]')).onChange({ currentTarget: { value: 'Latest' } }); }); assert.deepEqual(drafts, [{ row: 0, column: 0, clipId: 'a', value: 'Latest' }]);
		await act(async () => root.unmount()); index.focus(0, 0); assert.equal(index.size(), 0);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('the production spreadsheet uses direct cell focus and dispatches retained row events to the current controller', async () => {
	const { default: ClipSpreadsheetPanel } = await import('../src/common/editor/ui/clip-spreadsheet/ClipSpreadsheetPanel.tsx');
	const { createCurrentAudioEditorProject } = await import('../src/common/editor/project-current.ts');
	const { applyEditorCommand } = await import('../src/common/editor/commands.js');
	const { ENGLISH_COPY } = await import('../src/common/i18n/catalogs.js');
	const dom = installReactTestDom(); const prior = new Map<string, PropertyDescriptor | undefined>();
	const inputPrototype = Object.getPrototypeOf(dom.container) as object; const priorSelect = Object.getOwnPropertyDescriptor(inputPrototype, 'select'); let selectCalls = 0;
	Object.defineProperty(inputPrototype, 'select', { configurable: true, value: () => { selectCalls++; } });
	for (const key of ['HTMLInputElement', 'HTMLButtonElement']) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: class {} }); }
	const project = applyEditorCommand(createCurrentAudioEditorProject({ id: 'grid', sampleRate: 48000 }), { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'source', storageKey: 'source', name: 'Voice.wav', sampleRate: 48000, frameCount: 48000, channelCount: 1 } },
		{ type: 'track/add', track: { id: 'track', name: 'Voice' } },
		{ type: 'clip/add', trackId: 'track', clip: { id: 'clip', title: 'Original', sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: 48000, timelineStartFrame: 0, durationFrames: 48000 } },
	] });
	const edits: unknown[] = [];
	const controller = (owner: string) => ({ actions: { clip: { editSpreadsheet: (...args: unknown[]) => edits.push([owner, ...args]), pasteSpreadsheet: () => Promise.resolve() }, edit: { undo() {}, redo() {} } } });
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<ClipSpreadsheetPanel controller={controller('old')} snapshot={{ project }} copy={ENGLISH_COPY} />));
		const table = dom.one('table'); table.querySelector = () => { throw new Error('Grid navigation traversed the table.'); };
		const cell = dom.one('[data-column="name"]');
		await act(async () => { reactProps(cell).onMouseDown({ button: 0, target: {}, shiftKey: false, preventDefault() {} }); });
		assert.equal(dom.container.ownerDocument.activeElement === cell, true);
		await act(async () => root.render(<ClipSpreadsheetPanel controller={controller('current')} snapshot={{ project }} copy={ENGLISH_COPY} />));
		await act(async () => { reactProps(table).onKeyDown({ key: 'F2', code: 'F2', target: {}, preventDefault() {}, stopPropagation() {} }); });
		const input = dom.one('[aria-label="Name"]'); assert.equal(selectCalls, 1);
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: 'Latest' } }); });
		await act(async () => { reactProps(table).onKeyDown({ key: 'Enter', code: 'Enter', target: {}, preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(edits, [['current', 'grid', [{ clipId: 'clip', column: 'name', value: 'Latest' }]]]);
	} finally {
		await act(async () => root.unmount());
		if (priorSelect) Object.defineProperty(inputPrototype, 'select', priorSelect); else Reflect.deleteProperty(inputPrototype, 'select');
		for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
		dom.restore();
	}
});
