/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import type { CreatePhotoLibrarySessionV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryOriginalInspectionPageV1, PhotoLibraryOriginalRestorationReceiptV1 } from '../src/common/editor/photo-library-original-recovery-port-v1.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';
import { reactProps } from './helpers/react-test-dom.ts';

const binding = Object.freeze({ catalogId: 'catalog-1', importId: null, photoId: 'photo-1', assetId: 'asset-1',
	sourceId: 'original-1', sha256: 'a'.repeat(64), size: 3, name: 'source.jpg', mimeType: 'image/jpeg' });
const inspected: PhotoLibraryOriginalInspectionPageV1 = Object.freeze({ schemaVersion: 1, catalogId: 'catalog-1',
	catalogName: 'Library', revision: 4, activeImportId: null, startupFailure: { message: 'Missing original.' },
	rows: Object.freeze([{ photoId: 'photo-1', revision: 2, fileName: 'Authored name.jpg', binding,
		inspection: { status: 'missing' as const, reason: 'media-row' as const } }]), scanned: 1, cursor: 'next-64' });
const restored: PhotoLibraryOriginalRestorationReceiptV1 = Object.freeze({ photoId: binding.photoId,
	assetId: binding.assetId, sha256: binding.sha256, size: binding.size, notices: Object.freeze(['cleanup-failed' as const]) });

async function mount(initial: CreatePhotoLibrarySessionV1, locale = 'en') {
	let factory = initial;
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperApp locale={locale} createSession={factory} />;
	});
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	const menu = async () => {
		const button = mounted.dom.one('[data-photo-original-recovery-menu]');
		await flush(() => { reactProps(button).onClick?.({ currentTarget: button }); });
	};
	await flush();
	return { ...mounted, menu, flush,
		replace: async (next: CreatePhotoLibrarySessionV1) => { factory = next; await mounted.render(); await flush(); } };
}

for (const locale of ['en', 'de']) {
	test(`${locale}: File alone admits original inspection and each next page needs an explicit demand`, async () => {
		const port = createImportTestPort(), cursors: Array<string | null | undefined> = []; let opens = 0;
		port.inspectOriginals = async options => { cursors.push(options?.cursor); return inspected; };
		const mounted = await mount(async () => { opens++; return port; }, locale), copy = bundledLightscaperEditorCopyForLocale(locale);
		try {
			assert.equal(opens, 0); assert.equal(mounted.dom.find('[data-photo-original-recovery-dialog]'), null);
			assert.equal(mounted.dom.one('[data-photo-original-recovery-menu]').textContent, copy.photoOriginalRecoveryTitle);
			assert.equal(mounted.dom.one('[data-photo-original-recovery-menu]').closest('details')?.querySelector('summary')?.textContent, copy.photoFileMenu);
			await mounted.menu(); assert.equal(opens, 1); assert.deepEqual(cursors, [null]);
			assert.ok(mounted.dom.find('[data-photo-original-recovery-dialog]')); assert.equal(mounted.dom.find('[data-photo-library]'), null);
			await mounted.flush(); assert.deepEqual(cursors, [null], 'a continuation does not start a background scan');
			await mounted.event('[data-original-next]', 'onClick'); await mounted.flush(); assert.deepEqual(cursors, [null, 'next-64']);
		} finally { await mounted.dispose(); }
	});
}

test('failed ordinary library loading leaves the File recovery action reachable and borrows the failed session', async () => {
	const port = createImportTestPort(); let opens = 0;
	port.readPage = async () => { throw new Error('Missing original blocked recovery.'); };
	port.inspectOriginals = async () => inspected;
	const mounted = await mount(async () => { opens++; return port; });
	try {
		const show = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === 'Show photo library'); assert.ok(show);
		await mounted.flush(() => { reactProps(show).onClick?.({ currentTarget: show }); });
		assert.match(mounted.dom.one('[role="alert"]').textContent, /blocked recovery/);
		assert.equal(reactProps(mounted.dom.one('[data-photo-original-recovery-menu]')).disabled, false);
		await mounted.menu(); assert.equal(opens, 1); assert.ok(mounted.dom.find('[data-original-row]'));
		assert.match(mounted.dom.one('[data-photo-original-recovery-dialog]').textContent, /Missing original/);
	} finally { await mounted.dispose(); }
});

test('Close and reopen leave one held inspection running; explicit Cancel joins before accepting another demand', async () => {
	const held = deferred<PhotoLibraryOriginalInspectionPageV1>(), port = createImportTestPort(); let calls = 0, signal: AbortSignal | undefined;
	port.inspectOriginals = async options => { calls++; signal = options?.signal; return held.promise; };
	const mounted = await mount(async () => port);
	try {
		await mounted.menu(); assert.equal(calls, 1); assert.equal(signal?.aborted, false);
		await mounted.event('[data-original-close]', 'onClick'); await mounted.flush();
		assert.equal(mounted.dom.find('[data-photo-original-recovery-dialog]'), null); assert.equal(signal?.aborted, false);
		await mounted.menu(); assert.equal(calls, 1); assert.equal(reactProps(mounted.dom.one('[data-original-inspect]')).disabled, true);
		await mounted.event('[data-original-cancel]', 'onClick'); assert.equal(signal?.aborted, true);
		await mounted.event('[data-original-inspect]', 'onClick'); assert.equal(calls, 1);
		await mounted.flush(() => { held.resolve(inspected); });
		assert.equal(mounted.dom.find('[data-original-row]'), null);
		assert.match(mounted.dom.one('[data-photo-original-recovery-dialog]').textContent, /operation was cancelled/);
		assert.equal(reactProps(mounted.dom.one('[data-original-inspect]')).disabled, false);
	} finally { held.resolve(inspected); await mounted.flush(); await mounted.dispose(); }
});

test('held exact restoration survives Close and reports its durable receipt separately from cleanup and failed reopen', async () => {
	const held = deferred<PhotoLibraryOriginalRestorationReceiptV1>(), port = createImportTestPort(); let restores = 0, signal: AbortSignal | undefined;
	port.inspectOriginals = async () => inspected;
	port.restoreOriginalBody = async (target, file, options) => { restores++; signal = options?.signal;
		assert.equal(target.catalogRevision, inspected.revision); assert.equal(target.photoRevision, inspected.rows[0]?.revision);
		assert.deepEqual(target.binding, binding); assert.equal(file.size, 3); return held.promise; };
	port.readPage = async () => { throw new Error('Another original still blocks startup.'); };
	const mounted = await mount(async () => port);
	try {
		await mounted.menu(); await mounted.event('[data-original-target="0"]', 'onChange');
		const input = mounted.dom.one('[data-original-file]');
		await mounted.event('[data-original-file]', 'onClick');
		input.value = 'picked'; Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], 'renamed-source.jpg')] });
		await mounted.event('[data-original-file]', 'onChange', { currentTarget: input }); assert.equal(input.value, '');
		await mounted.event('[data-original-restore]', 'onClick'); await mounted.flush(); assert.equal(restores, 1);
		await mounted.event('[data-original-close]', 'onClick'); assert.equal(signal?.aborted, false);
		await mounted.menu(); assert.equal(restores, 1); assert.equal(reactProps(mounted.dom.one('[data-original-restore]')).disabled, true);
		await mounted.flush(() => { held.resolve(restored); });
		assert.match(mounted.dom.one('[data-original-receipt]').textContent, /Original restored/);
		assert.match(mounted.dom.one('[data-original-receipt]').textContent, /temporary cleanup/);
		assert.match(mounted.dom.one('[data-photo-original-recovery-dialog]').textContent, /library could not be reopened/);
		assert.equal(mounted.dom.find('[data-original-selected-file]'), null);
	} finally { held.resolve(restored); await mounted.flush(); await mounted.dispose(); }
});

test('the File recovery menu can reopen its acknowledged repair while ordinary library recovery is held', async () => {
	const held = deferred<void>(), port = createImportTestPort(); port.inspectOriginals = async () => inspected;
	port.restoreOriginalBody = async () => restored;
	port.readPage = async () => { await held.promise; return { catalogName: 'Library', totalCount: 1, rows: [], cursor: null }; };
	const mounted = await mount(async () => port);
	try {
		await mounted.menu(); await mounted.event('[data-original-target="0"]', 'onChange');
		await mounted.event('[data-original-file]', 'onClick');
		const input = mounted.dom.one('[data-original-file]');
		Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], 'source.jpg')] });
		await mounted.event('[data-original-file]', 'onChange', { currentTarget: input });
		await mounted.event('[data-original-restore]', 'onClick'); await mounted.flush();
		assert.ok(mounted.dom.find('[data-original-receipt]'));
		await mounted.event('[data-original-close]', 'onClick'); await mounted.flush();
		assert.equal(reactProps(mounted.dom.one('[data-photo-original-recovery-menu]')).disabled, false);
		await mounted.menu(); assert.ok(mounted.dom.find('[data-original-receipt]'));
		assert.ok(mounted.dom.find('[data-original-cancel]'));
		await mounted.flush(() => { held.resolve(); });
	} finally { held.resolve(); await mounted.flush(); await mounted.dispose(); }
});
