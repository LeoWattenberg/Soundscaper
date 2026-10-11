/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopGradientDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopGradientDialogV1.tsx';
import PhotoDevelopRangeMaskDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopRangeMaskDialogV1.tsx';
import PhotoDevelopBrushMaskDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopBrushMaskDialogV1.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopBrushMaskCopy } from '../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPreparedBrushMaskResourceV1, withBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from '../src/common/editor/photo-library-develop-mask-raster-port-v1.ts';
import { createPhotoMediaMaskRasterResourcesV1 } from '../src/lightscaper/storage/photo-media-mask-raster-resources-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import { settle } from './helpers/async-test-control.ts';

type Kind = 'linear-gradient' | 'radial-gradient' | 'luminance-range' | 'color-range';
function node(kind: Kind) {
	const common = { id: 'retained-output', kind };
	if (kind === 'linear-gradient') return { ...common, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
	if (kind === 'radial-gradient') return { ...common, center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.25 }, innerFraction: 0.25 };
	if (kind === 'luminance-range') return { ...common, lower: 0.1, upper: 0.2, falloff: 0.1 };
	return { ...common, color: { r: 1, g: 0, b: 0 }, radius: 0.1, falloff: 0.1 };
}
function recipe(graph: unknown, named = true): PhotoLibraryDevelopSettingsV2 {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('white-balance-v1', { id: 'warm' }), createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false }),
	], masks: [graph, { ...rectangleGraph(), id: 'unrelated', ...(named ? { schemaVersion: 2, name: 'Unrelated mask' } : {}) }],
	maskBindings: [{ effectId: 'warm', maskId: 'selected' }, { effectId: 'detail', maskId: 'unrelated' }] });
}
function name(graph: PhotoLibraryDevelopSettingsV2['masks'][number]): unknown { return Object.getOwnPropertyDescriptor(graph, 'name')?.value as unknown; }
function controls(container: ReactTestElement) {
	const control = (label: string) => { const found = container.querySelectorAll('input,select').find(value => value.getAttribute('aria-label') === label); assert.ok(found, label); return found; };
	const button = (label: string) => { const found = container.querySelectorAll('button').find(value => value.textContent === label); assert.ok(found, label); return found; };
	const change = async (label: string, value: string) => { await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: { value } }); await settle(); }); };
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); await settle(); }); };
	return { control, button, change, click };
}

for (const locale of ['en', 'de']) for (const kind of ['linear-gradient', 'radial-gradient', 'luminance-range', 'color-range'] as const) {
	test(`${locale}: named ${kind} re-edit displays the name and preserves schema, node/output identity and unrelated names`, async () => {
		const graph = { schemaVersion: 2, name: 'Named skyline', id: 'selected', kind: 'matte', inputs: [], nodes: [node(kind)], outputNodeId: 'retained-output' };
		const initial = recipe(graph), wire = JSON.stringify(initial), applied: PhotoLibraryDevelopSettingsV2[] = [], text = photoDevelopLocalAdjustmentsCopy(locale, kind);
		const props = { develop: initial, locale, isCurrent: () => true, onApply: (value: PhotoLibraryDevelopSettingsV2) => { applied.push(value); }, onClose: () => undefined };
		const mounted = await mountPhotoImportUi(() => kind === 'linear-gradient' || kind === 'radial-gradient'
			? <PhotoDevelopGradientDialogV1 {...props} kind={kind} /> : <PhotoDevelopRangeMaskDialogV1 {...props} kind={kind} />);
		try {
			const f = controls(mounted.dom.container), selection = f.control(text.gradient);
			assert.equal(selection.options.find(value => value.value === 'selected')!.textContent, 'Named skyline (selected)');
			await f.change(text.gradient, 'selected');
			const [field, value] = kind === 'linear-gradient' ? [text.endY, '0.25'] : kind === 'radial-gradient' ? [text.radiusY, '0.4']
				: kind === 'luminance-range' ? [text.upper, '0.8'] : [text.blue, '0.3'];
			await f.change(field!, value!); await f.click(text.apply); assert.equal(applied.length, 1);
			const result = applied[0]!, selected = result.masks.find(mask => mask.id === 'selected')!;
			assert.equal(selected.schemaVersion, 2); assert.equal(name(selected), 'Named skyline'); assert.equal(selected.kind, 'matte'); assert.equal(selected.outputNodeId, graph.outputNodeId);
			assert.equal(selected.nodes[0]!.id, graph.nodes[0]!.id); assert.notDeepEqual(selected.nodes, graph.nodes);
			assert.deepEqual(result.masks.find(mask => mask.id === 'unrelated'), initial.masks.find(mask => mask.id === 'unrelated'));
			assert.deepEqual(result.maskBindings, initial.maskBindings); assert.deepEqual(result.effects, initial.effects); assert.equal(JSON.stringify(initial), wire);
		} finally { await mounted.dispose(); }
	});
}

test('legacy unnamed gradient re-edit preserves exact Graph1 and ID-based selection', async () => {
	const graph = { schemaVersion: 1, id: 'selected', kind: 'mask', inputs: [], nodes: [node('linear-gradient')], outputNodeId: 'retained-output' };
	const initial = recipe(graph, false), text = photoDevelopLocalAdjustmentsCopy('en'), applied: PhotoLibraryDevelopSettingsV2[] = [];
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopGradientDialogV1 develop={initial} locale="en" isCurrent={() => true}
		onApply={value => { applied.push(value); }} onClose={() => undefined} />);
	try {
		const f = controls(mounted.dom.container); assert.equal(f.control(text.gradient).options.find(value => value.value === 'selected')!.textContent, 'selected');
		await f.change(text.gradient, 'selected'); await f.click(text.apply); assert.deepEqual(applied[0], initial);
	} finally { await mounted.dispose(); }
});

for (const locale of ['en', 'de']) test(`${locale}: named brush re-edit authenticates and installs real immutable bytes while preserving label and graph identities`, async () => {
	const body = await withPreparedBrushMaskResourceV1({ width: 2, height: 2, alpha: new Uint8Array([0, 255, 128, 64]) }, view => ({ reference: view.reference, bytes: view.bytes.slice() }));
	try {
		const graph = { schemaVersion: 2, name: 'Painted matte', id: 'selected', kind: 'matte', inputs: [{ name: 'stored', kind: 'raster', sourceRef: body.reference.storageKey }],
			nodes: [{ id: 'retained-output', kind: 'raster', inputName: 'stored', channel: 'alpha' }], outputNodeId: 'retained-output' };
		const initial = recipe(graph), wire = JSON.stringify(initial), databaseName = `mask-name-${crypto.randomUUID()}`, raw = createInstrumentedIndexedDB();
		const database = await openDatabase(raw as unknown as IDBFactory, databaseName);
		const storage = createPhotoMediaMaskRasterResourcesV1({ memory: getMemoryDatabase(databaseName), database: async () => database }, run => run(), () => undefined);
		const retirements = new Set<() => Promise<void>>(), receipts: Awaited<ReturnType<PhotoLibraryDevelopMaskRasterPortV1['install']>>[] = [], applied: PhotoLibraryDevelopSettingsV2[] = [];
		const port: PhotoLibraryDevelopMaskRasterPortV1 = { schemaVersion: 1, source: storage.resources.source, async install(reference, bytes, options) {
			assert.equal(this, port); const result = await storage.resources.put(reference, bytes, options);
			const receipt = { schemaVersion: 1 as const, catalogId: 'catalog', ...result, notices: [] }; receipts.push(receipt); return receipt;
		} };
		let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined, failure: { error: unknown } | undefined;
		try {
			await storage.resources.put(body.reference, body.bytes);
			mounted = await mountPhotoImportUi(() => <PhotoDevelopBrushMaskDialogV1 port={port} develop={initial} locale={locale} isCurrent={() => true}
				onApply={value => { assert.equal(receipts.length, 1, 'The actual install ACK precedes editing the recipe.'); applied.push(value); }} onClose={() => undefined}
				registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />);
			const active = mounted, f = controls(active.dom.container), text = photoDevelopBrushMaskCopy(locale);
			const ready = async () => { for (let turn = 0; turn < 100; turn++) { await act(async () => { await settle(); }); if (active.dom.one('canvas').getAttribute('data-state') === 'ready') return; } assert.fail('Actual brush owner did not become ready.'); };
			await ready(); assert.equal(f.control(text.mask).options.find(option => option.value === 'selected')!.textContent, 'Painted matte (selected)');
			await f.change(text.mask, 'selected'); await ready(); await f.click(text.apply); assert.equal(applied.length, 1);
			const selected = applied[0]!.masks.find(mask => mask.id === 'selected')!;
			assert.deepEqual(selected, graph); assert.deepEqual(applied[0]!.masks.find(mask => mask.id === 'unrelated'), initial.masks.find(mask => mask.id === 'unrelated'));
			assert.deepEqual(applied[0]!.maskBindings, initial.maskBindings); assert.equal(JSON.stringify(initial), wire);
			await storage.resources.source.withBytes(body.reference, bytes => withBrushMaskResourceV1({ reference: body.reference, bytes }, view => { assert.deepEqual([...view.alpha], [0, 255, 128, 64]); }));
		} catch (error) { failure = { error }; }
		const tasks = [...retirements].map(retire => retire()); if (mounted) tasks.push(mounted.dispose());
		const errors = (await Promise.allSettled(tasks)).flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		try { await storage.close(); } catch (error) { errors.push(error); }
		try { database.close(); } catch (error) { errors.push(error); }
		if (failure) errors.unshift(failure.error);
		if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Named brush fixture failed.', { cause: errors[0] });
	} finally { body.bytes.fill(0); }
});
