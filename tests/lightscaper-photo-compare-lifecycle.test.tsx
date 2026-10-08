/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: LightscaperApp } = await import('../src/common/editor/ui/lightscaper/LightscaperApp.tsx');
after(() => { hooks.deregister(); });
const rows: readonly PhotoLibraryRowV1[] = ['a', 'b', 'c'].map(id => ({ id, fileName: `${id}.png`,
	width: 2, height: 3, rating: 0, flag: 'unflagged', colorLabel: 'none' }));

test('actual App joins its old preview and Session close before a replacement factory or body read', async () => {
	const firstRead = deferred<{ outcome: 'missing' }>(), oldClose = deferred<void>();
	const closeEntered = deferred<void>(), oldPort = createImportTestPort(), newPort = createImportTestPort();
	const reads: [string, string, string][] = [], writes: [string, string, number][] = [];
	let oldOpens = 0, newOpens = 0, activeReads = 0, maximumReads = 0, oldSignal: AbortSignal | undefined;
	oldPort.readPage = newPort.readPage = async () => ({ catalogName: 'Library', totalCount: rows.length, rows, cursor: null });
	oldPort.readPreview = async (id, tier, options) => {
		reads.push(['old', id, tier]); oldSignal = options?.signal;
		activeReads++; maximumReads = Math.max(maximumReads, activeReads);
		try { return await firstRead.promise; } finally { activeReads--; }
	};
	newPort.readPreview = async (id, tier) => {
		reads.push(['new', id, tier]); activeReads++; maximumReads = Math.max(maximumReads, activeReads);
		try { return await Promise.resolve({ outcome: 'missing' as const }); } finally { activeReads--; }
	};
	oldPort.close = async () => { closeEntered.resolve(); await firstRead.promise; await oldClose.promise; };
	for (const [label, port] of [['old', oldPort], ['new', newPort]] as const) port.setRating = async (id, rating) => {
		writes.push([label, id, rating]); const row = rows.find(value => value.id === id); assert.ok(row); return { ...row, rating };
	};
	const firstFactory: CreatePhotoLibrarySessionV1 = async () => { oldOpens++; return oldPort; };
	const nextFactory: CreatePhotoLibrarySessionV1 = async () => { newOpens++; return newPort; };
	const mounted = await mount(firstFactory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		await mounted.menu(mounted.copy.photoShowThumbnails);
		assert.deepEqual(reads, [['old', 'a', 'thumbnail']]);
		await mounted.click(mounted.dom.one('[data-photo-compare-menu]'));
		assert.equal(oldSignal?.aborted, true); assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 2);
		const pane = mounted.dom.one('[data-compare-side="candidate"]'), staleKey = reactProps(pane).onKeyDown;
		const staleRating = reactProps(mounted.dom.one('[data-compare-rating="candidate"]')).onChange;
		const invokeStale = () => {
			staleKey?.({ key: '5', currentTarget: pane, target: pane, preventDefault() {} });
			staleRating?.({ currentTarget: { value: '4' } });
		};
		await mounted.replace(nextFactory); await closeEntered.promise;
		assert.equal(mounted.dom.find('[data-photo-compare-dialog]'), null);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 0);
		await mounted.flush(invokeStale); await mounted.menu(mounted.copy.photoFirstPage);
		assert.equal(newOpens, 0); assert.deepEqual(writes, []); assert.equal(activeReads, 1);
		await mounted.flush(() => { firstRead.resolve({ outcome: 'missing' }); });
		assert.equal(activeReads, 0); assert.equal(newOpens, 0);
		assert.deepEqual(reads, [['old', 'a', 'thumbnail']], 'no queued Compare read may cross the retired source');
		await mounted.flush(() => { oldClose.resolve(); });
		assert.equal(oldOpens, 1); assert.equal(newOpens, 1); assert.equal(maximumReads, 1);
		assert.deepEqual(reads.slice(1), rows.map(row => ['new', row.id, 'thumbnail']));
		await mounted.photo('a'); await mounted.photo('b', true); await mounted.click(mounted.dom.one('[data-photo-compare-menu]'));
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 2);
		assert.deepEqual(reads.slice(-2), [['new', 'a', 'fit-screen'], ['new', 'b', 'fit-screen']]);
		await mounted.flush(invokeStale); assert.deepEqual(writes, []);
		await mounted.key('candidate', '3'); assert.deepEqual(writes, [['new', 'b', 3]]);
		assert.equal(newOpens, 1); assert.equal(maximumReads, 1);
	} finally {
		firstRead.resolve({ outcome: 'missing' }); oldClose.resolve(); await mounted.flush(); await mounted.dispose();
	}
});

async function mount(initialFactory: CreatePhotoLibrarySessionV1) {
	let factory = initialFactory;
	const previousCanvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
	// This protocol asserts scalar target ownership and zero-backing cleanup only.
	// Native browser qualification owns authentic pixel painting and memory claims.
	class ScalarCanvasBacking {}
	for (const name of ['width', 'height']) Object.defineProperty(ScalarCanvasBacking.prototype, name, {
		get(this: ReactTestElement) { assert.equal(this.nodeName, 'CANVAS'); return Number(this.getAttribute(name) ?? 0); },
		set(this: ReactTestElement, value: number) { assert.equal(this.nodeName, 'CANVAS'); assert.equal(value, 0); this.setAttribute(name, String(value)); },
	});
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: ScalarCanvasBacking });
	const restoreCanvas = () => {
		if (previousCanvas) Object.defineProperty(globalThis, 'HTMLCanvasElement', previousCanvas); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement');
	};
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <StrictMode><LightscaperApp locale="en" createSession={factory} /></StrictMode>;
	}).catch((error: unknown) => { restoreCanvas(); throw error; });
	const flush = async (work: () => void = () => undefined) => { await act(async () => { work(); await settle(); }); };
	const click = async (target: ReactTestElement, ctrlKey = false) => {
		assert.equal(target.hasAttribute('disabled'), false);
		await flush(() => { target.focus(); reactProps(target).onFocus?.({ currentTarget: target });
			reactProps(target).onClick?.({ currentTarget: target, ctrlKey, metaKey: false, shiftKey: false }); });
	};
	const menu = async (text: string) => {
		const button = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === text);
		assert.ok(button, `Missing action ${text}`); await click(button);
	};
	return { ...mounted, flush, click, menu, copy: bundledLightscaperEditorCopyForLocale('en'),
		photo: async (id: string, toggle = false) => { await click(mounted.dom.one(`[data-photo-id="${id}"]`), toggle); },
		key: async (side: string, key: string) => { await flush(() => {
			const target = mounted.dom.one(`[data-compare-side="${side}"]`); target.focus();
			reactProps(target).onKeyDown?.({ key, target, currentTarget: target, preventDefault() {} });
		}); },
		replace: async (next: CreatePhotoLibrarySessionV1) => { factory = next; await mounted.render(); },
		dispose: async () => { try { await mounted.dispose(); } finally { restoreCanvas(); } },
	};
}
