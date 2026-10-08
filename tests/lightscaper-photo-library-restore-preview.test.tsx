/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React, { act } from 'react';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

// Capture a held native Blob read in the real staging owner. Canvas geometry is
// a local scalar double; this test makes no browser paint qualification claim.
const nativeRead = Blob.prototype.arrayBuffer, entered = deferred<void>(), released = deferred<void>();
let heldBody: Blob | null = null, staged: ArrayBuffer | null = null;
Blob.prototype.arrayBuffer = async function () {
	const buffer = await Reflect.apply(nativeRead, this, []) as ArrayBuffer;
	if (this === heldBody) { staged = buffer; entered.resolve(); await released.promise; }
	return buffer;
};
let App: typeof import('../src/common/editor/ui/lightscaper/LightscaperApp.tsx').default;
try {
	await import('../src/common/editor/ui/lightscaper/use-photo-preview-presentation.ts');
	App = (await import('../src/common/editor/ui/lightscaper/LightscaperApp.tsx')).default;
} finally { Blob.prototype.arrayBuffer = nativeRead; }

test('actual menu retirement joins held pixel-body staging after the Session preview source read has settled', async () => {
	const dimensions = new WeakMap<object, { width: number; height: number }>();
	class Canvas {
		get width() { return dimensions.get(this)?.width ?? 0; }
		set width(value: number) { dimensions.set(this, { width: value, height: this.height }); }
		get height() { return dimensions.get(this)?.height ?? 0; }
		set height(value: number) { dimensions.set(this, { width: this.width, height: value }); }
	}
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: Canvas });
	const pixels = new Uint8Array([11, 29, 43, 255]); heldBody = new Blob([pixels]);
	const port = createImportTestPort(); let reads = 0, closes = 0, restores = 0;
	port.readPage = async () => ({ catalogName: 'Same ID', totalCount: 1, rows: [{ id: 'same-photo', fileName: 'Same.png', width: 1, height: 1,
		rating: 0, flag: 'unflagged', colorLabel: 'none' }], cursor: null });
	port.readPreview = async (photoId, tier) => { reads++; return { outcome: 'ready', cache: 'hit', notices: [], preview: {
		photoId, tier, descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
		byteLength: 4, outputSha256: createHash('sha256').update(pixels).digest('hex'), body: heldBody! } }; };
	port.close = async () => { closes++; };
	const factory = async () => port, loadRestoreRuntime = async () => ({ restoreArchive: async () => { restores++; return {
		catalogId: 'same-catalog', catalogName: 'Same ID', photoCount: 0, stackCount: 0, savedCollectionCount: 0,
		originalCount: 0, originalByteLength: 0, notices: [] }; }, close: async () => undefined });
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <App locale="en" createSession={factory} loadRestoreRuntime={loadRestoreRuntime} />;
	});
	const flush = async () => { await act(async () => { await settle(); }); };
	const menu = async (name: string) => { const node = [...mounted.dom.container.querySelectorAll('button')].find(button => button.textContent === name);
		assert.ok(node);
		await act(async () => { reactProps(node).onClick?.({ currentTarget: node }); await settle(); }); };
	try {
		await menu('Show photo library'); await menu('Show thumbnails'); await entered.promise;
		assert.equal(reads, 1); assert.ok(staged); assert.deepEqual([...new Uint8Array(staged)], [...pixels]);
		await menu('Restore catalog backup…');
		await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Same.liscape')] } });
		await mounted.event('[data-photo-restore-start]', 'onClick'); await flush();
		assert.equal(closes, 0); assert.equal(restores, 0); assert.equal(mounted.dom.find('canvas'), null);
		await act(async () => { released.resolve(); await settle(); }); await flush();
		assert.equal(closes, 1); assert.equal(restores, 1); assert.ok(mounted.dom.find('[data-photo-restore-receipt]'));
		assert.deepEqual([...new Uint8Array(staged)], [0, 0, 0, 0]);
	} finally {
		released.resolve(); await flush(); await mounted.dispose(); heldBody = null;
		if (previous) Object.defineProperty(globalThis, 'HTMLCanvasElement', previous); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement');
	}
});
