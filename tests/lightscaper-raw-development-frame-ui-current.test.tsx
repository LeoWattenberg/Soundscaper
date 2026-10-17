/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import FramescaperImageDevelopOwnerSurfaceV1 from '../src/common/editor/ui/dialogs/FramescaperImageDevelopOwnerSurfaceV1.tsx';
import { bindFramescaperImageDevelopAuthoringCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { createPhotoFramescaperHandoffProjectCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-project-current-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { createImageDevelopHandoffProvenanceCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { decodeLibRawRecoveryWasmV2 } from '../src/common/editor/raw/libraw-wasm-instance-v2.ts';
import { photoDevelopRepairSpotsCopy } from '../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopBrushMaskCopy } from '../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { rawDerivedFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-derived-frame-current-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const OPTIONS = { concurrency: false, timeout: 30_000 };
const RECOVERY = process.env.LIGHTSCAPER_RECOVERY_WASM ?? new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url);
let compiled: Promise<WebAssembly.Module> | undefined;
function recipe(brush?: Readonly<BrushMaskResourceReferenceV1>) {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'recovery' },
		repairs: { schemaVersion: 1, spots: [{ id: 'saved-clone', mode: 'clone', enabled: true,
			target: { x: 72.5 / 128, y: 40.5 / 96 }, source: { x: 12.5 / 128, y: 40.5 / 96 }, radius: .0025, feather: 0, opacity: 1 }] },
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }],
		masks: brush ? [{ schemaVersion: 2, id: 'paint', name: 'Saved paint', kind: 'matte', inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: brush.storageKey }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' }]
			: [{ schemaVersion: 2, id: 'right', name: 'Right half', kind: 'matte', inputs: [], nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: .5, y: 0, width: .5, height: 1 }], outputNodeId: 'shape' }],
		maskBindings: [{ maskId: brush ? 'paint' : 'right', effectId: 'tone' }] });
}

/** Canvas alone is modeled. The real selected Session, native media writer,
 * ABI1 receipt proof and ABI2 production workers remain actual owners. */
function canvasBoundary() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const paintings: number[][] = [];
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(value: { data: Uint8ClampedArray }) { paintings.push([...value.data]); } }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { paintings, restore() { for (const [index, key] of keys.entries()) { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}

async function fixture(brush?: Readonly<{ reference: Readonly<BrushMaskResourceReferenceV1>; bytes: Uint8Array<ArrayBuffer> }>) {
	const f = await rawDerivedFrameFixtureCurrentV1(), boundary = canvasBoundary(), native = mediaRestoreFixture();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: native.factory, locks: currentAppLocks(), preferOpfs: false });
	try {
		const develop = recipe(brush?.reference), source = normalizeFramescaperImageSourceCurrentV1({ ...f.source, develop,
			provenance: createImageDevelopHandoffProvenanceCurrentV1({ develop, original: f.source.provenance.original, origin: f.source.provenance.origin }) });
		assert.ok(source.schemaVersion === 4);
		await store.writeMediaAsset(source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: source.name, mimeType: source.mimeType });
		if (brush) {
			await store.writeMediaAsset(brush.reference.storageKey, new Blob([new Uint8Array(brush.bytes)]), {
				name: brush.reference.storageKey, kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', mimeType: 'application/octet-stream',
			});
			const installed: unknown = await store.getMediaAssetMetadata(brush.reference.storageKey); assert.ok(installed && typeof installed === 'object');
			assert.deepEqual(['kind', 'encoding', 'mimeType', 'size', 'sha256'].map(key => Object.getOwnPropertyDescriptor(installed, key)?.value),
				['photo-mask-raster', 'lightscaper-mask-raster-v1', 'application/octet-stream', brush.reference.byteLength, brush.reference.sha256]);
		}
		const token = await store.getMediaAssetMetadata(source.storageKey);
		const project = createPhotoFramescaperHandoffProjectCurrentV1(source, { projectId: 'recovery-ui', sequenceId: 'recovery-ui-sequence', trackId: 'recovery-ui-track', clipId: 'recovery-ui-clip', now: '2026-10-01T00:00:00.000Z' });
		let history = createFramescaperProjectHistory(PROFILE, project);
		const commands: FramescaperImageSourceSetCommandTimelineImage[] = [], hooks = { load: async (): Promise<void> => undefined };
		const controller = { project: history.present, getSnapshot: () => ({ selectedClipId: 'recovery-ui-clip' }), actions: { edit: {
			commit(command: FramescaperImageSourceSetCommandTimelineImage) { assert.equal(this, controller.actions.edit); commands.push(command);
				history = executeFramescaperProjectCommand(PROFILE, history, command); controller.project = history.present; },
		} } };
		const borrowed = {
			async loadMediaAsset(...args: Parameters<typeof store.loadMediaAsset>) { const result = await store.loadMediaAsset(...args); await hooks.load(); return result; },
			getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store), beginMediaAssetWrite: store.beginMediaAssetWrite.bind(store),
		};
		bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: borrowed });
		compiled ??= readFile(RECOVERY).then(bytes => WebAssembly.compile(bytes)); const decoded = decodeLibRawRecoveryWasmV2(await compiled, f.original, 'highlight-recovery-v1');
		const samples = Array.from(decoded.frame.pixels); decoded.frame.pixels.fill(0);
		const keys = ['Worker', 'fetch'] as const, previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function (_url: URL, options: WorkerOptions) {
			return options.name === 'lightscaper-libraw-recovery' ? f.native.recovery.createWorker() : f.native.canonical.createWorker();
		} });
		Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
			assert.ok(url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm' || url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm');
			return new Response(new Uint8Array(await readFile(String(url).includes('recovery-abi2') ? RECOVERY : new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))));
		} });
		return { ...f, source, develop, samples, boundary, store, token, controller, commands, hooks,
			undo() { history = undoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; },
			redo() { history = redoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; },
			async custody() { assert.deepEqual(await store.getMediaAssetMetadata(source.storageKey), token); const body = await store.loadMediaAsset(source.storageKey); assert.ok(body instanceof Blob);
				assert.deepEqual(new Uint8Array(await body.arrayBuffer()), f.pack.bytes); },
			async close() {
				const results = await Promise.allSettled([store.close(), f.close()]);
				for (const [index, key] of keys.entries()) { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
				boundary.restore(); const errors = results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
				if (errors.length) throw new AggregateError(errors, 'Frame UI native fixture retirement failed.');
			} };
	} catch (error) { await Promise.allSettled([store.close(), f.close()]); boundary.restore(); throw error; }
}

type Ui = Awaited<ReturnType<typeof mountPhotoImportUi>>;
async function waitFor(predicate: () => boolean, description: string) {
	for (let turn = 0; turn < 1000; turn++) { await act(async () => { await settle(1, { delayMs: 2 }); }); if (predicate()) return; }
	assert.fail(`Timed out waiting for ${description}.`);
}
function button(ui: Ui, name: string) { const value = ui.dom.container.querySelectorAll('button').filter(node => node.textContent === name).at(-1); assert.ok(value, name); return value; }
async function click(ui: Ui, name: string) { await act(async () => { reactProps(button(ui, name)).onClick?.({}); await settle(); }); }
async function change(ui: Ui, name: string, value: string) {
	const input = ui.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === name); assert.ok(input, name);
	await act(async () => { reactProps(input).onChange?.({ currentTarget: { value } }); await settle(); });
}
function code(value: number) { const linear = Math.max(0, Math.min(1, value)); return Math.round(255 * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055)); }
function original(samples: readonly number[]) { return samples.map((value, index) => index % 4 === 3 ? 255 : code(value)); }
function after(samples: readonly number[], full = false) {
	const result: number[] = [];
	for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
		const donor = x === 72 && y === 40 ? 12 : x;
		for (let c = 0; c < 3; c++) result.push(code(Math.fround(samples[(y * 128 + donor) * 4 + c]! * (full || x >= 64 ? .5 : 1)))); result.push(255);
	} return result;
}

for (const locale of ['en', 'de']) test(`${locale}: actual Frame recovery4 repair widget retains saved Clone, no-op identity and RAW source policy through edit/history`, OPTIONS, async () => {
	const f = await fixture(), text = photoDevelopRepairSpotsCopy(locale); let closed = 0;
	let ui: Ui | undefined;
	try {
		const mount = () => mountPhotoImportUi(() => <FramescaperImageDevelopOwnerSurfaceV1 controller={f.controller} kind="repairs" locale={locale} disabled={false} onClose={() => { closed++; }} />);
		ui = await mount(); await waitFor(() => ui!.dom.container.querySelectorAll('[data-photo-repair-original]').some(node => node.getAttribute('data-state') === 'ready'), 'saved recovery4 repair Original');
		assert.deepEqual(f.boundary.paintings.at(-1), original(f.samples));
		const target = ui.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.targetX); assert.ok(target);
		assert.equal(reactProps(target).value, String(72.5 / 128), 'The retained Clone populates the editor instead of a blank repair group.');
		await click(ui, text.apply); await waitFor(() => closed === 1, 'no-op repair Apply native retirement');
		assert.equal(f.commands.length, 0); assert.deepEqual(f.controller.project.sources, [f.source]); await ui.dispose(); ui = await mount();
		await waitFor(() => ui!.dom.container.querySelectorAll('[data-photo-repair-original]').some(node => node.getAttribute('data-state') === 'ready'), 'reopened recovery4 repairs');
		await change(ui, text.sourceY, '.25'); await click(ui, text.apply); await waitFor(() => closed === 2, 'changed repair Apply native retirement');
		assert.equal(f.commands.length, 1); const saved = f.controller.project.sources[0]!; assert.ok(saved.kind === 'image' && saved.schemaVersion === 4);
		assert.equal(saved.develop.processVersion, 4); if (saved.develop.processVersion !== 4) assert.fail('The Frame RAW group was discarded.');
		assert.deepEqual(saved.develop.rawDevelopment, f.develop.rawDevelopment); assert.equal(saved.develop.repairs.spots.length, 1); assert.equal(saved.develop.repairs.spots[0]!.source.y, .25);
		assert.deepEqual(saved.raw, f.raw); assert.deepEqual(saved.original, f.source.original); assert.deepEqual(saved.develop.effects, f.develop.effects);
		f.undo(); assert.deepEqual(f.controller.project.sources, [f.source]); f.redo(); assert.deepEqual(f.controller.project.sources, [saved]);
		assert.equal(videoPreviewAuthoringPausedV1(f.controller), false); await f.custody();
	} finally { await ui?.dispose(); await f.close(); }
});

test('actual Frame mask widget receives projected metadata but every temporary preview retains full recovery4 source selection', OPTIONS, async () => {
	const f = await fixture(), text = photoDevelopMaskManagementCopy('en'); let closed = 0;
	let ui: Ui | undefined;
	try {
		ui = await mountPhotoImportUi(() => <FramescaperImageDevelopOwnerSurfaceV1 controller={f.controller} kind="masks" locale="en" disabled={false} onClose={() => { closed++; }} />);
		await waitFor(() => ui!.dom.container.querySelectorAll('[data-frame-image-develop-preview]').some(node => node.getAttribute('data-state') === 'ready'), 'recovery4 mask native preview');
		assert.deepEqual(f.boundary.paintings.filter(pixels => pixels.length === 128 * 96 * 4).at(-1), after(f.samples));
		await click(ui, text.close); await waitFor(() => closed === 1, 'mask preview Close');
		assert.equal(f.commands.length, 0); assert.deepEqual(f.controller.project.sources, [f.source]); await f.custody();
	} finally { await ui?.dispose(); await f.close(); }
});

test('actual Frame brush widget replays its genuine retained body against recovery4 without losing the RAW group or installing a temporary preview', OPTIONS, async () => {
	await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(255, 255) }, async body => {
		const f = await fixture(body), text = photoDevelopBrushMaskCopy('en'); let closed = 0;
		let ui: Ui | undefined;
		try {
			ui = await mountPhotoImportUi(() => <FramescaperImageDevelopOwnerSurfaceV1 controller={f.controller} kind="brush" locale="en" disabled={false} onClose={() => { closed++; }} />);
			await waitFor(() => ui!.dom.container.querySelectorAll('[data-frame-image-brush-preview]').some(node => node.getAttribute('data-state') === 'ready'), 'recovery4 brush native preview');
			const mask = ui.dom.container.querySelectorAll('select').find(node => node.getAttribute('aria-label') === text.mask); assert.ok(mask);
			assert.equal(reactProps(mask).value, '', 'The initial grid is a new mask; re-edit explicitly selects the retained body.');
			await act(async () => { reactProps(mask).onChange?.({ currentTarget: { value: 'paint' } }); await settle(); });
			await waitFor(() => ui!.dom.container.querySelectorAll('[data-image-brush-mask-grid]').some(node => node.getAttribute('data-state') === 'ready')
				&& f.boundary.paintings.some(pixels => pixels.length === 8), 'retained 2×1 brush replay and native preview retirement');
			assert.equal(reactProps(mask).value, 'paint');
			assert.deepEqual(f.boundary.paintings.filter(pixels => pixels.length === 128 * 96 * 4).at(-1), after(f.samples, true));
			assert.deepEqual(f.boundary.paintings.filter(pixels => pixels.length === 8).at(-1), [32, 160, 255, 255, 32, 160, 255, 255]);
			await click(ui, text.close); await waitFor(() => closed === 1, 'brush native preview Close');
			assert.equal(f.commands.length, 0); assert.deepEqual(f.controller.project.sources, [f.source]); await f.custody();
			const retained = await f.store.loadMediaAsset(body.reference.storageKey); assert.ok(retained instanceof Blob);
			assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), body.bytes);
		} finally { await ui?.dispose(); await f.close(); }
	});
});

test('Frame recipe4 Close joins an actual held native pack read and cannot publish stale repair metadata', OPTIONS, async () => {
	const f = await fixture(), text = photoDevelopRepairSpotsCopy('en'), entered = deferred<void>(), release = deferred<void>(); let closed = 0;
	f.hooks.load = async () => { entered.resolve(); await release.promise; };
	let ui: Ui | undefined;
	try {
		ui = await mountPhotoImportUi(() => <FramescaperImageDevelopOwnerSurfaceV1 controller={f.controller} kind="repairs" locale="en" disabled={false} onClose={() => { closed++; }} />);
		await entered.promise; await click(ui, text.close); await settle(); assert.equal(closed, 0); assert.equal(videoPreviewAuthoringPausedV1(f.controller), true);
		release.resolve(); await waitFor(() => closed === 1, 'recipe4 native pack read and Close');
		assert.equal(f.commands.length, 0); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false); await f.custody();
	} finally { release.resolve(); await ui?.dispose(); await f.close(); }
});
