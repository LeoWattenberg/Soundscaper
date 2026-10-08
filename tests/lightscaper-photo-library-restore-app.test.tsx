/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import { lightscaperRestoreCopy } from '../src/common/i18n/lightscaper-restore-copy.ts';
import type { PhotoLibraryRestoreReceiptV1, PhotoLibraryRestoreRuntimeV1 } from '../src/common/editor/photo-library-restore-port-v1.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const receipt = (): PhotoLibraryRestoreReceiptV1 => ({ catalogId: 'catalog', catalogName: 'Same ID', photoCount: 0,
	stackCount: 0, savedCollectionCount: 0, originalCount: 0, originalByteLength: 0, notices: [] });
async function mount(loadRestoreRuntime: () => Promise<PhotoLibraryRestoreRuntimeV1>, locale = 'en', port = createImportTestPort()) {
	let opens = 0;
	const factory = async () => { opens++; return port; };
	const mounted = await mountPhotoImportUi(() => { Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperApp locale={locale} createSession={factory} loadRestoreRuntime={loadRestoreRuntime} />; });
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	await flush();
	const menu = async () => { const button = mounted.dom.one('[data-photo-restore-menu]'); await flush(() => { reactProps(button).onClick?.({ currentTarget: button }); }); };
	const select = async () => { await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Library.liscape')] } }); };
	return { ...mounted, flush, menu, select, opens: () => opens };
}

test('File-menu restore alone opts in from default-empty UI without opening a Session or backend', async () => {
	for (const locale of ['en', 'de']) {
		let loads = 0;
		const mounted = await mount(async () => { loads++; return { restoreArchive: async () => receipt(), close: async () => undefined }; }, locale);
		try {
			assert.equal(mounted.opens(), 0); assert.equal(loads, 0); assert.equal(mounted.dom.find('[data-photo-restore-dialog]'), null);
			const menu = mounted.dom.one('[data-photo-restore-menu]'); assert.equal(menu.textContent, lightscaperRestoreCopy(locale).title);
			assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Datei' : 'File');
			await mounted.menu(); assert.ok(mounted.dom.find('[data-photo-restore-dialog]')); assert.equal(loads, 0); assert.equal(mounted.opens(), 0);
			assert.equal(reactProps(mounted.dom.one('[data-photo-restore-start]')).disabled, true);
			await mounted.select(); assert.equal(reactProps(mounted.dom.one('[data-photo-restore-start]')).disabled, false);
		} finally { await mounted.dispose(); }
	}
});

test('Close hides a held restore without cancelling its stable owner; explicit Cancel joins and late ACK stays visible after epoch rotation', async () => {
	const held = deferred<PhotoLibraryRestoreReceiptV1>(); let signal: AbortSignal | undefined, restores = 0;
	const mounted = await mount(async () => ({ restoreArchive: async (_blob, options) => { restores++; signal = options?.signal; return held.promise; }, close: async () => undefined }));
	try {
		await mounted.menu(); await mounted.select(); await mounted.event('[data-photo-restore-start]', 'onClick'); await mounted.flush();
		assert.equal(restores, 1); assert.equal(mounted.opens(), 0);
		await mounted.event('[data-photo-restore-close]', 'onClick'); await mounted.flush();
		assert.equal(mounted.dom.find('[data-photo-restore-dialog]'), null); assert.equal(signal?.aborted, false);
		await mounted.menu(); assert.equal(reactProps(mounted.dom.one('[data-photo-restore-start]')).disabled, true);
		await mounted.event('[data-photo-restore-cancel]', 'onClick'); await mounted.flush(); assert.equal(signal?.aborted, true);
		await mounted.flush(() => { held.resolve(receipt()); });
		assert.ok(mounted.dom.find('[data-photo-restore-receipt]')); assert.equal(restores, 1); assert.equal(mounted.opens(), 0);
		assert.match(mounted.dom.one('[data-photo-restore-receipt]').textContent, /Same ID/u);
	} finally { held.resolve(receipt()); await mounted.flush(); await mounted.dispose(); }
});

test('an existing Session is closed before backend work and same-ID restore retires its page generation', async () => {
	const port = createImportTestPort(); let closes = 0, restores = 0;
	port.close = async () => { closes++; };
	const mounted = await mount(async () => ({ restoreArchive: async () => { assert.equal(closes, 1); restores++; return receipt(); }, close: async () => undefined }), 'en', port);
	try {
		const show = [...mounted.dom.container.querySelectorAll('button')].find(button => button.textContent === 'Show photo library'); assert.ok(show);
		await mounted.flush(() => { reactProps(show).onClick?.({ currentTarget: show }); }); assert.equal(mounted.opens(), 1);
		await mounted.menu(); await mounted.select(); await mounted.event('[data-photo-restore-start]', 'onClick'); await mounted.flush();
		assert.equal(restores, 1); assert.equal(closes, 1); assert.ok(mounted.dom.find('[data-photo-restore-receipt]'));
		assert.equal(mounted.dom.find('[data-photo-library]'), null);
	} finally { await mounted.dispose(); }
});

test('a damaged old Session factory is never initialized by the restore menu', async () => {
	let opens = 0, restores = 0;
	const mounted = await mountPhotoImportUi(() => { Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperApp locale="en" createSession={async () => { opens++; throw new Error('Damaged old library'); }}
			loadRestoreRuntime={async () => ({ restoreArchive: async () => { restores++; return receipt(); }, close: async () => undefined })} />; });
	try {
		await act(async () => { await settle(); });
		const menu = mounted.dom.one('[data-photo-restore-menu]'); await mounted.event('[data-photo-restore-menu]', 'onClick', { currentTarget: menu });
		await act(async () => { await settle(); }); await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Library.liscape')] } });
		await mounted.event('[data-photo-restore-start]', 'onClick'); await act(async () => { await settle(); });
		assert.equal(opens, 0); assert.equal(restores, 1); assert.ok(mounted.dom.find('[data-photo-restore-receipt]'));
	} finally { await mounted.dispose(); }
});

test('a retained idle Restore handler cannot admit a file after Close or after a replacement dialog completes', async () => {
	let loads = 0, restores = 0;
	const mounted = await mount(async () => { loads++; return { restoreArchive: async () => { restores++; return receipt(); }, close: async () => undefined }; });
	try {
		await mounted.menu(); await mounted.select();
		const stale = reactProps(mounted.dom.one('[data-photo-restore-start]')).onClick;
		await mounted.flush(() => { reactProps(mounted.dom.one('[data-photo-restore-close]')).onClick?.({}); stale?.({}); });
		assert.equal(mounted.dom.find('[data-photo-restore-dialog]'), null); assert.equal(loads, 0); assert.equal(restores, 0); assert.equal(mounted.opens(), 0);
		await mounted.menu(); await mounted.select(); await mounted.event('[data-photo-restore-start]', 'onClick'); await mounted.flush();
		assert.equal(restores, 1); assert.ok(mounted.dom.find('[data-photo-restore-receipt]'));
		await mounted.flush(() => { stale?.({}); }); assert.equal(restores, 1);
	} finally { await mounted.dispose(); }
});

test('retired pending Cancel and Close handlers cannot cancel or hide a later restore dialog', async () => {
	const first = deferred<PhotoLibraryRestoreReceiptV1>(), second = deferred<PhotoLibraryRestoreReceiptV1>(), signals: (AbortSignal | undefined)[] = [];
	const mounted = await mount(async () => ({ restoreArchive: async (_blob, options) => {
		signals.push(options?.signal); return signals.length === 1 ? first.promise : second.promise;
	}, close: async () => undefined }));
	try {
		await mounted.menu(); await mounted.select(); await mounted.event('[data-photo-restore-start]', 'onClick'); await mounted.flush();
		const oldCancel = reactProps(mounted.dom.one('[data-photo-restore-cancel]')).onClick;
		const oldClose = reactProps(mounted.dom.one('[data-photo-restore-close]')).onClick;
		await mounted.flush(() => { oldClose?.({}); }); assert.equal(signals[0]?.aborted, false);
		await mounted.menu(); await mounted.flush(() => { first.resolve(receipt()); });
		await mounted.select(); await mounted.event('[data-photo-restore-start]', 'onClick'); await mounted.flush(); assert.equal(signals.length, 2);
		await mounted.flush(() => { oldCancel?.({}); oldClose?.({}); });
		assert.equal(signals[1]?.aborted, false); assert.ok(mounted.dom.find('[data-photo-restore-dialog]'));
		await mounted.flush(() => { second.resolve(receipt()); }); assert.ok(mounted.dom.find('[data-photo-restore-receipt]'));
	} finally { first.resolve(receipt()); second.resolve(receipt()); await mounted.flush(); await mounted.dispose(); }
});
