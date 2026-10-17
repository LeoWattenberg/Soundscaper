/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopGradientDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopGradientDialogV1.tsx';
import PhotoDevelopRangeMaskDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopRangeMaskDialogV1.tsx';
import PhotoDevelopBrushMaskDialogV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopBrushMaskDialogV1.tsx';
import PhotoDevelopMaskManagerV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopMaskManagerV1.tsx';
import { manageImageDevelopMasksCurrentV1, replaceImageDevelopLocalMasksCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-management-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopBrushMaskCopy } from '../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
type Kind = 'linear-gradient' | 'radial-gradient' | 'luminance-range' | 'color-range';
function node(kind: Kind) {
	if (kind === 'linear-gradient') return { id: 'out', kind, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
	if (kind === 'radial-gradient') return { id: 'out', kind, center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.3 }, innerFraction: 0.2 };
	if (kind === 'luminance-range') return { id: 'out', kind, lower: 0.1, upper: 0.3, falloff: 0.1 };
	return { id: 'out', kind, color: { r: 1, g: 0, b: 0 }, radius: 0.1, falloff: 0.1 };
}
function recipe(graph: unknown): Readonly<ImageDevelopStateV3> {
	const develop = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('tone-ladder-v1', { id: 'tone' }), createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false }),
	], masks: [graph, { ...rectangleGraph(), id: 'untouched', schemaVersion: 2, name: 'Donor' }],
	maskBindings: [{ effectId: 'tone', maskId: 'chosen' }, { effectId: 'detail', maskId: 'untouched' }] });
	return replaceImageDevelopRepairSpotsV1(develop, { schemaVersion: 1, spots: [{ id: 'repair', mode: 'heal', enabled: false,
		target: { x: 0.8, y: 0.6 }, source: { x: 0.2, y: 0.4 }, radius: 0.1, feather: 0.5, opacity: 0.7 }] });
}
function controls(container: ReactTestElement) {
	const control = (label: string) => { const found = container.querySelectorAll('input,select').find(value => value.getAttribute('aria-label') === label); assert.ok(found, label); return found; };
	const button = (label: string) => { const found = container.querySelectorAll('button').find(value => value.textContent === label); assert.ok(found, label); return found; };
	return { control, button,
		async change(label: string, value: string) { await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: { value } }); await settle(); }); },
		async click(label: string) { await act(async () => { reactProps(button(label)).onClick?.({}); await settle(); }); } };
}
function preserved(result: Readonly<ImageDevelopStateCurrentV1>, initial: Readonly<ImageDevelopStateV3>) {
	assert.equal(result.processVersion, 3); if (result.processVersion !== 3) throw Error('Repair recipe downgraded.');
	assert.deepEqual(result.repairs, initial.repairs); assert.deepEqual(result.geometry, initial.geometry);
}

for (const locale of ['en', 'de']) for (const kind of ['linear-gradient', 'radial-gradient', 'luminance-range', 'color-range'] as const) {
	test(`${locale}: local ${kind} edit and removal retain complete repairs and untouched mask declarations`, async () => {
		const initial = recipe({ schemaVersion: 2, name: 'Selected', id: 'chosen', kind: 'matte', inputs: [], nodes: [node(kind)], outputNodeId: 'out' });
		const wire = JSON.stringify(initial), applied: Readonly<ImageDevelopStateCurrentV1>[] = [], text = photoDevelopLocalAdjustmentsCopy(locale, kind);
		let props = { develop: initial, locale, isCurrent: () => true, onApply: (value: Readonly<ImageDevelopStateCurrentV1>) => { applied.push(value); }, onClose: () => undefined };
		// The old component receives the actual new envelope; this cast grants no admission.
		const render = () => kind === 'linear-gradient' || kind === 'radial-gradient'
			? <PhotoDevelopGradientDialogV1 {...props as unknown as React.ComponentProps<typeof PhotoDevelopGradientDialogV1>} kind={kind} />
			: <PhotoDevelopRangeMaskDialogV1 {...props as unknown as React.ComponentProps<typeof PhotoDevelopRangeMaskDialogV1>} kind={kind} />;
		const mounted = await mountPhotoImportUi(() => <StrictMode>{render()}</StrictMode>);
		try {
			const f = controls(mounted.dom.container); await f.change(text.gradient, 'chosen');
			const [field, value] = kind === 'linear-gradient' ? [text.endY, '0.2'] : kind === 'radial-gradient' ? [text.radiusY, '0.4']
				: kind === 'luminance-range' ? [text.upper, '0.8'] : [text.blue, '0.3'];
			await f.change(field!, value!); await f.click(text.apply); assert.equal(applied.length, 1); preserved(applied[0]!, initial);
			assert.deepEqual(applied[0]!.masks.find(mask => mask.id === 'untouched'), initial.masks[1]);
			const selected = applied[0]!.masks.find(mask => mask.id === 'chosen'); assert.ok(selected); assert.equal(selected.schemaVersion, 2);
			if (selected.schemaVersion === 2) assert.equal(selected.name, 'Selected'); assert.equal(selected.outputNodeId, 'out');
			props = { ...props }; await mounted.render(); await f.change(text.gradient, 'chosen'); await f.click(text.remove);
			assert.equal(applied.length, 2); preserved(applied[1]!, initial); assert.deepEqual(applied[1]!.masks, [initial.masks[1]]);
			assert.deepEqual(applied[1]!.maskBindings, [{ effectId: 'detail', maskId: 'untouched' }]); assert.equal(JSON.stringify(initial), wire);
		} finally { await mounted.dispose(); }
	});
}

test('Current mask management keeps process3 sticky through duplicate, composition, naming, binding and last removal', () => {
	const initial = recipe({ ...rectangleGraph(), id: 'chosen', schemaVersion: 2, name: 'Selected' }), wire = JSON.stringify(initial);
	let value = manageImageDevelopMasksCurrentV1(initial, { type: 'duplicate', maskId: 'chosen', duplicateId: 'copy' }); preserved(value, initial);
	value = manageImageDevelopMasksCurrentV1(value, { type: 'compose', maskId: 'copy', operandMaskId: 'untouched', operation: 'subtract' }); preserved(value, initial);
	value = manageImageDevelopMasksCurrentV1(value, { type: 'rename', maskId: 'copy', name: '  Copy e\u0301  ' }); preserved(value, initial);
	value = manageImageDevelopMasksCurrentV1(value, { type: 'bindings', maskId: 'copy', effectIds: ['tone'] }); preserved(value, initial);
	assert.deepEqual(value.masks.find(mask => mask.id === 'untouched'), initial.masks[1]);
	value = manageImageDevelopMasksCurrentV1(value, { type: 'rename', maskId: 'copy', name: '' }); preserved(value, initial);
	for (const mask of [...value.masks]) value = manageImageDevelopMasksCurrentV1(value, { type: 'remove', maskId: mask.id });
	preserved(value, initial); assert.deepEqual(value.masks, []); assert.deepEqual(value.maskBindings, []); assert.equal(JSON.stringify(initial), wire);
});

test('Current local mask replacement never accepts repairs or process-version fields as a patch', () => {
	const initial = recipe({ ...rectangleGraph(), id: 'chosen' }), replacement = { effects: initial.effects, masks: [], maskBindings: [] };
	const value = replaceImageDevelopLocalMasksCurrentV1(initial, replacement); preserved(value, initial); assert.deepEqual(value.masks, []);
	for (const extra of [{ repairs: { schemaVersion: 1, spots: [] } }, { processVersion: 2 }]) {
		assert.throws(() => replaceImageDevelopLocalMasksCurrentV1(initial, { ...replacement, ...extra }));
	}
	let getters = 0; const hostile = { ...replacement }; Object.defineProperty(hostile, 'masks', { get() { getters++; return []; } });
	assert.throws(() => replaceImageDevelopLocalMasksCurrentV1(initial, hostile)); assert.equal(getters, 0);
});

for (const locale of ['en', 'de']) test(`${locale}: mounted Current manager keeps edits local and applies removal-last with unchanged repair metadata`, async () => {
	const initial = recipe({ ...rectangleGraph(), id: 'chosen' }), applied: Readonly<ImageDevelopStateCurrentV1>[] = [], text = photoDevelopMaskManagementCopy(locale);
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopMaskManagerV1 develop={initial as never} locale={locale} isCurrent={() => true}
		onApply={value => { applied.push(value); }} onClose={() => undefined} />);
	try {
		const f = controls(mounted.dom.container); await f.change(text.name, 'Retained repairs'); await f.click(text.rename);
		assert.equal(applied.length, 0); await f.click(text.remove); await f.click(text.remove); await f.click(text.apply);
		assert.equal(applied.length, 1); preserved(applied[0]!, initial); assert.deepEqual(applied[0]!.masks, []);
	} finally { await mounted.dispose(); }
});

test('brush re-edit uses actual selected install ACK and retains Current repairs, names, IDs and the original', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), session = await createPhotoLibrarySessionCurrentV1(seeded.options);
	const port = session.develop.maskRasters; assert.ok(port); const body = await withPreparedBrushMaskResourceV1({ width: 2, height: 2, alpha: Uint8Array.of(0, 255, 128, 64) },
		view => ({ reference: view.reference, bytes: view.bytes.slice() }));
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined;
	const retirements = new Set<() => Promise<void>>();
	try {
		await port.install(body.reference, body.bytes);
		const initial = recipe({ schemaVersion: 2, name: 'Painted', id: 'chosen', kind: 'matte', inputs: [{ name: 'stored', kind: 'alpha', sourceRef: body.reference.storageKey }],
			nodes: [{ id: 'out', kind: 'alpha', inputName: 'stored' }], outputNodeId: 'out' });
		const text = photoDevelopBrushMaskCopy('en'), applied: Readonly<ImageDevelopStateCurrentV1>[] = [];
		mounted = await mountPhotoImportUi(() => <PhotoDevelopBrushMaskDialogV1 develop={initial as never} port={port} locale="en" isCurrent={() => true}
			onApply={value => { applied.push(value); }} onClose={() => undefined} registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />);
		const f = controls(mounted.dom.container); await f.change(text.mask, 'chosen'); await f.click(text.apply);
		assert.equal(applied.length, 1); preserved(applied[0]!, initial); assert.deepEqual(applied[0]!.masks[0], initial.masks[0]);
		await port.source.withBytes(body.reference, bytes => { assert.deepEqual(bytes, body.bytes); });
		const read = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id }); assert.equal(read.revision, 0);
	} finally { await mounted?.dispose(); await Promise.all([...retirements].map(retire => retire())); await session.close(); body.bytes.fill(0); }
});
