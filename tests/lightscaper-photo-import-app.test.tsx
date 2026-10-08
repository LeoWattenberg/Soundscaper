/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { CreatePhotoLibrarySessionV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';

const file = new File(['retained exact original'], '東京 é original.PNG');
const imported = { index: 0, fileName: file.name, photoId: 'photo', status: 'imported' as const, reusedOriginal: false, message: null, hasMetadataNotices: false };

test('actual File menu keeps a refused draft open; retry acknowledges the original source and opens receipt review', async () => {
	const port = createImportTestPort(); let opens = 0, calls = 0, presetReads = 0;
	port.readImportPresets = async () => { presetReads++; return { revision: 0, presets: [] }; };
	port.importFiles = async (files, options) => { calls++; assert.equal(files[0], file); assert.equal(Object.hasOwn(options ?? {}, 'settings'), false);
		if (calls === 1) throw new Error('Catalog temporarily unavailable'); options?.onAcknowledged?.(imported); return [imported]; };
	const mounted = await mount(async () => { opens++; return port; });
	try {
		assert.equal(opens, 0); assert.equal(mounted.dom.find('[data-photo-import-form]'), null); assert.equal(mounted.dom.find('[data-photo-library]'), null);
		await mounted.menu('Import photos'); assert.equal(opens, 0); assert.equal(presetReads, 0); await mounted.select();
		await mounted.submit(); assert.ok(mounted.dom.find('[data-photo-import-form]')); assert.equal(mounted.dom.find('[data-photo-library]'), null);
		assert.match(mounted.dom.one('[role="alert"]').textContent, /Catalog temporarily unavailable/u);
		await mounted.submit(); assert.equal(calls, 2); assert.equal(opens, 1); assert.equal(presetReads, 0);
		assert.equal(mounted.dom.find('[data-photo-import-form]'), null); assert.match(mounted.dom.one('[data-photo-import-status="imported"]').textContent, /東京 é original\.PNG/u);
	} finally { await mounted.dispose(); }
});

test('actual menu preserves durable imported items after a legacy interruption and publishes its failed completion', async () => {
	const port = createImportTestPort();
	port.importFiles = async (_files, options) => { options?.onAcknowledged?.(imported); throw new Error('Promotion interrupted'); };
	const mounted = await mount(async () => port);
	try {
		await mounted.menu('Import photos'); await mounted.select(); await mounted.submit();
		assert.equal(mounted.dom.find('[data-photo-import-form]'), null);
		assert.ok(mounted.dom.find('[data-photo-import-completion="failed"]')); assert.ok(mounted.dom.find('[data-photo-import-status="imported"]'));
		assert.match(mounted.dom.one('[role="alert"]').textContent, /Promotion interrupted/u);
	} finally { await mounted.dispose(); }
});

test('Cancel aborts a held gesture; post-ack cancellation remains published without labeling it finished', async () => {
	const held = deferred<void>(), port = createImportTestPort(); let signal: AbortSignal | undefined;
	port.importFiles = async (_files, options) => { signal = options?.signal; options?.onAcknowledged?.(imported);
		await held.promise; signal?.throwIfAborted(); return [imported]; };
	const mounted = await mount(async () => port);
	try {
		await mounted.menu('Import photos'); await mounted.select(); await mounted.submit(); await mounted.event('[data-photo-import-cancel]', 'onClick');
		assert.equal(signal?.aborted, true); assert.equal(mounted.dom.find('[data-photo-import-form]'), null);
		await act(async () => { held.resolve(); await settle(); });
		assert.ok(mounted.dom.find('[data-photo-import-completion="cancelled"]')); assert.ok(mounted.dom.find('[data-photo-import-status="imported"]'));
	} finally { held.resolve(); await mounted.dispose(); }
});

test('factory replacement cancels the old form and a late acknowledgement cannot close a newly opened form or publish old receipts', async () => {
	const held = deferred<readonly typeof imported[]>(), port = createImportTestPort(), next = createImportTestPort(); let signal: AbortSignal | undefined;
	port.importFiles = async (_files, options) => { signal = options?.signal; const items = await held.promise; options?.onAcknowledged?.(imported); return items; };
	const mounted = await mount(async () => port);
	try {
		await mounted.menu('Import photos'); await mounted.select(); await mounted.submit();
		await mounted.replace(async () => next); assert.equal(signal?.aborted, true); assert.equal(mounted.dom.find('[data-photo-import-form]'), null);
		await mounted.menu('Import photos'); assert.ok(mounted.dom.find('[data-photo-import-form]'));
		await act(async () => { held.resolve([imported]); await settle(); });
		assert.ok(mounted.dom.find('[data-photo-import-form]')); assert.equal(mounted.dom.find('[data-photo-import-status="imported"]'), null);
		assert.equal(mounted.dom.find('[data-photo-import-completion]'), null); assert.equal(mounted.dom.find('[data-photo-library]'), null);
	} finally { held.resolve([imported]); await mounted.dispose(); }
});

async function mount(initial: CreatePhotoLibrarySessionV1) {
	let factory = initial;
	const render = () => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: (_event: Event) => true });
		return <LightscaperApp locale="en" createSession={factory} />;
	};
	const mounted = await mountPhotoImportUi(render);
	const flush = async () => { await act(async () => { await settle(); }); };
	await flush();
	return { ...mounted,
		async menu(label: string) {
			const button = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(button);
			await mounted.event('button', 'onFocus');
			const { reactProps } = await import('./helpers/react-test-dom.ts');
			await act(async () => { reactProps(button).onClick?.({ currentTarget: button }); await settle(); });
		},
		async select() { Reflect.set(mounted.dom.one('input'), 'files', [file]); await mounted.event('input', 'onChange'); },
		async submit() { await mounted.event('[data-photo-import-form]', 'onSubmit', { preventDefault() {} }); await flush(); },
		async replace(next: CreatePhotoLibrarySessionV1) { factory = next; await mounted.render(); await flush(); },
	};
}
