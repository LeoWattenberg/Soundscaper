/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopPreviewV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopPreviewV2.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import type { PixelPreviewPresentationReaderV1 } from '../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';
import PhotoDevelopWorkspaceV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceV2.tsx';
import { photoDevelopBrushMaskCopy } from '../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { currentDevelopFixture } from './helpers/lightscaper-current-develop-session-fixture.ts';
import type { ExecutePhotoDevelopV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';

/** Instrument only the native canvas boundary; CPU/LUT pixels remain owning
 * production output. This fixture makes no browser or native color claim. */
function canvasRetirement(painted?: number[][]) {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const;
	const prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	class Context {
		getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; }
		putImageData(image: { data: Uint8ClampedArray }) { painted?.push([...image.data]); }
	}
	class NativeGeometry {
		get width() { return 0; } set width(_value: number) {}
		get height() { return 0; } set height(_value: number) {}
		getContext() { return new Context(); }
	}
	class Image {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	}
	for (const [index, value] of [NativeGeometry, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return () => { for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } };
}
const BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const SHA = createHash('sha256').update(BODY).digest('hex');
function recipe() {
	return { ...defaultImageDevelopStateV2(), effects: [{ id: 'lut', type: 'cube-lut-profile-v1' as const, enabled: true, params: { lut: { storageKey: `lut-sha256:${SHA}`, sha256: SHA,
		byteLength: BODY.byteLength, size: 2, domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const } } }] };
}

for (const locale of ['en', 'de']) test(`${locale}: current preview modes/divider reuse two canvases and never request another body`, async () => {
	const restore = canvasRetirement(), held = deferred<Awaited<ReturnType<PixelPreviewPresentationReaderV1>>>(), retirees: (() => Promise<void>)[] = [];
	let reads = 0, loads = 0;
	const readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return held.promise; };
	const loadProxy = async () => { loads++; return createPhotoDevelopRenderRuntimeV2(); };
	const registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const develop = recipe(), beforePresent = Promise.resolve();
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewV2 photoId="photo" develop={develop} readPreview={readPreview} loadProxy={loadProxy}
		beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy(locale)} locale={locale} />);
	try {
		await act(async () => { await settle(); }); const canvases = mounted.dom.container.querySelectorAll('canvas'); assert.equal(canvases.length, 2);
		await mounted.event('select', 'onChange', { currentTarget: { value: 'split' } });
		for (const value of ['0', '37', '100']) { await mounted.event('input', 'onChange', { currentTarget: { value } }); assert.equal(mounted.dom.one('input').value, value); }
		assert.deepEqual(mounted.dom.container.querySelectorAll('canvas'), canvases); assert.equal(reads, 1); assert.equal(loads, 0);
		assert.equal(mounted.dom.one('input').getAttribute('aria-label'), photoDevelopCopy(locale).divider);
		await mounted.event('select', 'onChange', { currentTarget: { value: 'after' } }); assert.equal(mounted.dom.find('input'), null);
	} finally { held.resolve({ outcome: 'missing' }); await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); restore(); }
});

test('replacement owners join held reads, detach the recipe before waiting and fence retained handlers', async () => {
	const restore = canvasRetirement(), held = deferred<Awaited<ReturnType<PixelPreviewPresentationReaderV1>>>(), seen: boolean[] = [], calls: string[] = [];
	const retirees: (() => Promise<void>)[] = [];
	let develop: PhotoLibraryDevelopSettingsV2 = recipe(), photoId = 'first';
	let readPreview: PixelPreviewPresentationReaderV1 = async id => { calls.push(id); return held.promise; };
	const loadProxy = async () => { throw Error('Failed predecessor must prevent runtime acquisition'); }, beforePresent = Promise.resolve();
	const registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewV2 photoId={photoId} develop={develop} readPreview={readPreview} loadProxy={loadProxy}
		beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" />);
	try {
		await act(async () => { await settle(); }); await mounted.event('select', 'onChange', { currentTarget: { value: 'split' } });
		const oldMode = reactProps(mounted.dom.one('select')).onChange!, oldDivider = reactProps(mounted.dom.one('input')).onChange!;
		photoId = 'second'; const mutable = recipe(); develop = mutable;
		readPreview = async id => { calls.push(id); seen.push(mutable.effects[0]!.enabled); return { outcome: 'missing' }; };
		await mounted.render(); mutable.effects[0]!.enabled = false;
		await act(async () => { oldMode({ currentTarget: { value: 'split' } }); oldDivider({ currentTarget: { value: '100' } }); await settle(); });
		assert.deepEqual(calls, ['first']); assert.equal(mounted.dom.find('input'), null);
		held.resolve({ outcome: 'missing' }); await act(async () => { await settle(); }); assert.deepEqual(calls, ['first', 'second']); assert.deepEqual(seen, [false]);
	} finally { held.resolve({ outcome: 'missing' }); await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); restore(); }
});

test('StrictMode replay and unmount join the held generation before retirement completes', async () => {
	const restore = canvasRetirement(), held = deferred<Awaited<ReturnType<PixelPreviewPresentationReaderV1>>>(), retirees: (() => Promise<void>)[] = []; let reads = 0;
	const readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return held.promise; }, loadProxy = async () => createPhotoDevelopRenderRuntimeV2();
	const registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; }, develop = recipe(), beforePresent = Promise.resolve();
	const mounted = await mountPhotoImportUi(() => <StrictMode><PhotoDevelopPreviewV2 photoId="photo" develop={develop} readPreview={readPreview} loadProxy={loadProxy}
		beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" /></StrictMode>);
	try {
		await act(async () => { await settle(); }); assert.equal(reads, 1);
		const oldHandler = reactProps(mounted.dom.one('select')).onChange!; await mounted.dispose();
		const retiring = Promise.all(retirees.map(retire => retire())); assert.equal(await remainsPending(retiring), true);
		oldHandler({ currentTarget: { value: 'split' } }); held.resolve({ outcome: 'missing' }); await retiring; assert.equal(reads, 1);
	} finally { held.resolve({ outcome: 'missing' }); restore(); }
});

test('the UI detaches current LUT settings before its external predecessor barrier and renders owning pixels', async () => {
	const painted: number[][] = [], restore = canvasRetirement(painted), gate = deferred<void>(), retirees: (() => Promise<void>)[] = [];
	const mutable = recipe(); let actual = '', bodyBacking: Uint8Array | undefined;
	const runtime = createPhotoDevelopRenderRuntimeV2({ source: { async withBytes(ref, consume) {
		actual = ref.sha256; const bytes = BODY.slice(); bodyBacking = bytes; try { return await consume(bytes); } finally { bytes.fill(0); }
	} } });
	const pixels = new Uint8Array([64, 128, 192, 127]);
	const readPreview: PixelPreviewPresentationReaderV1 = async () => ({ outcome: 'ready', preview: { photoId: 'photo', tier: 'fit-screen',
		descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, byteLength: 4,
		outputSha256: createHash('sha256').update(pixels).digest('hex'), body: new Blob([pixels]) }, cache: 'hit', notices: [] });
	const loadProxy = async () => runtime, registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewV2 photoId="photo" develop={mutable} readPreview={readPreview} loadProxy={loadProxy}
		beforePresent={gate.promise} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" />);
	try {
		mutable.effects[0]!.enabled = false; gate.resolve(); await act(async () => { await settle(); });
		assert.equal(actual, SHA); assert.deepEqual(painted, [[64, 128, 192, 127], [137, 0, 0, 127]]);
		assert.ok(bodyBacking?.every(value => value === 0)); assert.equal(mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state'), 'ready');
		assert.equal(mounted.dom.container.querySelectorAll('svg').length, 2);
	} finally { gate.resolve(); await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); restore(); }
});

test('late LUT cleanup failure blocks a replacement UI owner and its retirement keeps the exact opaque evidence', async () => {
	const painted: number[][] = [], restore = canvasRetirement(painted), entered = deferred<void>(), release = deferred<void>(), retirees: (() => Promise<void>)[] = [];
	let traps = 0, reads = 0;
	const failure = new Proxy({}, { get() { traps++; throw Error('Failure reflected'); }, getPrototypeOf() { traps++; throw Error('Failure reflected'); } });
	const bytes = BODY.slice();
	const runtime = createPhotoDevelopRenderRuntimeV2({ source: { async withBytes(_ref, consume) { try { await consume(bytes); entered.resolve(); await release.promise; throw failure; } finally { bytes.fill(0); } } } });
	const sourcePixels = new Uint8Array([64, 128, 192, 127]);
	let readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return { outcome: 'ready', preview: { photoId: 'photo', tier: 'fit-screen',
		descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, byteLength: 4,
		outputSha256: createHash('sha256').update(sourcePixels).digest('hex'), body: new Blob([sourcePixels]) }, cache: 'hit', notices: [] }; };
	const develop = recipe(), loadProxy = async () => runtime, beforePresent = Promise.resolve();
	const registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewV2 photoId="photo" develop={develop} readPreview={readPreview} loadProxy={loadProxy}
		beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" />);
	try {
		await entered.promise; readPreview = async () => { reads++; return { outcome: 'missing' }; }; await mounted.render();
		const retiring = retirees[0]!(); const joined = retiring.then(() => assert.fail('Cleanup fulfilled'), (error: unknown) => { assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 2); assert.ok(error.errors.every((value: unknown) => Object.is(value, failure))); });
		assert.equal(await remainsPending(retiring), true); assert.equal(reads, 1); release.resolve(); await joined;
		await act(async () => { await settle(); }); assert.equal(reads, 1); assert.ok(bytes.every(byte => byte === 0));
		assert.equal(mounted.dom.one('[role="alert"]').textContent, photoDevelopCopy('en').previewFailed);
		assert.equal(mounted.dom.container.textContent.includes('Failure reflected'), false); assert.equal(traps, 0);
	} finally { release.resolve(); await mounted.dispose(); await Promise.allSettled(retirees.map(retire => retire())); restore(); }
});

test('mounted preview callbacks retain the actual props receiver without function metadata reads', async () => {
	const restore = canvasRetirement(), retirees: (() => Promise<void>)[] = [];
	let expected: Readonly<import('../src/common/editor/ui/lightscaper/PhotoDevelopPreviewV2.tsx').PhotoDevelopPreviewPropsV2> | undefined, calls = 0, traps = 0;
	const readPreview: PixelPreviewPresentationReaderV1 = new Proxy(async function (this: unknown) { assert.equal(this, expected); calls++; return { outcome: 'missing' as const }; },
		{ get() { traps++; throw Error('Callback metadata read'); } });
	const props = { photoId: 'photo', develop: recipe(), readPreview, loadProxy: async () => createPhotoDevelopRenderRuntimeV2(), beforePresent: Promise.resolve(),
		registerRetirement: (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; }, messages: photoDevelopCopy('en'), locale: 'en' };
	const mounted = await mountPhotoImportUi(() => { const element = React.createElement(PhotoDevelopPreviewV2, props); expected = element.props; return element; });
	try { await act(async () => { await settle(); }); assert.equal(calls, 1); assert.equal(traps, 0); assert.equal(mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state'), 'missing'); }
	finally { await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); restore(); }
});

test('suspended preview acquires no input and resumes the same unchanged recipe after a no-edit close', async () => {
	const painted: number[][] = [], restore = canvasRetirement(painted), retirees: (() => Promise<void>)[] = [];
	const source = new Uint8Array([64, 128, 192, 127]), develop = defaultImageDevelopStateV2(), beforePresent = Promise.resolve();
	let suspended = true, reads = 0, loads = 0;
	const readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return { outcome: 'ready', preview: { photoId: 'photo', tier: 'fit-screen',
		descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, byteLength: 4,
		outputSha256: createHash('sha256').update(source).digest('hex'), body: new Blob([source]) }, cache: 'hit', notices: [] }; };
	const loadProxy = async () => { loads++; return createPhotoDevelopRenderRuntimeV2(); };
	const registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewV2 {...{ suspended }} photoId="photo" develop={develop} readPreview={readPreview}
		loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" />);
	try {
		await act(async () => { await settle(); }); assert.equal(reads, 0); assert.equal(loads, 0); assert.deepEqual(painted, []);
		suspended = false; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(reads, 1); assert.equal(loads, 1); assert.deepEqual(painted, [[64, 128, 192, 127], [64, 128, 192, 127]]);
		suspended = true; await mounted.render(); await Promise.all(retirees.map(retire => retire()));
		await mounted.render(); await act(async () => { await settle(); }); assert.equal(reads, 1);
		suspended = false; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(reads, 2); assert.equal(loads, 2); assert.deepEqual(painted.slice(2), [[64, 128, 192, 127], [64, 128, 192, 127]]);
		assert.deepEqual([...source], [64, 128, 192, 127]); assert.equal(mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state'), 'ready');
	} finally { await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); restore(); }
});

test('suspending an actual brush render cancels and joins the held body scope before same-recipe resumption', async () => {
	const encoded = await withPreparedBrushMaskResourceV1({ width: 4, height: 1, alpha: new Uint8Array([255, 0, 255, 0]) }, view => ({ reference: view.reference, bytes: view.bytes.slice() }));
	const develop = normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }],
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: encoded.reference.storageKey }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' }], maskBindings: [{ effectId: 'tone', maskId: 'brush' }] });
	const painted: number[][] = [], restore = canvasRetirement(painted), entered = deferred<void>(), release = deferred<void>(), retirees: (() => Promise<void>)[] = [];
	const state: { signal?: AbortSignal; bodies: Uint8Array[] } = { bodies: [] }; let suspended = false, reads = 0, resources = 0;
	const pixels = new Uint8Array([255, 255, 255, 127, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
	const runtime = createPhotoDevelopRenderRuntimeV2({ maskSource: { async withBytes(reference, consume, options) {
		assert.equal(reference.storageKey, encoded.reference.storageKey); resources++; const bytes = encoded.bytes.slice(); state.bodies.push(bytes);
		try { const result = await consume(bytes); if (resources === 1) { state.signal = options?.signal; entered.resolve(); await release.promise; }
			options?.signal?.throwIfAborted(); return result;
		} finally { bytes.fill(0); }
	} } });
	const readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return { outcome: 'ready', preview: { photoId: 'photo', tier: 'fit-screen',
		descriptor: { schemaVersion: 1, width: 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, byteLength: 16,
		outputSha256: createHash('sha256').update(pixels).digest('hex'), body: new Blob([pixels]) }, cache: 'hit', notices: [] }; };
	const loadProxy = async () => runtime, beforePresent = Promise.resolve();
	const registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewV2 {...{ suspended }} photoId="photo" develop={develop} readPreview={readPreview}
		loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" />);
	try {
		await entered.promise; assert.deepEqual(painted, [[...pixels]], 'Before paints before the held After resource read.');
		suspended = true; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(state.signal?.aborted, true, 'Suspension must cancel the actual current resource scope.');
		const joined = Promise.all(retirees.map(retire => retire())); assert.equal(await remainsPending(joined), true);
		assert.equal(reads, 1); assert.equal(resources, 1); assert.deepEqual([...state.bodies[0]!], [...encoded.bytes]);
		release.resolve(); await joined; await act(async () => { await settle(); }); assert.deepEqual(painted, [[...pixels]], 'Cancelled After must not paint.'); assert.ok(state.bodies[0]!.every(value => value === 0));
		await mounted.render(); await act(async () => { await settle(); }); assert.equal(reads, 1);
		suspended = false; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(reads, 2); assert.equal(resources, 2); assert.deepEqual(painted.slice(1), [[...pixels], [188, 188, 188, 127, 255, 255, 255, 255, 188, 188, 188, 255, 255, 255, 255, 255]]);
		assert.ok(state.bodies.every(bytes => bytes.every(value => value === 0))); assert.deepEqual([...pixels], [255, 255, 255, 127, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
	} finally { release.resolve(); await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); restore(); }
});

test('Workspace joins its held preview owner before acquiring the opt-in brush capability', async () => {
	const restore = canvasRetirement(), fixture = await currentDevelopFixture(1), held = deferred<Awaited<ReturnType<PixelPreviewPresentationReaderV1>>>();
	const photo = fixture.photos[0]!; let acquisitions = 0, reads = 0;
	const execute: ExecutePhotoDevelopV2 = async (run, signal) => { assert.ok(signal); await run({ signal, isCurrent: () => true,
		acquire: async () => { acquisitions++; return fixture.develop; }, refresh: async () => undefined }); };
	const readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return held.promise; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 photoId={photo.id} label={photo.metadata.fileName} locale="en" generation={fixture}
		execute={execute} readPreview={readPreview} loadProxy={async () => createPhotoDevelopRenderRuntimeV2()} beforePresent={Promise.resolve()}
		registerRetirement={() => () => undefined} onClose={() => undefined} />);
	try {
		await act(async () => { await settle(); }); assert.equal(acquisitions, 1); assert.equal(reads, 1);
		const menu = mounted.dom.container.querySelectorAll('details').find(node => node.getAttribute('class')?.split(' ').includes('lightscaper-develop-settings-menu')); assert.ok(menu);
		const brush = menu.querySelectorAll('button').find(node => node.textContent === photoDevelopBrushMaskCopy('en').menu); assert.ok(brush);
		await act(async () => { reactProps(brush).onClick?.({}); await settle(); });
		assert.equal(acquisitions, 1, 'Brush acquisition must wait for the existing actual preview retirement.');
		held.resolve({ outcome: 'missing' }); await act(async () => { await settle(); }); assert.equal(acquisitions, 2);
	} finally { held.resolve({ outcome: 'missing' }); await mounted.dispose(); await fixture.close(); restore(); }
});
