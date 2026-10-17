/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryBatchRenamePlanV1, PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameUndoV1 } from '../src/common/editor/photo-library-batch-rename-port-v1.ts';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import { planPhotoBatchRenameV1 } from '../src/lightscaper/controller/photo-batch-rename-v1.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

// The actual App/dialog/workflow receive two scalar rows. No media/metadata port
// is admitted, and one held command is the largest fixture resource.
const selection = Object.freeze([
	Object.freeze({ photoId: 'a', expectedRevision: 1, fileName: '東京 e\u0301.PNG' }),
	Object.freeze({ photoId: 'b', expectedRevision: 3, fileName: 'Second.JPG' }),
]);
const snapshot = Object.freeze({ schemaVersion: 1 as const, catalogId: 'catalog', selection });
function page(names: readonly string[] = selection.map(item => item.fileName)): PhotoLibraryPageV1 {
	return { catalogName: 'Library', totalCount: 2, cursor: null, rows: selection.map((item, index) => ({
		id: item.photoId, fileName: names[index]!, width: 1, height: 1, rating: 0, flag: 'unflagged', colorLabel: 'none',
	})) };
}
function renamed(plan: PhotoLibraryBatchRenamePlanV1, partial = false): PhotoLibraryBatchRenameReceiptV1 {
	const items = plan.items.slice(0, partial ? 1 : 2);
	return { schemaVersion: 1, action: 'rename', completion: partial ? 'cancelled' : 'finished', message: null,
		items: items.map(item => ({ index: item.index, photoId: item.photoId, previousDisplayName: item.sourceFileName,
			fileName: item.fileName, revision: item.expectedRevision + 1, status: 'renamed', message: null })),
		undo: { schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId: plan.catalogId,
			items: items.map(item => ({ index: item.index, photoId: item.photoId, expectedRevision: item.expectedRevision + 1,
				fileName: item.fileName, previousDisplayName: item.sourceFileName })) } };
}
function owner() {
	const port = createImportTestPort(); let current = page(), opens = 0, captured: readonly string[] = [], written: PhotoLibraryBatchRenamePlanV1 | null = null;
	let restored: PhotoLibraryBatchRenameUndoV1 | null = null;
	port.readPage = async () => current;
	port.readBatchRenameSelection = async ids => { captured = ids; return snapshot; };
	port.planBatchRename = planPhotoBatchRenameV1;
	port.renamePhotos = async plan => { written = plan; const result = renamed(plan); current = page(result.items.map(item => item.fileName)); return result; };
	port.undoBatchRename = async undo => {
		restored = undo; current = page(undo.items.map(item => item.previousDisplayName));
		return { schemaVersion: 1, action: 'undo', completion: 'finished', message: null, undo: null,
			items: undo.items.map(item => ({ index: item.index, photoId: item.photoId, previousDisplayName: item.fileName,
				fileName: item.previousDisplayName, revision: item.expectedRevision + 1, status: 'restored', message: null })) };
	};
	return { port, factory: async () => { opens++; return port; }, opens: () => opens,
		captured: () => captured, written: () => written, restored: () => restored };
}

test('actual File Photo menu captures page-order selection and requires explicit preview/apply; undo uses its durable inverse', async () => {
	const session = owner(), mounted = await mount(session.factory);
	try {
		assert.equal(session.opens(), 0); assert.equal(mounted.dom.find('[data-batch-rename-preview]'), null);
		assert.equal(mounted.button('Rename selected photos').hasAttribute('disabled'), true);
		assert.equal(mounted.button('Rename selected photos').closest('details')?.querySelector('summary')?.textContent, 'Photo');
		assert.equal(mounted.button('Undo last batch rename').hasAttribute('disabled'), true);
		await mounted.menu('Show photo library'); await mounted.photo('b'); await mounted.photo('a', true);
		await mounted.menu('Rename selected photos'); assert.deepEqual(session.captured(), ['a', 'b']);
		assert.equal(session.written(), null); assert.equal(mounted.dom.find('[data-batch-rename-plan-row]'), null);
		await mounted.change('[data-batch-rename-template]', '{stem}-東京-{sequence}.{extension}');
		await mounted.change('[data-batch-rename-sequence-start]', '9', 9);
		await mounted.event('[data-batch-rename-form]', 'onSubmit', { preventDefault() {} });
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-plan-row]').length, 2);
		assert.match(mounted.dom.one('[data-batch-rename-plan-row]').textContent, /東京 é-東京-009\.PNG/u);
		assert.equal(session.written(), null); await mounted.event('[data-batch-rename-apply]', 'onClick'); await mounted.flush();
		assert.deepEqual(session.written()?.items.map(item => item.index), [0, 1]);
		await mounted.event('[data-batch-rename-close]', 'onClick'); await mounted.flush();
		assert.equal(mounted.dom.find('[data-batch-rename-preview]'), null);
		assert.match(mounted.dom.one('[data-photo-id="a"]').textContent, /東京 é-東京-009\.PNG/u);
		await mounted.menu('Undo last batch rename'); assert.deepEqual(session.restored()?.items.map(item => item.expectedRevision), [2, 4]);
		assert.match(mounted.dom.one('[data-photo-id="a"]').textContent, /東京 é\.PNG/u);
		assert.equal(mounted.button('Undo last batch rename').hasAttribute('disabled'), true);
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-status="restored"]').length, 2);
	} finally { await mounted.dispose(); }
});

test('actual Cancel joins the held writer and keeps partial durable results reviewable after closing the dialog', async () => {
	const session = owner(), held = deferred<void>(); let signal: AbortSignal | undefined;
	session.port.renamePhotos = async (plan, options) => { signal = options?.signal; await held.promise; return renamed(plan, true); };
	const mounted = await mount(session.factory);
	try {
		await mounted.menu('Show photo library'); await mounted.photo('a'); await mounted.photo('b', true);
		await mounted.menu('Rename selected photos'); await mounted.event('[data-batch-rename-form]', 'onSubmit', { preventDefault() {} });
		await mounted.event('[data-batch-rename-apply]', 'onClick'); await mounted.flush();
		await mounted.event('[data-batch-rename-cancel]', 'onClick'); assert.equal(signal?.aborted, true);
		assert.ok(mounted.dom.find('[data-batch-rename-preview]'), 'Cancel keeps the modal for truthful partial results');
		await mounted.flush(() => { held.resolve(); });
		assert.ok(mounted.dom.find('[data-batch-rename-completion="cancelled"]'));
		await mounted.event('[data-batch-rename-close]', 'onClick'); await mounted.flush();
		assert.equal(mounted.dom.find('[data-batch-rename-preview]'), null);
		assert.equal(mounted.dom.container.querySelectorAll('[data-batch-rename-status="renamed"]').length, 1);
		assert.match(mounted.dom.one('[data-batch-rename-results]').textContent, /Changes already saved remain in the library/u);
		assert.equal(mounted.button('Undo last batch rename').hasAttribute('disabled'), false);
	} finally { held.resolve(); await mounted.flush(); await mounted.dispose(); }
});

test('factory replacement dismisses the old dialog and fences its late receipt from the new generation', async () => {
	const first = owner(), second = owner(), held = deferred<void>(); let signal: AbortSignal | undefined;
	first.port.renamePhotos = async (plan, options) => { signal = options?.signal; await held.promise; return renamed(plan); };
	first.port.close = () => held.promise;
	const mounted = await mount(first.factory);
	try {
		await mounted.menu('Show photo library'); await mounted.photo('a'); await mounted.menu('Rename selected photos');
		await mounted.event('[data-batch-rename-form]', 'onSubmit', { preventDefault() {} }); await mounted.event('[data-batch-rename-apply]', 'onClick');
		await mounted.replace(second.factory); assert.equal(signal?.aborted, true);
		assert.equal(mounted.dom.find('[data-batch-rename-preview]'), null); assert.equal(second.opens(), 0);
		await mounted.flush(() => { held.resolve(); }); await mounted.menu('First page / refresh');
		await mounted.photo('b'); await mounted.menu('Rename selected photos');
		assert.ok(mounted.dom.find('[data-batch-rename-preview]')); assert.equal(mounted.dom.find('[data-batch-rename-results]'), null);
		assert.equal(mounted.button('Undo last batch rename').hasAttribute('disabled'), true);
	} finally { held.resolve(); await mounted.flush(); await mounted.dispose(); }
});

test('a delayed selection capture focuses its newly mounted recipe after the shell initial-focus frame has passed', async () => {
	const session = owner(), held = deferred<typeof snapshot>(); session.port.readBatchRenameSelection = () => held.promise;
	const mounted = await mount(session.factory), frames: FrameRequestCallback[] = [], previous = globalThis.requestAnimationFrame;
	const previousMatches = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'matches');
	globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
	Object.defineProperty(ReactTestElement.prototype, 'matches', { configurable: true, value(this: ReactTestElement, selector: string) {
		return selector === ':disabled' ? this.disabled || this.hasAttribute('disabled') : this.tagName === 'BUTTON';
	} });
	try {
		await mounted.menu('Show photo library'); await mounted.photo('a'); await mounted.menu('Rename selected photos');
		assert.equal(mounted.dom.find('[data-batch-rename-template]'), null); assert.ok(frames.length > 0);
		// The bounded test DOM does not implement native selector matching. Only
		// the loading shell's two enabled buttons participate in this first frame.
		await act(async () => { for (const callback of frames.splice(0)) callback(0); });
		await mounted.flush(() => { held.resolve(snapshot); });
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.one('[data-batch-rename-template]'));
		const padding = mounted.dom.one('[data-batch-rename-sequence-padding]'); padding.focus();
		await mounted.change('[data-batch-rename-template]', '{stem}-edit.{extension}');
		assert.equal(mounted.dom.container.ownerDocument.activeElement, padding, 'later draft renders preserve the established focus');
	} finally {
		held.resolve(snapshot); globalThis.requestAnimationFrame = previous;
		if (previousMatches) Object.defineProperty(ReactTestElement.prototype, 'matches', previousMatches);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'matches');
		await mounted.dispose();
	}
});

async function mount(initial: CreatePhotoLibrarySessionV1) {
	let factory = initial;
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: (_event: Event) => true });
		return <LightscaperApp locale="en" createSession={factory} />;
	});
	const flush = async (work: () => void = () => undefined) => { await act(async () => { work(); await settle(); }); };
	const button = (text: string): ReactTestElement => {
		const value = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === text);
		assert.ok(value, `Missing actual App action ${text}`); return value;
	};
	const click = async (target: ReactTestElement, toggle = false) => { await flush(() => {
		assert.equal(target.hasAttribute('disabled'), false); reactProps(target).onClick?.({ currentTarget: target, ctrlKey: toggle, metaKey: false, shiftKey: false });
	}); };
	await flush();
	return { ...mounted, button, flush, menu: async (name: string) => { await click(button(name)); },
		photo: async (id: string, toggle = false) => { await click(mounted.dom.one(`[data-photo-id="${id}"]`), toggle); },
		change: async (selector: string, value: string, valueAsNumber = Number(value)) => {
			await mounted.event(selector, 'onChange', { currentTarget: { value, valueAsNumber } });
		},
		replace: async (next: CreatePhotoLibrarySessionV1) => { factory = next; await mounted.render(); await flush(); },
	};
}
