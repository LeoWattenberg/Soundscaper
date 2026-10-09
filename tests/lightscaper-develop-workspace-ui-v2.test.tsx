/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspaceV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceV2.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';
import { normalizeCubeLutProfileParamsV1 } from '../src/common/editor/video-cube-lut-profile-v1.ts';
import type { PhotoLibraryCubeLutPortV1 } from '../src/common/editor/photo-library-cube-lut-port-v1.ts';
import { createHash } from 'node:crypto';
import { createPhotoMediaCubeLutResourcesV1 } from '../src/lightscaper/storage/photo-media-cube-lut-resources-v1.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';

function canvasBoundary(painted?: number[][]) {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(image: { data: Uint8ClampedArray }) { painted?.push([...image.data]); } }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return () => { for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } };
}

for (const locale of ['en', 'de']) test(`${locale}: opted-in current workspace promotes a null profile, saves mixed history/snapshots/copies and preserves originals`, async () => {
	const fixture = await currentDevelopFixture(1), before = (await fixture.repository.loadPhoto('catalog-1', fixture.photos[0]!.id))!, messages = photoDevelopCopy(locale);
	const execute: import('../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts').ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const mounted = await mountPhotoImportUi(() => <StrictMode><PhotoDevelopWorkspaceV2 locale={locale} photoId={before.id} label={before.metadata.fileName}
		generation={fixture} execute={execute} readPreview={async () => ({ outcome: 'missing' })} loadProxy={async () => { throw Error('No decoder for missing preview'); }}
		beforePresent={Promise.resolve()} registerRetirement={() => () => undefined} onClose={() => undefined} /></StrictMode>);
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const input = (label: string, kind: 'input' | 'select' = 'input') => { const found = mounted.dom.container.querySelectorAll(kind).find(value => value.parentNode?.textContent.startsWith(label)); assert.ok(found, label); return found; };
	const change = async (target: ReactTestElement, value: string) => { await act(async () => { reactProps(target).onChange?.({ currentTarget: { value } }); await settle(); }); };
	const click = async (target: ReactTestElement) => { await act(async () => { reactProps(target).onClick?.({}); await settle(); }); };
	try {
		await act(async () => { await settle(); }); await change(input(messages.choose, 'select'), 'cube-lut-profile-v1'); await click(button(messages.add)); await click(button(messages.save));
		await change(input(messages.snapshotName), 'Neutral profile'); await click(button(messages.saveSnapshot)); await change(input(messages.history, 'select'), '0');
		let photo = (await fixture.repository.loadPhoto('catalog-1', before.id))!; assert.equal(photo.schemaVersion, 2); assert.equal(photo.versions[0]!.develop.processVersion, 1);
		const restore = mounted.dom.container.querySelectorAll('button').find(value => value.getAttribute('aria-label') === `${messages.restoreSnapshot}: Neutral profile`); assert.ok(restore); await click(restore);
		await change(input(messages.copyName), 'Alternative'); await click(button(messages.createCopy));
		const read = await fixture.develop.read({ schemaVersion: 2, photoId: before.id }); assert.equal(read.develop.processVersion, 2); assert.equal(read.develop.effects[0]!.params.lut, null);
		assert.notEqual(read.versionId, before.activeVersionId); photo = (await fixture.repository.loadPhoto('catalog-1', before.id))!;
		assert.deepEqual(photo.original, before.original); assert.deepEqual(photo.extractedMetadata, before.extractedMetadata); assert.deepEqual(photo.metadata, before.metadata);
	} finally { await mounted.dispose(); await fixture.close(); }
});

test('current workspace imports through actual immutable custody, paints authenticated LUT pixels/histogram, and saves the ref without rewriting originals', async () => {
	const painted: number[][] = [], restoreCanvas = canvasBoundary(painted), fixture = await currentDevelopFixture(1), before = (await fixture.repository.loadPhoto('catalog-1', fixture.photos[0]!.id))!;
	const resources = createPhotoMediaCubeLutResourcesV1({ memory: getMemoryDatabase(`workspace-lut-${crypto.randomUUID()}`), database: async () => null }, run => run(), () => undefined);
	const runtime = createPhotoDevelopRenderRuntimeV2({ source: resources.resources.source }), pixels = new Uint8Array([64, 128, 192, 127]);
	const body = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`), sha = createHash('sha256').update(body).digest('hex');
	const readPreview: import('../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts').PixelPreviewPresentationReaderV1 = async () => ({ outcome: 'ready', cache: 'hit', notices: [],
		preview: { photoId: before.id, tier: 'fit-screen', descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
			byteLength: 4, outputSha256: createHash('sha256').update(pixels).digest('hex'), body: new Blob([pixels]) } });
	const execute: import('../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts').ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const messages = photoDevelopCopy('en'), demands: (() => Promise<void>)[] = [], loadProxy = async () => runtime, beforePresent = Promise.resolve();
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 locale="en" photoId={before.id} label="Photo" generation={fixture} execute={execute}
		readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={() => () => undefined}
		registerDemandRetirement={retire => { demands.push(retire); return () => undefined; }} onClose={() => undefined} importCubeLut={resources.resources.importFile} />);
	const button = (text: string) => { const value = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === text); assert.ok(value); return value; };
	try {
		await act(async () => { await settle(); }); const combo = mounted.dom.container.querySelectorAll('select').find(value => value.parentNode?.textContent.startsWith(messages.choose)); assert.ok(combo);
		await act(async () => { reactProps(combo).onChange?.({ currentTarget: { value: 'cube-lut-profile-v1' } }); }); await act(async () => { reactProps(button(messages.add)).onClick?.({}); await settle(); });
		const file = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === messages.shared.videoEffectCubeLutImport); assert.ok(file);
		await act(async () => { reactProps(file).onChange?.({ currentTarget: { files: [new File([body], 'profile.cube')], value: '' } }); await settle(); });
		assert.deepEqual(painted.slice(-2), [[64, 128, 192, 127], [137, 0, 0, 127]]); assert.equal(mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state'), 'ready');
		const lines = mounted.dom.container.querySelectorAll('polyline'); assert.equal(lines.length, 6); assert.equal(lines[3]!.getAttribute('points')!.split(' ')[137], '137,0');
		await act(async () => { reactProps(button(messages.save)).onClick?.({}); await settle(); });
		const after = (await fixture.repository.loadPhoto('catalog-1', before.id))!; assert.equal(after.schemaVersion, 2); assert.equal(after.versions[0]!.develop.processVersion, 2);
		const lut = normalizeCubeLutProfileParamsV1(after.versions[0]!.develop.effects[0]!.params).lut!; assert.equal(lut.sha256, sha);
		await resources.resources.verifyPhoto(after); await resources.resources.source.withBytes(lut, bytes => { assert.deepEqual([...bytes], [...body]); });
		assert.deepEqual(after.original, before.original); assert.deepEqual(after.extractedMetadata, before.extractedMetadata); assert.deepEqual(after.metadata, before.metadata); assert.deepEqual([...pixels], [64, 128, 192, 127]);
	} finally { await mounted.dispose(); await Promise.all(demands.map(retire => retire())); await fixture.close(); await resources.close(); restoreCanvas(); }
});

test('current Workspace Close joins a held cube importer and preview, fences old controls, and keeps originals untouched', async () => {
	const restoreCanvas = canvasBoundary();
	const fixture = await currentDevelopFixture(1), before = (await fixture.repository.loadPhoto('catalog-1', fixture.photos[0]!.id))!;
	const held = deferred<Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>>(), preview = deferred<Awaited<ReturnType<import('../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts').PixelPreviewPresentationReaderV1>>>();
	const demands: (() => Promise<void>)[] = []; let calls = 0, closeCalls = 0, aborted = false, expected: unknown;
	const execute: import('../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts').ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const messages = photoDevelopCopy('en'), beforePresent = Promise.resolve();
	const mounted = await mountPhotoImportUi(() => { const element = <PhotoDevelopWorkspaceV2 locale="en" photoId={before.id} label="Photo" generation={fixture}
		execute={execute} readPreview={async function (this: unknown) { assert.equal(this, expected); return preview.promise; }} loadProxy={async () => { throw Error('Held preview only'); }}
		beforePresent={beforePresent} registerRetirement={() => () => undefined} registerDemandRetirement={retire => { demands.push(retire); return () => undefined; }}
		importCubeLut={async function (this: unknown, _file, options) { assert.equal(this, expected); calls++; options!.signal!.addEventListener('abort', () => { aborted = true; }); return held.promise; }}
		onClose={() => { closeCalls++; }} />; expected = element.props; return element; });
	const button = (text: string) => { const value = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === text); assert.ok(value, text); return value; };
	try {
		await act(async () => { await settle(); }); const choose = mounted.dom.container.querySelectorAll('select').find(value => value.parentNode?.textContent.startsWith(messages.choose)); assert.ok(choose);
		await act(async () => { reactProps(choose).onChange?.({ currentTarget: { value: 'cube-lut-profile-v1' } }); });
		await act(async () => { reactProps(button(messages.add)).onClick?.({}); });
		const file = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === messages.shared.videoEffectCubeLutImport); assert.ok(file);
		const oldSave = reactProps(button(messages.save)).onClick!, oldClose = reactProps(button(messages.close)).onClick!;
		await act(async () => { reactProps(file).onChange?.({ currentTarget: { files: [new File(['x'], 'profile.cube')], value: '' } }); await settle(); });
		assert.equal(calls, 1); assert.equal(reactProps(button(messages.save)).disabled, true);
		await act(async () => { oldClose({}); oldSave({}); }); assert.equal(closeCalls, 1); assert.equal(aborted, true);
		const retiring = demands[0]!(); assert.equal(await remainsPending(retiring), true);
		held.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: true }); await act(async () => { await settle(); }); assert.equal(await remainsPending(retiring), true);
		await act(async () => { preview.resolve({ outcome: 'missing' }); await retiring; }); assert.deepEqual(await fixture.repository.loadPhoto('catalog-1', before.id), before);
	} finally { held.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: false }); preview.resolve({ outcome: 'missing' }); await mounted.dispose(); await fixture.close(); restoreCanvas(); }
});

test('a replacement current Workspace joins its predecessor import before acquiring the next authoring capability', async () => {
	const restoreCanvas = canvasBoundary(), fixture = await currentDevelopFixture(1), messages = photoDevelopCopy('en'); let generation = 1, reads = 0;
	const held = deferred<Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>>(), beforePresent = Promise.resolve();
	const execute: import('../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts').ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => { reads++; return fixture.develop; }, refresh: async () => undefined });
	};
	const readPreview: import('../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts').PixelPreviewPresentationReaderV1 = async () => ({ outcome: 'missing' });
	const loadProxy = async () => { throw Error('No pixels'); }, registerRetirement = () => () => undefined;
	const importCubeLut: PhotoLibraryCubeLutPortV1['importFile'] = async () => held.promise;
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 locale="en" photoId={fixture.photos[0]!.id} label="Photo" generation={generation} execute={execute}
		readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} onClose={() => undefined} importCubeLut={importCubeLut} />);
	const button = (text: string) => { const value = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === text); assert.ok(value); return value; };
	try {
		await act(async () => { await settle(); }); const combo = mounted.dom.container.querySelectorAll('select').find(value => value.parentNode?.textContent.startsWith(messages.choose)); assert.ok(combo);
		await act(async () => { reactProps(combo).onChange?.({ currentTarget: { value: 'cube-lut-profile-v1' } }); }); await act(async () => { reactProps(button(messages.add)).onClick?.({}); });
		const file = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === messages.shared.videoEffectCubeLutImport); assert.ok(file);
		await act(async () => { reactProps(file).onChange?.({ currentTarget: { files: [new File(['x'], 'profile.cube')], value: '' } }); await settle(); }); assert.equal(reads, 1);
		const oldClose = reactProps(button(messages.close)).onClick!; generation = 2; await mounted.render(); await act(async () => { oldClose({}); await settle(); }); assert.equal(reads, 1);
		await act(async () => { held.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: true }); await settle(); }); assert.equal(reads, 2);
		assert.ok(mounted.dom.container.querySelectorAll('button').some(value => value.textContent === messages.add));
	} finally { held.resolve({ reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: false }); await mounted.dispose(); await fixture.close(); restoreCanvas(); }
});

test('Close during a held post-native Save keeps the actual durable mixed recipe and revision', async () => {
	const restoreCanvas = canvasBoundary();
	const fixture = await currentDevelopFixture(1), messages = photoDevelopCopy('en'), entered = deferred<void>(), release = deferred<void>(), demands: (() => Promise<void>)[] = [];
	const before = (await fixture.repository.loadPhoto('catalog-1', fixture.photos[0]!.id))!;
	const execute: import('../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts').ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 locale="en" photoId={before.id} label="Photo" generation={fixture} execute={execute}
		readPreview={async () => ({ outcome: 'missing' })} loadProxy={async () => { throw Error('No pixels'); }} beforePresent={Promise.resolve()}
		registerRetirement={() => () => undefined} registerDemandRetirement={retire => { demands.push(retire); return () => undefined; }} onClose={() => undefined} />);
	const button = (text: string) => { const value = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === text); assert.ok(value); return value; };
	try {
		await act(async () => { await settle(); }); const combo = mounted.dom.container.querySelectorAll('select').find(value => value.parentNode?.textContent.startsWith(messages.choose)); assert.ok(combo);
		await act(async () => { reactProps(combo).onChange?.({ currentTarget: { value: 'cube-lut-profile-v1' } }); }); await act(async () => { reactProps(button(messages.add)).onClick?.({}); });
		fixture.hooks.afterWriter = async () => { entered.resolve(); await release.promise; };
		await act(async () => { reactProps(button(messages.save)).onClick?.({}); await entered.promise; }); await act(async () => { reactProps(button(messages.close)).onClick?.({}); });
		const retiring = demands[0]!(); assert.equal(await remainsPending(retiring), true); await act(async () => { release.resolve(); await retiring; await settle(); });
		const after = (await fixture.repository.loadPhoto('catalog-1', before.id))!; assert.equal(after.revision, before.revision + 1); assert.equal(after.schemaVersion, 2);
		assert.equal(after.versions[0]!.develop.effects[0]!.params.lut, null); assert.deepEqual(after.original, before.original);
	} finally { release.resolve(); await mounted.dispose(); await fixture.close(); restoreCanvas(); }
});

test('same-gesture Close before the queued import refuses borrowed host acquisition', async () => {
	const fixture = await currentDevelopFixture(1), messages = photoDevelopCopy('en'); let calls = 0;
	const execute: import('../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts').ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 locale="en" photoId={fixture.photos[0]!.id} label="Photo" generation={fixture} execute={execute}
		readPreview={async () => ({ outcome: 'missing' })} loadProxy={async () => { throw Error('No pixels'); }} beforePresent={Promise.resolve()}
		registerRetirement={() => () => undefined} onClose={() => undefined} importCubeLut={async () => { calls++; return { reference: normalizeCubeLutProfileParamsV1({ lut: currentRecipe().effects[0]!.params.lut }).lut!, created: true }; }} />);
	const button = (text: string) => { const value = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === text); assert.ok(value); return value; };
	try {
		await act(async () => { await settle(); }); const combo = mounted.dom.container.querySelectorAll('select').find(value => value.parentNode?.textContent.startsWith(messages.choose)); assert.ok(combo);
		await act(async () => { reactProps(combo).onChange?.({ currentTarget: { value: 'cube-lut-profile-v1' } }); }); await act(async () => { reactProps(button(messages.add)).onClick?.({}); });
		const file = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === messages.shared.videoEffectCubeLutImport); assert.ok(file);
		await act(async () => { reactProps(file).onChange?.({ currentTarget: { files: [new File(['x'], 'profile.cube')], value: '' } }); reactProps(button(messages.close)).onClick?.({}); await settle(); });
		assert.equal(calls, 0);
	} finally { await mounted.dispose(); await fixture.close(); }
});

test('retained Close and name handlers from a previous photo cannot retire or edit the current presentation', async () => {
	const fixture = await currentDevelopFixture(2), messages = photoDevelopCopy('en'); let photoId = fixture.photos[0]!.id, closed = 0;
	const execute: import('../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts').ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const readPreview: import('../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts').PixelPreviewPresentationReaderV1 = async () => ({ outcome: 'missing' });
	const loadProxy = async () => { throw Error('No pixels'); }, registerRetirement = () => () => undefined, beforePresent = Promise.resolve();
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 locale="en" photoId={photoId} label="Photo" generation={fixture} execute={execute}
		readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} onClose={() => { closed++; }} />);
	try {
		await act(async () => { await settle(); }); const close = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === messages.close); assert.ok(close);
		const name = () => { const value = mounted.dom.container.querySelectorAll('input').find(value => value.parentNode?.textContent.startsWith(messages.snapshotName)); assert.ok(value); return value; };
		const oldClose = reactProps(close).onClick!, oldName = reactProps(name()).onChange!;
		photoId = fixture.photos[1]!.id; await mounted.render(); await act(async () => { await settle(); oldName({ currentTarget: { value: 'Retired name' } }); oldClose({}); });
		assert.equal(closed, 0); assert.equal(reactProps(name()).value, '');
		await act(async () => { reactProps(name()).onChange?.({ currentTarget: { value: 'Current name' } }); }); assert.equal(reactProps(name()).value, 'Current name');
	} finally { await mounted.dispose(); await fixture.close(); }
});
