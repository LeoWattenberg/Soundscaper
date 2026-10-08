/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import type { PhotoCatalogBackupDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoCatalogBackupDialog.tsx';
import type { PhotoLibraryBackupSaveReceiptV1 } from '../src/common/editor/controller/shared/photo-library-backup-save-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: PhotoCatalogBackupDialog } = await import('../src/common/editor/ui/lightscaper/PhotoCatalogBackupDialog.tsx');
hooks.deregister();
const copy = bundledLightscaperEditorCopyForLocale('en');
const saved: PhotoLibraryBackupSaveReceiptV1 = Object.freeze({ status: 'saved', catalogId: 'hidden-catalog', catalogName: 'Library',
	fileName: '<original & backup>.liscape', photoCount: 3, byteLength: 1234, method: 'file-system-access', notices: Object.freeze([]) });
function props(overrides: Partial<PhotoCatalogBackupDialogPropsV1> = {}): PhotoCatalogBackupDialogPropsV1 {
	return { locale: 'en', copy, ready: true, maximumStreamingBytes: 1024, busy: false, error: null, receipt: null,
		onSave: async () => saved, onClose: () => undefined, ...overrides };
}
async function mount(initial: PhotoCatalogBackupDialogPropsV1) {
	let current = initial; const mounted = await mountPhotoImportUi(() => <PhotoCatalogBackupDialog {...current} />);
	return { ...mounted, async replace(next: PhotoCatalogBackupDialogPropsV1) { current = next; await mounted.render(); },
		click(selector: string) { return mounted.event(selector, 'onClick'); } };
}

test('preloading disables Save without work and readiness focuses the enabled Save after a held load', async () => {
	let calls = 0; const initial = props({ ready: false, maximumStreamingBytes: null, onSave: async () => { calls++; return saved; } });
	const mounted = await mount(initial);
	try {
		assert.equal(calls, 0); assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, true);
		await mounted.click('[data-photo-backup-save]'); assert.equal(calls, 0);
		await mounted.replace({ ...initial, ready: true, maximumStreamingBytes: 1024 });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-photo-backup-save]'));
		assert.match(mounted.dom.container.textContent, /1,024 bytes/u);
		assert.match(mounted.dom.container.textContent, /536,870,912 bytes/u);
	} finally { await mounted.dispose(); }
});

test('Save calls its port in the click stack, refuses duplicate or later busy handlers, and Close never saves', async () => {
	const held = deferred<PhotoLibraryBackupSaveReceiptV1 | null>(); let calls = 0, closes = 0;
	const initial = props({ onSave: () => { calls++; return held.promise; }, onClose: () => { closes++; } });
	const mounted = await mount(initial);
	try {
		const save = reactProps(mounted.dom.one('[data-photo-backup-save]')).onClick;
		await act(async () => { save?.({}); assert.equal(calls, 1); save?.({}); });
		assert.equal(calls, 1);
		await mounted.replace({ ...initial, busy: true }); await act(async () => { save?.({}); }); assert.equal(calls, 1);
		await mounted.click('[data-photo-backup-close]'); assert.equal(closes, 1);
		await act(async () => { save?.({}); held.resolve(saved); }); assert.equal(calls, 1);
	} finally { held.resolve(saved); await mounted.dispose(); }
});

test('download-started and saved are distinct scalar statuses; arbitrary filenames remain escaped text', async () => {
	const mounted = await mount(props({ receipt: saved }));
	try {
		assert.match(mounted.dom.one('[data-photo-backup-receipt]').textContent, /Backup saved: <original & backup>\.liscape/u);
		assert.equal(mounted.dom.find('original'), null); assert.doesNotMatch(mounted.dom.container.textContent, /hidden-catalog/u);
		assert.match(mounted.dom.container.textContent, /3 photos · 1,234 bytes/u);
		await mounted.replace(props({ receipt: { ...saved, status: 'download-started', method: 'download', notices: ['cleanup-failed'] } }));
		assert.match(mounted.dom.one('[data-photo-backup-receipt]').textContent, /Download started:/u);
		assert.doesNotMatch(mounted.dom.one('[data-photo-backup-receipt]').textContent, /Backup saved/u);
		assert.match(mounted.dom.container.textContent, /Check your browser’s downloads/u);
		assert.match(mounted.dom.container.textContent, /temporary cleanup/u);
	} finally { await mounted.dispose(); }
});

test('busy readiness retries initial focus after Save becomes available and preserves subsequent Close focus', async () => {
	const initial = props({ busy: true }), mounted = await mount(initial);
	try {
		assert.notEqual(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-photo-backup-save]'));
		await mounted.replace({ ...initial, busy: false }); assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-photo-backup-save]'));
		mounted.dom.one('[data-photo-backup-close]').focus(); await mounted.replace({ ...initial, busy: false, error: 'Retry refused' });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-photo-backup-close]'));
	} finally { await mounted.dispose(); }
});

test('a rejected Save shows localized fallback without inspecting a hostile error getter', async () => {
	let getters = 0;
	const failure = Object.defineProperty({}, 'message', { get: () => { getters++; throw new Error('Must not read'); } });
	const mounted = await mount(props({ onSave: () => Promise.reject(failure) }));
	try {
		await mounted.click('[data-photo-backup-save]');
		assert.equal(getters, 0); assert.equal(mounted.dom.one('[role="alert"]').textContent, copy.photoBackupFailed);
	} finally { await mounted.dispose(); }
});
