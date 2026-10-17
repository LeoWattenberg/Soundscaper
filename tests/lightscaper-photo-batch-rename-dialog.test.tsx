/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { PhotoLibraryBatchRenamePlanV1, PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameSnapshotV1 } from '../src/common/editor/photo-library-batch-rename-port-v1.ts';
import type { PhotoLibraryBatchRenameWorkflowReceiptV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import type { PhotoBatchRenameDialogCopyV1, PhotoBatchRenameDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoBatchRenameDialog.tsx';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: PhotoBatchRenameDialog } = await import('../src/common/editor/ui/lightscaper/PhotoBatchRenameDialog.tsx');
hooks.deregister();

const copy: PhotoBatchRenameDialogCopyV1 = {
	photoBatchRenameTitle: 'Rename selected photos', photoBatchRenamePreview: 'Preview', photoBatchRenameAction: 'Apply names',
	photoBatchRenameClose: 'Close', photoBatchRenameCount: '{count} selected photos', photoBatchCurrentName: 'Current name', photoBatchNewName: 'New name',
	photoBatchRenamed: 'Renamed', photoBatchRestored: 'Restored', photoBatchUnchanged: 'Unchanged', photoBatchFailed: 'Failed',
	photoBatchCancelled: 'Cancelled; saved names remain', photoBatchInterrupted: 'Interrupted; saved names remain', photoBatchRefreshFailed: 'Library refresh failed',
	photoImportNameTemplate: 'Template', photoImportSequenceStart: 'Start', photoImportSequencePadding: 'Padding',
	photoWorking: 'Working', photoCancelAction: 'Cancel',
};
const snapshot: PhotoLibraryBatchRenameSnapshotV1 = Object.freeze({ schemaVersion: 1, catalogId: 'internal-catalog-id',
	selection: Object.freeze([Object.freeze({ photoId: 'internal-photo-a', expectedRevision: 7, fileName: 'e\u0301-東京.png' }),
		Object.freeze({ photoId: 'internal-photo-b', expectedRevision: 11, fileName: 'Second.JPG' })]) });

function planFor(request: Parameters<PhotoBatchRenameDialogPropsV1['onPlan']>[0]): PhotoLibraryBatchRenamePlanV1 {
	return Object.freeze({ schemaVersion: 1, kind: 'photo-batch-rename', catalogId: request.catalogId, rename: request.rename,
		items: Object.freeze(request.selection.map((row, index) => Object.freeze({ index, photoId: row.photoId, expectedRevision: row.expectedRevision,
			sourceFileName: row.fileName, fileName: `Chosen-${String(request.rename.sequenceStart + index)}.PNG` }))) });
}
function receiptFor(plan: PhotoLibraryBatchRenamePlanV1, completion: PhotoLibraryBatchRenameReceiptV1['completion'] = 'finished'): PhotoLibraryBatchRenameReceiptV1 {
	const selected = completion === 'finished' ? plan.items : plan.items.slice(0, 1);
	return Object.freeze({ schemaVersion: 1, action: 'rename', completion, message: null,
		items: Object.freeze(selected.map(row => Object.freeze({ index: row.index, photoId: row.photoId, previousDisplayName: row.sourceFileName,
			fileName: row.fileName, revision: row.expectedRevision + 1, status: 'renamed', message: null }))),
		undo: Object.freeze({ schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId: plan.catalogId,
			items: Object.freeze(selected.map(row => Object.freeze({ index: row.index, photoId: row.photoId, expectedRevision: row.expectedRevision + 1,
				fileName: row.fileName, previousDisplayName: row.sourceFileName }))) }) });
}
function props(overrides: Partial<PhotoBatchRenameDialogPropsV1> = {}): PhotoBatchRenameDialogPropsV1 {
	return { snapshot, busy: false, error: null, copy, onPlan: planFor,
		onApply: async plan => ({ outcome: 'acknowledged', receipt: receiptFor(plan), notice: null }), onClose: () => undefined, ...overrides };
}

test('mount and recipe edits do no work; explicit preview submits exact scalars and Apply uses that frozen plan', async () => {
	const requests: Parameters<PhotoBatchRenameDialogPropsV1['onPlan']>[0][] = [], applied: PhotoLibraryBatchRenamePlanV1[] = [];
	let planned: PhotoLibraryBatchRenamePlanV1 | null = null;
	const mounted = await mount(props({ onPlan: request => { requests.push(request); planned = planFor(request); return planned; },
		onApply: async plan => { applied.push(plan); return { outcome: 'acknowledged', receipt: receiptFor(plan), notice: null }; } }));
	try {
		assert.equal(requests.length, 0); assert.equal(applied.length, 0);
		assert.equal(reactProps(mounted.dom.one('[data-batch-rename-apply]')).disabled, true);
		await mounted.change('template', { value: '{stem}-原本 e\u0301-{sequence}.{extension}' });
		await mounted.change('sequence-start', { valueAsNumber: 7 }); await mounted.change('sequence-padding', { valueAsNumber: 6 });
		assert.equal(requests.length, 0); await mounted.preview();
		assert.equal(requests[0]?.selection, snapshot.selection); assert.equal(requests[0]?.catalogId, snapshot.catalogId);
		assert.deepEqual(requests[0]?.rename, { template: '{stem}-原本 e\u0301-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 6 });
		assert.equal(Object.isFrozen(requests[0]), true); assert.equal(Object.isFrozen(requests[0]?.rename), true);
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-plan-row]').length, 2);
		assert.match(mounted.dom.container.textContent, /e\u0301-東京\.png/u); assert.match(mounted.dom.container.textContent, /Chosen-7\.PNG/u);
		await mounted.click('[data-batch-rename-apply]'); assert.equal(applied[0], planned);
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-result-row]').length, 2);
		assert.equal(reactProps(mounted.dom.one('[data-batch-rename-template]')).disabled, true);
		assert.doesNotMatch(mounted.dom.container.textContent, /internal-photo|internal-catalog/u);
	} finally { await mounted.dispose(); }
});

test('editing a recipe invalidates its preview and a planner refusal preserves the draft and captured selection', async () => {
	let calls = 0, writes = 0;
	const mounted = await mount(props({ onPlan: request => { calls++; if (calls > 1) throw new Error('Unsupported placeholder'); return planFor(request); },
		onApply: async () => { writes++; return { outcome: 'failed' }; } }));
	try {
		await mounted.preview(); await mounted.change('template', { value: '{unknown}-東京' });
		assert.equal(mounted.dom.find('[data-batch-rename-plan-row]'), null);
		await mounted.click('[data-batch-rename-apply]'); assert.equal(writes, 0);
		await mounted.preview(); assert.equal(mounted.dom.one('[data-batch-rename-template]').value, '{unknown}-東京');
		assert.match(mounted.dom.one('[role="alert"]').textContent, /Unsupported placeholder/u);
		assert.match(mounted.dom.container.textContent, /2 selected photos/u); assert.equal(writes, 0);
	} finally { await mounted.dispose(); }
});

test('a thrown Error message accessor cannot execute or veto planner and preack failure feedback', async () => {
	let getters = 0, calls = 0;
	const failure = Object.defineProperty(new Error(), 'message', { get: () => { getters++; throw new Error('Message getter must not run'); } });
	const mounted = await mount(props({ onPlan: request => { if (++calls === 1) throw failure; return planFor(request); },
		onApply: async () => { throw failure; } }));
	try {
		await mounted.change('template', { value: 'Keep this draft' }); await mounted.preview();
		assert.equal(getters, 0); assert.equal(mounted.dom.one('[role="alert"]').textContent, copy.photoBatchFailed);
		assert.equal(mounted.dom.one('[data-batch-rename-template]').value, 'Keep this draft');
		await mounted.preview(); await mounted.click('[data-batch-rename-apply]');
		assert.equal(getters, 0); assert.equal(mounted.dom.one('[role="alert"]').textContent, copy.photoBatchFailed);
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-plan-row]').length, 2);
	} finally { await mounted.dispose(); }
});

test('a retained Apply handler cannot publish the invalidated old preview after a recipe edit', async () => {
	let writes = 0;
	const mounted = await mount(props({ onApply: async () => { writes++; return { outcome: 'failed' }; } }));
	try {
		await mounted.preview(); const apply = reactProps(mounted.dom.one('[data-batch-rename-apply]')).onClick;
		await mounted.change('sequence-start', { valueAsNumber: 20 }); await act(async () => { apply?.({}); });
		assert.equal(writes, 0); assert.equal(mounted.dom.find('[data-batch-rename-plan-row]'), null);
	} finally { await mounted.dispose(); }
});

test('one held Apply refuses duplicate events and draft changes; a preack rejection leaves the exact plan available', async () => {
	const held = deferred<PhotoLibraryBatchRenameWorkflowReceiptV1>(); let writes = 0;
	const mounted = await mount(props({ onApply: () => { writes++; return held.promise; } }));
	try {
		await mounted.preview(); await mounted.click('[data-batch-rename-apply]');
		await mounted.click('[data-batch-rename-apply]'); await mounted.change('template', { value: 'Overwrite' });
		assert.equal(writes, 1); assert.equal(mounted.dom.one('[data-batch-rename-template]').value, '{stem}-{sequence}.{extension}');
		await act(async () => { held.reject(new Error('Revision conflict')); });
		assert.match(mounted.dom.one('[role="alert"]').textContent, /Revision conflict/u);
		assert.equal(reactProps(mounted.dom.one('[data-batch-rename-apply]')).disabled, false);
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-plan-row]').length, 2);
		assert.equal(mounted.dom.find('[data-batch-rename-result-row]'), null);
	} finally { held.resolve({ outcome: 'failed' }); await mounted.dispose(); }
});

test('retained event handlers cannot bypass later parent busy state or the acknowledged form freeze', async () => {
	let writes = 0;
	const initial = props({ onApply: async plan => { writes++; return { outcome: 'acknowledged', receipt: receiptFor(plan), notice: null }; } });
	const mounted = await mount(initial);
	try {
		await mounted.preview();
		const apply = reactProps(mounted.dom.one('[data-batch-rename-apply]')).onClick;
		const change = reactProps(mounted.dom.one('[data-batch-rename-template]')).onChange;
		await mounted.render({ ...initial, busy: true });
		await act(async () => { apply?.({}); change?.({ currentTarget: { value: 'Busy overwrite' } }); });
		assert.equal(writes, 0); assert.equal(mounted.dom.one('[data-batch-rename-template]').value, '{stem}-{sequence}.{extension}');
		await mounted.render(initial); await mounted.click('[data-batch-rename-apply]'); assert.equal(writes, 1);
		await act(async () => { apply?.({}); change?.({ currentTarget: { value: 'After acknowledgement' } }); });
		assert.equal(writes, 1); assert.equal(mounted.dom.one('[data-batch-rename-template]').value, '{stem}-{sequence}.{extension}');
	} finally { await mounted.dispose(); }
});

test('cancel stops remaining work but a returned partial durable receipt remains visible and freezes the recipe', async () => {
	const held = deferred<PhotoLibraryBatchRenameWorkflowReceiptV1>(); let signal: AbortSignal | undefined;
	const planned = planFor({ ...snapshot, rename: { template: '{stem}', sequenceStart: 1, sequencePadding: 3 } });
	const mounted = await mount(props({ onPlan: () => planned, onApply: (_plan, options) => { signal = options?.signal; return held.promise; } }));
	try {
		await mounted.preview(); await mounted.click('[data-batch-rename-apply]'); await mounted.click('[data-batch-rename-cancel]');
		assert.equal(signal?.aborted, true);
		await act(async () => { held.resolve({ outcome: 'acknowledged', receipt: receiptFor(planned, 'cancelled'), notice: 'refresh-failed' }); });
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-result-row]').length, 1);
		assert.match(mounted.dom.container.textContent, /Cancelled; saved names remain/u); assert.match(mounted.dom.container.textContent, /Library refresh failed/u);
		assert.equal(reactProps(mounted.dom.one('[data-batch-rename-template]')).disabled, true);
	} finally { held.resolve({ outcome: 'cancelled' }); await mounted.dispose(); }
});

test('snapshot replacement aborts held work, resets the draft and fences the old acknowledgement', async () => {
	const held = deferred<PhotoLibraryBatchRenameWorkflowReceiptV1>(); let signal: AbortSignal | undefined;
	const initial = props({ onApply: (_plan, options) => { signal = options?.signal; return held.promise; } });
	const mounted = await mount(initial);
	try {
		await mounted.change('template', { value: 'Old recipe' }); await mounted.preview(); await mounted.click('[data-batch-rename-apply]');
		const replacement: PhotoLibraryBatchRenameSnapshotV1 = { ...snapshot, selection: [{ photoId: 'replacement-photo', expectedRevision: 1, fileName: 'Replacement.png' }] };
		await mounted.render({ ...initial, snapshot: replacement }); assert.equal(signal?.aborted, true);
		assert.equal(mounted.dom.one('[data-batch-rename-template]').value, '{stem}-{sequence}.{extension}');
		await act(async () => { held.resolve({ outcome: 'acknowledged', receipt: receiptFor(planFor({ ...snapshot,
			rename: { template: 'Old recipe', sequenceStart: 1, sequencePadding: 3 } })), notice: null }); });
		assert.equal(mounted.dom.find('[data-batch-rename-result-row]'), null); assert.match(mounted.dom.container.textContent, /1 selected photos/u);
	} finally { held.resolve({ outcome: 'failed' }); await mounted.dispose(); }
});

test('close is registered before a synchronously reentrant borrowed Apply and late work cannot republish', async () => {
	const held = deferred<PhotoLibraryBatchRenameWorkflowReceiptV1>(); let signal: AbortSignal | undefined, closes = 0;
	const mounted: Awaited<ReturnType<typeof mount>> = await mount(props({ onClose: () => { closes++; mounted.unmount(); }, onApply: (_plan, options) => {
		signal = options?.signal; reactProps(mounted.dom.one('[data-batch-rename-close]')).onClick?.({}); return held.promise;
	} }));
	try {
		await mounted.preview(); await mounted.click('[data-batch-rename-apply]'); assert.equal(closes, 1); assert.equal(signal?.aborted, true);
		await act(async () => { held.resolve({ outcome: 'acknowledged', receipt: receiptFor(planFor({ ...snapshot,
			rename: { template: '{stem}', sequenceStart: 1, sequencePadding: 3 } })), notice: null }); });
		assert.equal(mounted.dom.find('[role="dialog"]'), null);
	} finally { held.resolve({ outcome: 'cancelled' }); await mounted.dispose(); }
});

test('direct unmount aborts its admitted observer while a late failure remains contained', async () => {
	const held = deferred<PhotoLibraryBatchRenameWorkflowReceiptV1>(); let signal: AbortSignal | undefined;
	const mounted = await mount(props({ onApply: (_plan, options) => { signal = options?.signal; return held.promise; } }));
	try {
		await mounted.preview(); await mounted.click('[data-batch-rename-apply]');
		await act(() => { mounted.unmount(); }); assert.equal(signal?.aborted, true);
		await act(async () => { held.reject(new Error('Retired cleanup diagnostic')); });
		assert.equal(mounted.dom.find('[role="dialog"]'), null);
	} finally { held.resolve({ outcome: 'cancelled' }); await mounted.dispose(); }
});

test('preack failed, busy and cancelled outcomes preserve the exact preview without fabricating result rows', async () => {
	for (const outcome of ['failed', 'busy', 'cancelled'] as const) {
		let writes = 0;
		const mounted = await mount(props({ onApply: async () => { writes++; return { outcome }; } }));
		try {
			await mounted.preview(); await mounted.click('[data-batch-rename-apply]');
			assert.equal(writes, 1); assert.equal(mounted.dom.find('[data-batch-rename-result-row]'), null);
			assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-plan-row]').length, 2);
			assert.equal(reactProps(mounted.dom.one('[data-batch-rename-apply]')).disabled, false);
		} finally { await mounted.dispose(); }
	}
});

test('results display 64 exact-text rows with restored, unchanged and failed outcomes and no opaque identities', async () => {
	const maximal: PhotoLibraryBatchRenameSnapshotV1 = { ...snapshot, selection: Array.from({ length: 64 }, (_, index) => ({
		photoId: `internal-photo-${String(index)}`, expectedRevision: 1_000_000 + index, fileName: `${String(index)}-e\u0301-東京<&>.PNG`,
	})) };
	const mounted = await mount(props({ snapshot: maximal, onApply: async plan => ({ outcome: 'acknowledged', notice: null,
		receipt: { schemaVersion: 1, action: 'undo', completion: 'interrupted', undo: null, message: 'Cleanup stopped after acknowledged names',
			items: plan.items.map(item => item.index % 3 === 2
				? { index: item.index, photoId: item.photoId, previousDisplayName: item.sourceFileName, fileName: item.fileName,
					revision: null, status: 'failed', message: '<img src=x onerror=bad()> & storage failure' }
				: { index: item.index, photoId: item.photoId, previousDisplayName: item.sourceFileName,
					fileName: item.index % 3 === 1 ? item.sourceFileName : item.fileName, revision: item.expectedRevision + (item.index % 3 === 1 ? 0 : 1),
					status: item.index % 3 === 1 ? 'unchanged' : 'restored', message: null }) },
	}) }));
	try {
		await mounted.preview(); assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-plan-row]').length, 64);
		await mounted.click('[data-batch-rename-apply]');
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-result-row]').length, 64);
		assert.match(mounted.dom.container.textContent, /Restored/u); assert.match(mounted.dom.container.textContent, /Unchanged/u);
		assert.match(mounted.dom.container.textContent, /Failed/u); assert.match(mounted.dom.container.textContent, /Interrupted; saved names remain/u);
		assert.equal(mounted.dom.one('[data-batch-rename-current-name]').textContent, maximal.selection[0]?.fileName);
		assert.match(mounted.dom.container.textContent, /<img src=x onerror=bad\(\)> & storage failure/u); assert.equal(mounted.dom.find('img'), null);
		assert.doesNotMatch(mounted.dom.container.textContent, /internal-photo|internal-catalog|1000000/u);
	} finally { await mounted.dispose(); }
});

test('an unresolved capture renders only its bounded status and close action, with no planner or apply call', async () => {
	let plans = 0, writes = 0, closes = 0;
	const mounted = await mount(props({ snapshot: null, busy: true, onPlan: request => { plans++; return planFor(request); },
		onApply: async () => { writes++; return { outcome: 'failed' }; }, onClose: () => { closes++; } }));
	try {
		assert.equal(mounted.dom.find('form'), null); assert.match(mounted.dom.container.textContent, /Working/u);
		await mounted.click('[data-batch-rename-close]'); assert.equal(closes, 1); assert.equal(plans, 0); assert.equal(writes, 0);
	} finally { await mounted.dispose(); }
});

test('a ready snapshot waits for enabled input before consuming initial focus, then preserves later draft focus', async () => {
	const mounted = await mount(props({ busy: true }));
	try {
		assert.notEqual(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-batch-rename-template]'));
		await mounted.render(props({ busy: false }));
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-batch-rename-template]'));
		const padding = mounted.dom.one('[data-batch-rename-sequence-padding]'); padding.focus();
		await mounted.render(props({ busy: true })); await mounted.render(props({ busy: false }));
		assert.equal(mounted.dom.container.ownerDocument.activeElement, padding);
	} finally { await mounted.dispose(); }
});

async function mount(initial: PhotoBatchRenameDialogPropsV1) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	let unmounted = false;
	const render = async (next: PhotoBatchRenameDialogPropsV1) => { await act(async () => { root.render(<StrictMode><PhotoBatchRenameDialog {...next} /></StrictMode>); }); };
	const unmount = () => { if (!unmounted) { unmounted = true; root.unmount(); } };
	const dispose = async () => { try { await act(() => { unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } };
	try { await render(initial); } catch (error) { await dispose(); throw error; }
	return { dom, render, unmount, dispose,
		async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async change(field: string, currentTarget: unknown) { await act(async () => { reactProps(dom.one(`[data-batch-rename-${field}]`)).onChange?.({ currentTarget }); }); },
		async preview() { await act(async () => { reactProps(dom.one('form')).onSubmit?.({ preventDefault() {} }); }); },
	};
}
