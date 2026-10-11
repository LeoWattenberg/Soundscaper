/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopMaskManagerV1, { type PhotoDevelopMaskManagerPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopMaskManagerV1.tsx';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PhotoLibraryDevelopSettingsV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { gradientGraph, rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';

const BRUSH_SOURCE = `brush-mask-v1:2:2:${'a'.repeat(64)}`;
function recipe(): PhotoLibraryDevelopSettingsV2 {
	const composed = { ...gradientGraph(), id: 'composed', kind: 'matte', nodes: [
		...gradientGraph().nodes, { id: 'inverse', kind: 'invert', inputNodeId: 'gradient' },
		{ id: 'combined', kind: 'boolean', operation: 'union', inputNodeIds: ['gradient', 'inverse'] },
	], outputNodeId: 'combined' };
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('white-balance-v1', { id: 'warm' }),
		createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 50 } }),
		createVideoEffect('develop-geometry-v1', { id: 'geometry' }),
	], masks: [composed, { ...gradientGraph(), id: 'linear' }, { ...rectangleGraph(), id: 'rectangle', kind: 'matte' },
		{ schemaVersion: 1, id: 'radial', kind: 'mask', inputs: [], nodes: [{ id: 'radial-node', kind: 'radial-gradient',
			center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.25 }, innerFraction: 0.25 }], outputNodeId: 'radial-node' },
		{ schemaVersion: 1, id: 'range', kind: 'matte', inputs: [], nodes: [{ id: 'range-node', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 }], outputNodeId: 'range-node' },
		{ schemaVersion: 1, id: 'brush', kind: 'mask', inputs: [{ name: 'paint', sourceRef: BRUSH_SOURCE, kind: 'alpha' }],
			nodes: [{ id: 'paint-node', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint-node' },
	], maskBindings: [{ effectId: 'warm', maskId: 'linear' }, { effectId: 'detail', maskId: 'brush' }] });
}

async function fixture(locale = 'en', initial: PhotoLibraryDevelopSettingsV2 = recipe(), strict = false) {
	let develop = initial, current = true, disabled = false, closed = 0;
	let renderedProps: PhotoDevelopMaskManagerPropsV1;
	const applied: Array<{ value: PhotoLibraryDevelopSettingsV2; overlay: Parameters<PhotoDevelopMaskManagerPropsV1['onApply']>[1] }> = [];
	const onApply: PhotoDevelopMaskManagerPropsV1['onApply'] = function (this: PhotoDevelopMaskManagerPropsV1, value, overlay) {
		assert.equal(this, renderedProps); applied.push({ value, overlay });
	};
	const onClose = function (this: PhotoDevelopMaskManagerPropsV1) { assert.equal(this, renderedProps); closed++; };
	const mounted = await mountPhotoImportUi(() => {
		const element = <PhotoDevelopMaskManagerV1 develop={develop} locale={locale} disabled={disabled} isCurrent={() => current} onApply={onApply} onClose={onClose} />;
		renderedProps = element.props; return strict ? <StrictMode>{element}</StrictMode> : element;
	});
	const text = photoDevelopMaskManagementCopy(locale);
	const control = (label: string) => {
		const found = mounted.dom.container.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label);
		assert.ok(found, label); return found;
	};
	// React writes option.selected and relies on native select.value reflection.
	// This minimal DOM port stores them independently; inspect the actual
	// controlled value and separately assert the inserted option is selected.
	const value = (label: string) => {
		const selected = Object.getOwnPropertyDescriptor(reactProps(control(label)), 'value')?.value as unknown;
		assert.ok(typeof selected === 'string'); return selected;
	};
	const change = async (label: string, value: string | boolean) => {
		await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: typeof value === 'boolean' ? { checked: value } : { value } }); });
	};
	const button = (label: string) => {
		const found = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(found, label); return found;
	};
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); }); };
	const binds = () => mounted.dom.container.querySelectorAll('input').filter(node => node.hasAttribute('data-photo-develop-mask-binding'));
	const bind = async (id: string, checked: boolean) => {
		const field = binds().find(node => node.getAttribute('data-photo-develop-mask-binding') === id); assert.ok(field, id);
		await change(field.getAttribute('aria-label')!, checked);
	};
	return { ...mounted, text, applied, control, value, change, button, click, binds, bind, closed: () => closed,
		retire() { current = false; },
		async replace(value: PhotoLibraryDevelopSettingsV2, nextDisabled = false) { develop = value; disabled = nextDisabled; await mounted.render(); },
	};
}

for (const locale of ['en', 'de']) test(`${locale}: mask manager lists every graph without changing its inputs, nodes or effect enablement`, async () => {
	const initial = recipe(), wire = JSON.stringify(initial), f = await fixture(locale, initial);
	try {
		assert.equal(f.dom.one('[data-photo-develop-mask-manager]').getAttribute('data-photo-develop-mask-manager'), 'true');
		assert.equal(f.dom.one('[role="dialog"]').getAttribute('aria-label'), f.text.title);
		assert.deepEqual(f.control(f.text.mask).options.map(option => option.value), initial.masks.map(mask => mask.id));
		assert.equal(f.control(f.text.showOverlay).checked, false); assert.equal(f.dom.find(`[aria-label="${f.text.overlayEffect}"]`), null);
		assert.deepEqual(f.binds().map(field => field.getAttribute('data-photo-develop-mask-binding')), ['warm', 'detail']);
		assert.ok(f.binds().every(field => field.type === 'checkbox')); assert.equal(f.binds().length, 2);
		assert.equal(f.dom.container.querySelectorAll('input').filter(field => field.type === 'checkbox').length, 3, 'manager owns bindings and overlay, not effect enabled controls');
		assert.equal(f.dom.container.querySelectorAll('input').filter(field => field.type === 'text').length, 1);
		assert.equal(f.control(f.text.name).type, 'text');
		f.control(f.text.mask).focus(); assert.equal(document.activeElement, f.control(f.text.mask));
		for (const label of [f.text.duplicate, f.text.remove, f.text.apply, f.text.close]) { assert.equal(f.button(label).type, 'button'); }
		await f.click(f.text.apply); assert.deepEqual(f.applied, [{ value: initial, overlay: null }]);
		assert.equal(JSON.stringify(initial), wire);
	} finally { await f.dispose(); }
});

for (const selected of ['composed', 'brush']) test(`duplicate ${selected} locally preserves complete graph identity and starts unbound`, async () => {
	const initial = recipe(), wire = JSON.stringify(initial), f = await fixture('en', initial);
	try {
		await f.change(f.text.mask, selected); await f.click(f.text.duplicate);
		const duplicateId = f.value(f.text.mask);
		assert.match(duplicateId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
		assert.ok(f.control(f.text.mask).options.some(option => option.value === duplicateId && option.selected));
		assert.ok(!initial.masks.some(mask => mask.id === duplicateId)); assert.equal(f.applied.length, 0);
		assert.equal(f.control(f.text.mask).options.length, initial.masks.length + 1); assert.ok(f.binds().every(field => !field.checked));
		await f.click(f.text.apply); assert.equal(f.applied.length, 1);
		const value = f.applied[0]!.value, original = initial.masks.find(mask => mask.id === selected)!;
		assert.deepEqual(value.masks.find(mask => mask.id === duplicateId), { ...original, id: duplicateId });
		assert.deepEqual(value.masks.filter(mask => mask.id !== duplicateId), initial.masks);
		assert.deepEqual(value.maskBindings, initial.maskBindings); assert.deepEqual(value.effects, initial.effects);
		assert.equal(JSON.stringify(initial), wire);
	} finally { await f.dispose(); }
});

test('local checkbox bindings claim the chosen adjustment, preserve enabled states and leave unrelated graphs intact', async () => {
	const initial = recipe(), wire = JSON.stringify(initial), f = await fixture('en', initial);
	try {
		await f.change(f.text.mask, 'composed'); await f.bind('warm', true);
		assert.equal(f.applied.length, 0); await f.bind('detail', true);
		await f.click(f.text.apply); const value = f.applied[0]!.value;
		assert.deepEqual(value.maskBindings, [{ effectId: 'detail', maskId: 'composed' }, { effectId: 'warm', maskId: 'composed' }]);
		assert.deepEqual(value.effects, initial.effects); assert.deepEqual(value.masks, initial.masks); assert.equal(JSON.stringify(initial), wire);
	} finally { await f.dispose(); }
});

test('overlay is explicit, uses only a selected-mask binding and is cleared when that binding or mask changes', async () => {
	const f = await fixture();
	try {
		await f.change(f.text.mask, 'linear'); await f.change(f.text.showOverlay, true);
		assert.equal(f.value(f.text.overlayEffect), ''); assert.deepEqual(f.control(f.text.overlayEffect).options.map(option => option.value), ['', 'warm']);
		await f.click(f.text.apply); assert.equal(f.applied.length, 0); assert.equal(f.dom.one('[role="alert"]').textContent, f.text.invalid);
		for (const bad of ['detail', 'geometry', 'missing']) {
			await f.change(f.text.overlayEffect, bad); await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		}
		await f.change(f.text.overlayEffect, 'warm'); await f.bind('warm', false);
		assert.equal(f.value(f.text.overlayEffect), ''); await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		await f.bind('warm', true); await f.change(f.text.overlayEffect, 'warm'); await f.click(f.text.apply);
		assert.deepEqual(f.applied[0]!.overlay, { maskId: 'linear', effectId: 'warm' });
		await f.change(f.text.mask, 'brush'); assert.equal(f.control(f.text.showOverlay).checked, false);
	} finally { await f.dispose(); }
});

test('Close discards local remove and binding edits without publishing or mutating the caller recipe', async () => {
	const initial = recipe(), wire = JSON.stringify(initial), f = await fixture('en', initial);
	try {
		await f.change(f.text.mask, 'linear'); await f.click(f.text.remove);
		assert.ok(!f.control(f.text.mask).options.some(option => option.value === 'linear')); assert.equal(f.applied.length, 0);
		await f.change(f.text.mask, 'composed'); await f.bind('warm', true); await f.click(f.text.close);
		assert.equal(f.closed(), 1); assert.equal(f.applied.length, 0); assert.equal(JSON.stringify(initial), wire);
	} finally { await f.dispose(); }
});

test('remove the final graph and apply empty masks; recipes without adjustments still permit graph management', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), masks: [gradientGraph()], effects: [], maskBindings: [] }), f = await fixture('en', initial);
	try {
		assert.equal(f.binds().length, 0); assert.ok(f.dom.container.textContent.includes(f.text.noEffects));
		await f.click(f.text.duplicate); assert.equal(f.control(f.text.mask).options.length, 2);
		await f.click(f.text.remove); await f.click(f.text.remove); assert.equal(f.value(f.text.mask), '');
		assert.equal(f.control(f.text.mask).options.length, 1); assert.equal(f.button(f.text.duplicate).hasAttribute('disabled'), true); assert.equal(f.button(f.text.remove).hasAttribute('disabled'), true);
		assert.equal(f.control(f.text.showOverlay).hasAttribute('disabled'), true); assert.ok(f.dom.container.textContent.includes(f.text.empty));
		await f.click(f.text.apply); assert.deepEqual(f.applied[0]!.value, defaultImageDevelopStateV2()); assert.equal(f.applied[0]!.overlay, null);
		assert.equal(initial.masks.length, 1);
	} finally { await f.dispose(); }
});

test('empty recipes can apply unchanged and unknown mask selections never acquire an edit target', async () => {
	const initial = defaultImageDevelopStateV2(), f = await fixture('en', initial);
	try {
		assert.equal(f.value(f.text.mask), ''); await f.change(f.text.mask, 'missing'); assert.equal(f.value(f.text.mask), '');
		await f.click(f.text.duplicate); await f.click(f.text.remove); await f.click(f.text.apply);
		assert.deepEqual(f.applied, [{ value: initial, overlay: null }]);
	} finally { await f.dispose(); }
});

test('handlers retained from a previous local form cannot remove, rebind or select after duplication', async () => {
	const f = await fixture();
	try {
		await f.change(f.text.mask, 'linear'); const staleRemove = reactProps(f.button(f.text.remove)).onClick;
		const staleSelect = reactProps(f.control(f.text.mask)).onChange, staleBind = reactProps(f.binds()[0]!).onChange;
		await f.click(f.text.duplicate); const selected = f.value(f.text.mask), count = f.control(f.text.mask).options.length;
		await act(async () => { staleRemove?.({}); staleSelect?.({ currentTarget: { value: 'brush' } }); staleBind?.({ currentTarget: { checked: true } }); });
		assert.equal(f.value(f.text.mask), selected); assert.equal(f.control(f.text.mask).options.length, count); assert.ok(f.binds().every(field => !field.checked));
	} finally { await f.dispose(); }
});

test('replacement, disabled props, noncurrent ownership and unmount fence retained actions and Close', async () => {
	const f = await fixture();
	let staleApply: ((...args: unknown[]) => unknown) | undefined, staleClose: ((...args: unknown[]) => unknown) | undefined;
	try {
		staleApply = reactProps(f.button(f.text.apply)).onClick; staleClose = reactProps(f.button(f.text.close)).onClick;
		const staleDuplicate = reactProps(f.button(f.text.duplicate)).onClick;
		await f.replace(normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [rectangleGraph()], maskBindings: [] }));
		await act(async () => { staleApply?.({}); staleClose?.({}); staleDuplicate?.({}); }); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
		await f.replace(recipe(), true); await f.click(f.text.apply); await f.click(f.text.duplicate); await f.click(f.text.remove); assert.equal(f.applied.length, 0);
		await f.replace(recipe()); f.retire(); await f.click(f.text.apply); await f.click(f.text.close); assert.equal(f.closed(), 0);
	} finally { await f.dispose(); }
	await act(async () => { staleApply?.({}); staleClose?.({}); }); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
});

test('Close synchronously retires retained action callbacks and can only dismiss once', async () => {
	const f = await fixture();
	try {
		const apply = reactProps(f.button(f.text.apply)).onClick, duplicate = reactProps(f.button(f.text.duplicate)).onClick, close = reactProps(f.button(f.text.close)).onClick;
		const count = f.control(f.text.mask).options.length;
		await act(async () => { close?.({}); apply?.({}); duplicate?.({}); close?.({}); });
		assert.equal(f.closed(), 1); assert.equal(f.applied.length, 0); assert.equal(f.control(f.text.mask).options.length, count);
	} finally { await f.dispose(); }
});

test('StrictMode layout replay restores live manager actions without restoring actions retired by Close', async () => {
	const initial = recipe(), f = await fixture('en', initial, true);
	try {
		await f.change(f.text.mask, 'brush'); await f.click(f.text.duplicate);
		assert.equal(f.control(f.text.mask).options.length, initial.masks.length + 1);
		const duplicateId = f.value(f.text.mask); assert.ok(!initial.masks.some(mask => mask.id === duplicateId));
		await f.bind('warm', true); await f.click(f.text.apply); assert.equal(f.applied.length, 1);
		assert.deepEqual(f.applied[0]!.value.maskBindings.find(binding => binding.effectId === 'warm'), { effectId: 'warm', maskId: duplicateId });
		const apply = reactProps(f.button(f.text.apply)).onClick, close = reactProps(f.button(f.text.close)).onClick;
		await act(async () => { close?.({}); apply?.({}); close?.({}); });
		assert.equal(f.closed(), 1); assert.equal(f.applied.length, 1);
	} finally { await f.dispose(); }
});

function nameCopy(locale = 'en') {
	return locale === 'de' ? { name: 'Maskenname', rename: 'Maske umbenennen' } : { name: 'Mask name', rename: 'Rename mask' };
}
function graphName(value: PhotoLibraryDevelopSettingsV2['masks'][number]): unknown {
	return Object.getOwnPropertyDescriptor(value, 'name')?.value as unknown;
}

for (const locale of ['en', 'de']) test(`${locale}: explicit Rename keeps a canonical name local until Apply and preserves the exact graph identity`, async () => {
	const initial = recipe(), wire = JSON.stringify(initial), f = await fixture(locale, initial), names = nameCopy(locale);
	try {
		await f.change(f.text.mask, 'brush'); const field = f.control(names.name);
		assert.equal(field.type, 'text'); assert.equal(f.value(names.name), '');
		assert.equal(Object.getOwnPropertyDescriptor(reactProps(field), 'maxLength')?.value, 256);
		field.focus(); assert.equal(document.activeElement, field); assert.equal(f.button(names.rename).type, 'button');
		await f.change(names.name, '  Cafe\u0301  '); assert.equal(f.applied.length, 0);
		await f.click(f.text.apply); assert.deepEqual(f.applied[0]!.value, initial, 'Typing alone does not rename the graph.');
		await f.click(names.rename); assert.equal(f.applied.length, 1);
		assert.equal(f.value(names.name), 'Café');
		assert.equal(f.control(f.text.mask).options.find(option => option.value === 'brush')!.textContent, 'Café (brush)');
		await f.click(f.text.apply); const renamed = f.applied[1]!.value, graph = renamed.masks.find(mask => mask.id === 'brush')!;
		assert.equal(renamed.processVersion, 2); assert.deepEqual(graph, { ...initial.masks.find(mask => mask.id === 'brush'), schemaVersion: 2, name: 'Café' });
		assert.deepEqual(renamed.maskBindings, initial.maskBindings); assert.deepEqual(renamed.effects, initial.effects);
		assert.deepEqual(renamed.masks.filter(mask => mask.id !== 'brush'), initial.masks.filter(mask => mask.id !== 'brush'));
		assert.equal(JSON.stringify(initial), wire);
	} finally { await f.dispose(); }
});

test('named duplicate inherits its label unbound; blank Rename clears only the copy to exact Graph1 without downgrading process2', async () => {
	const initial = recipe(), f = await fixture('en', initial), names = nameCopy();
	try {
		await f.change(f.text.mask, 'composed'); await f.change(names.name, 'Sky'); await f.click(names.rename);
		await f.click(f.text.duplicate); const copyId = f.value(f.text.mask);
		assert.equal(f.value(names.name), 'Sky'); assert.ok(f.binds().every(field => !field.checked));
		assert.equal(f.control(f.text.mask).options.find(option => option.value === copyId)!.textContent, `Sky (${copyId})`);
		await f.change(names.name, ' \t '); await f.click(names.rename); assert.equal(f.value(names.name), '');
		assert.equal(f.control(f.text.mask).options.find(option => option.value === copyId)!.textContent, copyId);
		await f.click(f.text.apply); const value = f.applied[0]!.value, original = initial.masks.find(mask => mask.id === 'composed')!;
		assert.equal(value.processVersion, 2); assert.deepEqual(value.masks.find(mask => mask.id === copyId), { ...original, id: copyId });
		assert.deepEqual(value.masks.find(mask => mask.id === 'composed'), { ...original, schemaVersion: 2, name: 'Sky' });
		assert.deepEqual(value.maskBindings, initial.maskBindings);
	} finally { await f.dispose(); }
});

test('legacy process1 renaming explicitly upgrades to process2, while Close discards that local upgrade', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), processVersion: 1 }), f = await fixture('en', initial), names = nameCopy();
	try {
		await f.change(f.text.mask, 'rectangle'); await f.change(names.name, 'Foreground'); await f.click(names.rename);
		await f.click(f.text.close); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 1); assert.equal(initial.processVersion, 1);
	} finally { await f.dispose(); }
	const reopened = await fixture('en', initial);
	try {
		await reopened.change(reopened.text.mask, 'rectangle'); await reopened.change(names.name, 'Foreground'); await reopened.click(names.rename);
		await reopened.click(reopened.text.apply); assert.equal(reopened.applied[0]!.value.processVersion, 2);
		assert.equal(graphName(reopened.applied[0]!.value.masks.find(mask => mask.id === 'rectangle')!), 'Foreground');
	} finally { await reopened.dispose(); }
});

test('invalid names cannot change the local graph and a corrected buffer remains usable', async () => {
	const initial = recipe(), f = await fixture('en', initial), names = nameCopy();
	try {
		await f.change(f.text.mask, 'linear');
		for (const name of ['x'.repeat(257), 'line\nbreak', 'nul\u0000name', '\uD800', '\uDC00']) {
			await f.change(names.name, name); await f.click(names.rename); assert.ok(f.dom.one('[role="alert"]').textContent);
			assert.equal(f.control(f.text.mask).options.find(option => option.value === 'linear')!.textContent, 'linear');
			assert.equal(f.applied.length, 0);
		}
		await f.change(names.name, 'Valid name'); await f.click(names.rename); await f.click(f.text.apply);
		assert.equal(graphName(f.applied[0]!.value.masks.find(mask => mask.id === 'linear')!), 'Valid name'); assert.deepEqual(initial, recipe());
	} finally { await f.dispose(); }
});

test('retained Rename and name input handlers reject old forms, recipe replacement, disability, Close and unmount before reading stale events', async () => {
	const f = await fixture(), names = nameCopy();
	let rename: ((...args: unknown[]) => unknown) | undefined, change: ((...args: unknown[]) => unknown) | undefined;
	try {
		await f.change(names.name, 'Pending'); rename = reactProps(f.button(names.rename)).onClick; change = reactProps(f.control(names.name)).onChange;
		await f.change(f.text.mask, 'linear'); let reads = 0;
		const event = { currentTarget: Object.defineProperty({}, 'value', { get() { reads++; return 'Stale'; } }) };
		await act(async () => { rename?.({}); change?.(event); }); assert.equal(reads, 0); assert.equal(f.value(names.name), '');
		const oldRename = reactProps(f.button(names.rename)).onClick;
		await f.replace(recipe()); await act(async () => { oldRename?.({}); }); assert.equal(f.applied.length, 0);
		await f.replace(recipe(), true); await f.change(names.name, 'Disabled'); await f.click(names.rename); assert.equal(f.value(names.name), '');
		await f.replace(recipe()); await f.change(names.name, 'Closing'); rename = reactProps(f.button(names.rename)).onClick;
		await f.click(f.text.close); await act(async () => { rename?.({}); }); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 1);
	} finally { await f.dispose(); }
	await act(async () => { rename?.({}); change?.({ currentTarget: { value: 'Unmounted' } }); }); assert.equal(f.applied.length, 0);
});
