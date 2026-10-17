/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopPreview from '../src/common/editor/ui/lightscaper/PhotoDevelopPreview.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import type { PixelPreviewPresentationReaderV1 } from '../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts';

function valueOf(node: Parameters<typeof reactProps>[0]): unknown {
	return (reactProps(node) as unknown as Readonly<{ value: unknown }>).value;
}

async function fixture(locale = 'en', cleanupFailure?: Error) {
	let photoId = 'first', reads = 0, loads = 0;
	const held = deferred<Awaited<ReturnType<PixelPreviewPresentationReaderV1>>>();
	let readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return held.promise; };
	const loadProxy = async () => { loads++; throw Error('No body is expected.'); };
	const develop = defaultImageDevelopStateV1(), beforePresent = Promise.resolve(), retirees: (() => Promise<void>)[] = [];
	const registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreview photoId={photoId} develop={develop} locale={locale}
		messages={photoDevelopCopy(locale)} readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} />);
	// This DOM shim models successful/failed backing retirement only. Native
	// painting and screen composition are exercised by the browser workflow.
	const priorCanvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
	class CanvasRetirement {
		get width() { return 0; }
		set width(_value: number) { if (cleanupFailure) throw cleanupFailure; }
		get height() { return 0; }
		set height(_value: number) { if (cleanupFailure) throw cleanupFailure; }
	}
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: CanvasRetirement });
	await act(async () => { await settle(); });
	const mode = () => mounted.dom.one('select');
	const choose = async (value: string) => { await act(async () => { reactProps(mode()).onChange?.({ currentTarget: { value } }); }); };
	return { mounted, mode, choose, reads: () => reads, loads: () => loads,
		async replace() { photoId = 'second'; await mounted.render(); },
		async replaceReader() { readPreview = async () => { reads++; return { outcome: 'missing' }; }; await mounted.render(); },
		async release() { held.resolve({ outcome: 'missing' }); await act(async () => { await settle(); }); },
		async dispose() {
			held.resolve({ outcome: 'missing' });
			try { await mounted.dispose(); await Promise.allSettled(retirees.map(retire => retire())); }
			finally { if (priorCanvas) Object.defineProperty(globalThis, 'HTMLCanvasElement', priorCanvas); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement'); }
		} };
}

for (const locale of ['en', 'de']) test(`${locale}: split is an explicit preview choice; its divider stays absent from the default view`, async () => {
	const f = await fixture(locale);
	try {
		assert.equal(valueOf(f.mode()), 'compare');
		assert.equal(f.mounted.dom.find('input'), null);
		const split = f.mode().options.find(option => option.value === 'split'); assert.ok(split);
		assert.equal(split.textContent, locale === 'de' ? 'Geteilte Ansicht' : 'Split view');
		const before = f.mounted.dom.one('[data-photo-develop-before]'), after = f.mounted.dom.one('[data-photo-develop-after]');
		await f.choose('split');
		assert.equal(f.mounted.dom.one('input').getAttribute('aria-label'), locale === 'de' ? 'Trennlinie (%)' : 'Divider position (%)');
		assert.equal(f.mounted.dom.one('input').value, '50');
		assert.equal(f.mounted.dom.one('[data-photo-develop-before]'), before);
		assert.equal(f.mounted.dom.one('[data-photo-develop-after]'), after);
		await f.choose('after'); assert.equal(f.mounted.dom.find('input'), null);
		await f.choose('split'); assert.equal(f.mounted.dom.one('input').value, '50');
		assert.equal(f.reads(), 1); assert.equal(f.loads(), 0);
	} finally { await f.dispose(); }
});

test('the divider reaches both endpoints without another source read, runtime admission or canvas replacement', async () => {
	const f = await fixture();
	try {
		await f.choose('split');
		const canvases = f.mounted.dom.container.querySelectorAll('canvas'); assert.equal(canvases.length, 2);
		for (const value of ['0', '37', '100']) {
			await act(async () => { reactProps(f.mounted.dom.one('input')).onChange?.({ currentTarget: { value } }); });
			assert.equal(f.mounted.dom.one('input').value, value);
		}
		assert.deepEqual(f.mounted.dom.container.querySelectorAll('canvas'), canvases);
		assert.equal(f.reads(), 1); assert.equal(f.loads(), 0);
	} finally { await f.dispose(); }
});

test('retired split handlers cannot change a later view or replacement photo', async () => {
	const f = await fixture();
	try {
		await f.choose('split'); const oldDivider = reactProps(f.mounted.dom.one('input')).onChange!, oldMode = reactProps(f.mode()).onChange!;
		await f.choose('before');
		await act(async () => { oldDivider({ currentTarget: { value: '100' } }); });
		await f.choose('split'); assert.equal(f.mounted.dom.one('input').value, '50');
		await f.replace(); assert.equal(valueOf(f.mode()), 'compare');
		await act(async () => { oldMode({ currentTarget: { value: 'split' } }); oldDivider({ currentTarget: { value: '100' } }); });
		assert.equal(valueOf(f.mode()), 'compare'); assert.equal(f.mounted.dom.find('input'), null);
		assert.equal(f.reads(), 1);
	} finally { await f.dispose(); }
});

test('unsupported modes and nonfinite or out-of-range divider values do not change the rendered selection', async () => {
	const f = await fixture();
	try {
		await f.choose('unknown'); assert.equal(valueOf(f.mode()), 'compare');
		await f.choose('split');
		for (const value of ['-1', '101', 'NaN', 'Infinity', '']) {
			await act(async () => { reactProps(f.mounted.dom.one('input')).onChange?.({ currentTarget: { value } }); });
			assert.equal(f.mounted.dom.one('input').value, '50');
		}
	} finally { await f.dispose(); }
});

test('replacing a preview reader joins the old held read before another owner can borrow the same canvases', async () => {
	const f = await fixture();
	try {
		await f.choose('split'); const oldMode = reactProps(f.mode()).onChange!;
		await f.replaceReader(); await act(async () => { await settle(); });
		assert.equal(f.reads(), 1); assert.equal(valueOf(f.mode()), 'compare');
		await act(async () => { oldMode({ currentTarget: { value: 'split' } }); });
		assert.equal(valueOf(f.mode()), 'compare');
		await f.release(); assert.equal(f.reads(), 2);
	} finally { await f.dispose(); }
});

test('failed predecessor backing retirement refuses a replacement reader and shows only the stable preview failure', async () => {
	const failure = new Error('Private cleanup details.'), f = await fixture('en', failure);
	try {
		await f.replaceReader(); assert.equal(f.reads(), 1);
		await f.release(); assert.equal(f.reads(), 1);
		assert.equal(f.mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state'), 'failed');
		assert.equal(f.mounted.dom.one('[role="alert"]').textContent, photoDevelopCopy('en').previewFailed);
		assert.equal(f.mounted.dom.container.textContent.includes(failure.message), false);
	} finally { await f.dispose(); }
});
