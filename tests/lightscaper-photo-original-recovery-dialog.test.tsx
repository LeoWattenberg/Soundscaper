/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import type { PhotoLibraryOriginalInspectionPageV1, PhotoLibraryOriginalRestorationReceiptV1,
	PhotoLibraryOriginalRestoreTargetV1 } from '../src/common/editor/photo-library-original-recovery-port-v1.ts';
import type { PhotoOriginalRecoveryDialogCopyV1, PhotoOriginalRecoveryDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoOriginalRecoveryDialog.tsx';
import { deferred } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: PhotoOriginalRecoveryDialog } = await import('../src/common/editor/ui/lightscaper/PhotoOriginalRecoveryDialog.tsx');
hooks.deregister();
const copy: PhotoOriginalRecoveryDialogCopyV1 = {
	photoOriginalRecoveryTitle: 'Inspect and restore originals', photoOriginalRecoveryDescription: 'Restore the exact retained original bytes.',
	photoOriginalInspect: 'Reload inspection', photoOriginalVerified: 'Verified', photoOriginalMissing: 'Missing',
	photoOriginalCorrupt: 'Corrupt', photoOriginalUnsupported: 'Unsupported', photoOriginalChooseFile: 'Choose original file',
	photoOriginalRestore: 'Restore original', photoOriginalRestored: 'Original restored', photoOriginalCleanupFailed: 'Temporary cleanup failed',
	photoOriginalRefreshFailed: 'Original restored; library readiness retry failed', photoOriginalCancelled: 'Cancelled',
	photoOriginalPageSummary: '{count} originals on this page', photoOriginalEmpty: 'No originals on this page',
	photoOriginalStartupFailure: 'Library could not open: {message}', photoNextPage: 'Next page', photoCloseMetadata: 'Close',
	photoCancelAction: 'Cancel task', photoWorking: 'Working',
};
type Row = PhotoLibraryOriginalInspectionPageV1['rows'][number];
function row(index: number, inspection: Row['inspection'] = { status: 'missing', reason: 'file' }): Row {
	return { photoId: `private-photo-${String(index)}`, revision: index + 2, fileName: `e\u0301-${String(index)}-<&>.PNG`, inspection,
		binding: { catalogId: 'private-catalog', importId: null, photoId: `private-photo-${String(index)}`,
			assetId: `private-asset-${String(index)}`, sourceId: `private-source-${String(index)}`,
			name: `original-${String(index)}.PNG`, mimeType: 'image/png', sha256: 'a'.repeat(64), size: 3 } };
}
const page: PhotoLibraryOriginalInspectionPageV1 = {
	schemaVersion: 1, catalogId: 'private-catalog', catalogName: 'Library', revision: 8, activeImportId: null,
	startupFailure: { message: 'Retained original is absent' }, rows: [row(0), row(1, { status: 'corrupt', reason: 'digest' }),
		row(2, { status: 'present' }), row(3, { status: 'unsupported', storage: 'future-layout' })], scanned: 4, cursor: 'private-cursor',
};
const receipt: PhotoLibraryOriginalRestorationReceiptV1 = {
	photoId: 'private-photo-0', assetId: 'private-asset-0', sha256: 'a'.repeat(64), size: 3, notices: [],
};
function target(source: PhotoLibraryOriginalInspectionPageV1, index: number): PhotoLibraryOriginalRestoreTargetV1 {
	const item = source.rows[index]; assert.ok(item);
	return { schemaVersion: 1, catalogRevision: source.revision, activeImportId: source.activeImportId,
		photoRevision: item.revision, binding: item.binding };
}
function props(overrides: Partial<PhotoOriginalRecoveryDialogPropsV1> = {}): PhotoOriginalRecoveryDialogPropsV1 {
	return { generation: {}, copy, page, receipt: null, notice: null, busy: false, active: false, cancelled: false,
		error: null, onInspect: async () => undefined, onRestore: async () => receipt, onCancel: () => undefined,
		onClose: () => undefined, ...overrides };
}
async function mount(initial: PhotoOriginalRecoveryDialogPropsV1) {
	// The shared fake DOM does not dispatch native events. Capture only the
	// input's native cancel subscription so this witness cannot pass via JSX.
	const prototype = ReactTestElement.prototype, listeners = new WeakMap<ReactTestElement, Set<EventListener>>();
	const priorAdd = Object.getOwnPropertyDescriptor(prototype, 'addEventListener'), priorRemove = Object.getOwnPropertyDescriptor(prototype, 'removeEventListener');
	const add = prototype.addEventListener, remove = prototype.removeEventListener;
	Object.defineProperty(prototype, 'addEventListener', { configurable: true, value: function (this: ReactTestElement, ...args: unknown[]) {
		const [type, listener] = args;
		if (type === 'cancel' && typeof listener === 'function') {
			const set = listeners.get(this) ?? new Set<EventListener>(); set.add(listener as EventListener); listeners.set(this, set);
		}
		Reflect.apply(add, this, args);
	} });
	Object.defineProperty(prototype, 'removeEventListener', { configurable: true, value: function (this: ReactTestElement, ...args: unknown[]) {
		const [type, listener] = args;
		if (type === 'cancel' && typeof listener === 'function') listeners.get(this)?.delete(listener as EventListener);
		Reflect.apply(remove, this, args);
	} });
	const restoreListeners = () => {
		if (priorAdd) Object.defineProperty(prototype, 'addEventListener', priorAdd); else Reflect.deleteProperty(prototype, 'addEventListener');
		if (priorRemove) Object.defineProperty(prototype, 'removeEventListener', priorRemove); else Reflect.deleteProperty(prototype, 'removeEventListener');
	};
	let current = initial;
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>>;
	try { mounted = await mountPhotoImportUi(() => <PhotoOriginalRecoveryDialog {...current} />); }
	catch (error) { restoreListeners(); throw error; }
	return { ...mounted,
		async dispose() { try { await mounted.dispose(); } finally { restoreListeners(); } },
		async cancelPicker() {
			const callbacks = listeners.get(mounted.dom.one('[data-original-file]')); assert.ok(callbacks?.size, 'Native file-picker cancel listener is required');
			await act(async () => { for (const callback of callbacks) callback(new Event('cancel')); });
		},
		async replace(next: PhotoOriginalRecoveryDialogPropsV1) { current = next; await mounted.render(); },
		click(selector: string) { return mounted.event(selector, 'onClick'); },
		select(index: number) { return mounted.event(`[data-original-target="${String(index)}"]`, 'onChange'); },
		async choose(file: File) {
			await mounted.event('[data-original-file]', 'onClick');
			const input = mounted.dom.one('[data-original-file]'); setFiles(input, file);
			await mounted.event('[data-original-file]', 'onChange', { currentTarget: input }); return input;
		},
	};
}
function setFiles(input: ReactTestElement, file: File | null) {
	Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] }); input.value = 'fake-picker-value';
}

test('inspection is explicit, page replacement never scans ahead, and unsupported/verified rows cannot restore', async () => {
	const calls: (string | null | undefined)[] = [];
	const mounted = await mount(props({ onInspect: async cursor => { calls.push(cursor); } }));
	try {
		assert.equal(calls.length, 0); assert.equal(mounted.dom.container.querySelectorAll('[data-original-row]').length, 4);
		assert.match(mounted.dom.container.textContent, /Library could not open: Retained original is absent/u);
		assert.match(mounted.dom.container.textContent, /4 originals on this page/u);
		assert.equal(reactProps(mounted.dom.one('[data-original-target="2"]')).disabled, true);
		assert.equal(reactProps(mounted.dom.one('[data-original-target="3"]')).disabled, true);
		await mounted.select(2); assert.equal(reactProps(mounted.dom.one('[data-original-file]')).disabled, true);
		await mounted.click('[data-original-next]'); assert.deepEqual(calls, ['private-cursor']);
		await mounted.click('[data-original-inspect]'); assert.deepEqual(calls, ['private-cursor', null]);
		assert.doesNotMatch(mounted.dom.container.textContent, /private-catalog|private-photo|private-asset|private-cursor/u);
		assert.equal(mounted.dom.find('original'), null);
	} finally { await mounted.dispose(); }
});

test('selected File is snapshotted and immediately rearmed; exact target and same-file retry survive failed restoration', async () => {
	const file = new File([new Uint8Array([1, 2, 3])], 'a different name.raw'); let bodyReads = 0;
	Object.defineProperty(file, 'arrayBuffer', { value: () => { bodyReads++; throw new Error('UI must not read bytes'); } });
	const calls: { target: PhotoLibraryOriginalRestoreTargetV1; file: File }[] = [];
	const mounted = await mount(props({ onRestore: (selected, original) => { calls.push({ target: selected, file: original }); return Promise.reject(new Error('Wrong bytes')); } }));
	try {
		await mounted.select(0); const input = await mounted.choose(file); assert.equal(input.value, '');
		assert.match(mounted.dom.container.textContent, /a different name\.raw/u);
		await mounted.click('[data-original-restore]'); assert.deepEqual(calls[0], { target: target(page, 0), file });
		assert.equal(reactProps(mounted.dom.one('[data-original-restore]')).disabled, true);
		await mounted.choose(file); await mounted.click('[data-original-restore]');
		assert.equal(calls.length, 2); assert.equal(calls[1]?.file, file); assert.equal(bodyReads, 0);
	} finally { await mounted.dispose(); }
});

test('picker changes are fenced to selected row, exact page object and factory generation; every stale input still rearms', async () => {
	for (const change of ['selection', 'page', 'generation'] as const) {
		const initial = props(), mounted = await mount(initial); let writes = 0;
		try {
			await mounted.select(0); await mounted.click('[data-original-file]');
			const input = mounted.dom.one('[data-original-file]'), stale = reactProps(input).onChange;
			if (change === 'selection') await mounted.select(1);
			else await mounted.replace({ ...initial, onRestore: async () => { writes++; return receipt; },
				...(change === 'page' ? { page: { ...page, revision: 9 } } : { generation: {} }) });
			setFiles(input, new File(['bad'], 'obsolete.png'));
			await act(async () => { stale?.({ currentTarget: input }); });
			assert.equal(input.value, ''); assert.equal(reactProps(mounted.dom.one('[data-original-restore]')).disabled, true);
			await mounted.click('[data-original-restore]'); assert.equal(writes, 0);
			assert.doesNotMatch(mounted.dom.container.textContent, /obsolete\.png/u);
		} finally { await mounted.dispose(); }
	}
});

test('native picker cancellation clears its captured target without accepting a later unsolicited change', async () => {
	const mounted = await mount(props());
	try {
		await mounted.select(0); await mounted.click('[data-original-file]'); await mounted.cancelPicker();
		const input = mounted.dom.one('[data-original-file]'); setFiles(input, new File(['bad'], 'cancelled.png'));
		await mounted.event('[data-original-file]', 'onChange', { currentTarget: input });
		assert.equal(input.value, ''); assert.equal(reactProps(mounted.dom.one('[data-original-restore]')).disabled, true);
		const valid = await mounted.choose(new File(['abc'], 'retry.png')); assert.equal(valid.value, '');
		assert.equal(reactProps(mounted.dom.one('[data-original-restore]')).disabled, false);
	} finally { await mounted.dispose(); }
});

test('one held restore blocks navigation, repeated writes and file changes; Close leaves task running and explicit Cancel signals owner', async () => {
	const held = deferred<PhotoLibraryOriginalRestorationReceiptV1 | null>(); let writes = 0, closes = 0, cancels = 0, scans = 0;
	const initial = props({ onRestore: () => { writes++; return held.promise; }, onClose: () => { closes++; },
		onCancel: () => { cancels++; }, onInspect: async () => { scans++; } });
	const mounted = await mount(initial);
	try {
		await mounted.select(0); await mounted.choose(new File(['abc'], 'original.png'));
		const restore = reactProps(mounted.dom.one('[data-original-restore]')).onClick;
		await mounted.click('[data-original-restore]'); await act(async () => { restore?.({}); }); assert.equal(writes, 1);
		await mounted.click('[data-original-next]'); await mounted.click('[data-original-inspect]'); await mounted.select(1); assert.equal(scans, 0);
		await mounted.replace({ ...initial, busy: true, active: true }); await mounted.click('[data-original-cancel]'); assert.equal(cancels, 1);
		await mounted.click('[data-original-close]'); assert.equal(closes, 1); assert.equal(cancels, 1);
		await act(async () => { restore?.({}); held.resolve(receipt); }); assert.equal(writes, 1);
		assert.doesNotMatch(mounted.dom.container.textContent, /Original restored/u);
	} finally { held.resolve(receipt); await mounted.dispose(); }
});

test('page or generation replacement clears picked Files and late restore completions cannot supply a stale receipt', async () => {
	const held = deferred<PhotoLibraryOriginalRestorationReceiptV1 | null>(); const initial = props({ onRestore: () => held.promise });
	const mounted = await mount(initial);
	try {
		await mounted.select(0); await mounted.choose(new File(['abc'], 'retired.png')); await mounted.click('[data-original-restore]');
		await mounted.replace({ ...initial, generation: {}, page: { ...page, rows: [row(7)] } });
		assert.doesNotMatch(mounted.dom.container.textContent, /retired\.png/u);
		await act(async () => { held.resolve(receipt); }); assert.doesNotMatch(mounted.dom.container.textContent, /Original restored/u);
		assert.equal(reactProps(mounted.dom.one('[data-original-file]')).disabled, true);
	} finally { held.resolve(receipt); await mounted.dispose(); }
});

test('durable restoration, cleanup warning and later readiness failure remain separate scalar statuses', async () => {
	const mounted = await mount(props({ receipt: { ...receipt, notices: ['cleanup-failed'] }, notice: 'refresh-failed', error: 'Catalog recovery remains blocked' }));
	try {
		assert.match(mounted.dom.one('[data-original-receipt]').textContent, /Original restored/u);
		assert.match(mounted.dom.container.textContent, /Temporary cleanup failed/u);
		assert.match(mounted.dom.container.textContent, /library readiness retry failed/u);
		assert.match(mounted.dom.one('[role="alert"]').textContent, /Catalog recovery remains blocked/u);
		assert.doesNotMatch(mounted.dom.container.textContent, /private-photo|private-asset|aaaaaaaa/u);
		await mounted.replace(props({ page: { ...page, rows: [], cursor: null }, cancelled: true }));
		assert.match(mounted.dom.container.textContent, /No originals on this page/u); assert.match(mounted.dom.container.textContent, /Cancelled/u);
		assert.equal(reactProps(mounted.dom.one('[data-original-next]')).disabled, true);
	} finally { await mounted.dispose(); }
});

test('busy props and stale retained event handlers cannot begin new inspection or restoration', async () => {
	let scans = 0, writes = 0;
	const initial = props({ onInspect: async () => { scans++; }, onRestore: async () => { writes++; return receipt; } });
	const mounted = await mount(initial);
	try {
		await mounted.select(0); await mounted.choose(new File(['abc'], 'original.png'));
		const reload = reactProps(mounted.dom.one('[data-original-inspect]')).onClick, restore = reactProps(mounted.dom.one('[data-original-restore]')).onClick;
		await mounted.replace({ ...initial, busy: true });
		await act(async () => { reload?.({}); restore?.({}); }); assert.equal(scans, 0); assert.equal(writes, 0);
	} finally { await mounted.dispose(); }
});

test('a page beyond 64 rows fails closed instead of silently admitting an unbounded restore selector', async () => {
	const mounted = await mount(props({ page: { ...page, rows: Array.from({ length: 65 }, (_, index) => row(index)) } }));
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-original-row]').length, 0);
		assert.match(mounted.dom.one('[role="alert"]').textContent, /Unsupported/u);
		assert.equal(reactProps(mounted.dom.one('[data-original-file]')).disabled, true);
	} finally { await mounted.dispose(); }
});

test('retained Cancel from a retired factory cannot cancel a replacement operation', async () => {
	let cancellations = 0;
	const initial = props({ active: true, busy: true, onCancel: () => { cancellations++; } }), mounted = await mount(initial);
	try {
		const oldCancel = reactProps(mounted.dom.one('[data-original-cancel]')).onClick;
		await mounted.replace({ ...initial, generation: {} });
		await act(async () => { oldCancel?.({}); }); assert.equal(cancellations, 0);
		await mounted.click('[data-original-cancel]'); assert.equal(cancellations, 1);
	} finally { await mounted.dispose(); }
});

test('a held explicit inspection prevents overlapping reads or restore attempts without recursively following its cursor', async () => {
	const held = deferred<void>(); let scans = 0;
	const mounted = await mount(props({ onInspect: () => { scans++; return held.promise; } }));
	try {
		await mounted.select(0); await mounted.choose(new File(['abc'], 'discarded-by-reload.png'));
		await mounted.click('[data-original-inspect]'); await mounted.click('[data-original-next]');
		assert.equal(scans, 1); assert.doesNotMatch(mounted.dom.container.textContent, /discarded-by-reload/u);
		assert.equal(reactProps(mounted.dom.one('[data-original-file]')).disabled, true);
		await act(async () => { held.resolve(); }); assert.equal(scans, 1);
		assert.equal(reactProps(mounted.dom.one('[data-original-inspect]')).disabled, false);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('Close registered inside a synchronous Restore callback releases the local File without cancelling or republishing late failures', async () => {
	const held = deferred<PhotoLibraryOriginalRestorationReceiptV1 | null>(); let closes = 0, cancels = 0;
	const mounted: Awaited<ReturnType<typeof mount>> = await mount(props({ onClose: () => { closes++; }, onCancel: () => { cancels++; },
		onRestore: () => { reactProps(mounted.dom.one('[data-original-close]')).onClick?.({}); return held.promise; } }));
	try {
		await mounted.select(0); await mounted.choose(new File(['abc'], 'released.png')); await mounted.click('[data-original-restore]');
		assert.equal(closes, 1); assert.equal(cancels, 0); assert.equal(mounted.dom.find('[role="dialog"]'), null);
		await act(async () => { held.reject(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('Do not inspect'); } })); });
		assert.equal(mounted.dom.find('[role="alert"]'), null);
	} finally { held.resolve(null); await mounted.dispose(); }
});
