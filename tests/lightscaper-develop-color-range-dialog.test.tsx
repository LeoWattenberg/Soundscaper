/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopRangeMaskDialogV1, { type PhotoDevelopRangeMaskDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopRangeMaskDialogV1.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { normalizeImageDevelopStateV1OrV2, defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { gradientGraph, rectangleGraph, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

type ColorProps = PhotoDevelopRangeMaskDialogPropsV1 & Readonly<{ kind: 'color-range' | 'luminance-range' }>;
function recipe() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('white-balance-v1', { id: 'warm' }),
		createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 50 } }),
		createVideoEffect('develop-geometry-v1', { id: 'geometry' }),
	] });
}
function range() {
	return { schemaVersion: 1, id: 'mask', kind: 'matte', inputs: [],
		nodes: [{ id: 'range', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 1 }], outputNodeId: 'range' };
}
async function fixture(locale = 'en', initial = recipe()) {
	let develop = initial, current = true, disabled = false, closed = 0, kind: ColorProps['kind'] = 'color-range';
	const applied: Readonly<{ value: PhotoDevelopRangeMaskDialogPropsV1['develop']; overlay: Parameters<PhotoDevelopRangeMaskDialogPropsV1['onApply']>[1] }>[] = [];
	let renderedProps: ColorProps;
	const onApply: PhotoDevelopRangeMaskDialogPropsV1['onApply'] = function (this: unknown, value, overlay) {
		assert.equal(this, renderedProps); applied.push({ value, overlay });
	};
	const mounted = await mountPhotoImportUi(() => {
		const props: ColorProps = { develop, locale, disabled, kind, isCurrent: () => current, onApply, onClose: () => { closed++; } };
		const element = <PhotoDevelopRangeMaskDialogV1 {...props} />;
		renderedProps = element.props; return element;
	});
	const text = { ...photoDevelopLocalAdjustmentsCopy(locale, 'luminance-range'),
		red: locale === 'de' ? 'Rot' : 'Red', green: locale === 'de' ? 'Grün' : 'Green', blue: locale === 'de' ? 'Blau' : 'Blue',
		radius: locale === 'de' ? 'Farbradius' : 'Color radius' };
	const control = (label: string) => {
		const found = mounted.dom.container.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label);
		assert.ok(found, label); return found;
	};
	const change = async (label: string, value: string | boolean) => {
		await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: typeof value === 'boolean' ? { checked: value } : { value } }); });
	};
	const button = (label: string) => {
		const found = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(found, label); return found;
	};
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); }); };
	const binds = () => mounted.dom.container.querySelectorAll('input').filter(node => node.getAttribute('aria-label')?.startsWith(`${text.bind}: `));
	const enabled = () => mounted.dom.container.querySelectorAll('input').filter(node => node.getAttribute('aria-label')?.startsWith(`${text.effectEnabled}: `));
	return { ...mounted, text, applied, control, change, button, click, binds, enabled,
		retire() { current = false; }, closed: () => closed,
		async replace(value: typeof develop, nextDisabled = false, nextKind: ColorProps['kind'] = kind) { develop = value; disabled = nextDisabled; kind = nextKind; await mounted.render(); },
	};
}

for (const locale of ['en', 'de']) test(`${locale}: color fields are accessible, bind actual effects and preserve enabled flags without binding geometry`, async () => {
	const f = await fixture(locale), before = JSON.stringify(recipe());
	try {
		assert.equal(f.control(f.text.gradient).value, ''); assert.equal(f.binds().length, 2); assert.equal(f.enabled().length, 2);
		assert.equal(f.control(f.text.showOverlay).checked, false);
		for (const [label, expected] of [[f.text.red, '1'], [f.text.green, '0'], [f.text.blue, '0'], [f.text.radius, '0.1'], [f.text.falloff, '0.1']] as const) {
			const field = f.control(label); assert.equal(field.type, 'number'); assert.equal(field.getAttribute('step'), 'any');
			assert.equal(field.getAttribute('min'), '0'); assert.equal(field.getAttribute('max'), '1'); assert.equal(field.value, expected);
			field.focus(); assert.equal(document.activeElement, field);
		}
		assert.equal(f.button(f.text.apply).type, 'button');
		for (const field of f.binds()) await f.change(field.getAttribute('aria-label')!, true);
		await f.change(f.enabled()[0]!.getAttribute('aria-label')!, false); await f.change(f.enabled()[1]!.getAttribute('aria-label')!, true);
		await f.change(f.text.radius, '0'); await f.change(f.text.falloff, '1'); await f.click(f.text.apply);
		assert.equal(f.applied.length, 1); const { value, overlay } = f.applied[0]!, mask = value.masks[0]!;
		assert.equal(overlay, null); assert.deepEqual(value.maskBindings, [{ effectId: 'detail', maskId: mask.id }, { effectId: 'warm', maskId: mask.id }]);
		assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 2, 1, new Map(), rgbaFrame([255, 0, 0, 255, 0, 0, 255, 255]))], [255, 47]);
		assert.deepEqual(value.effects.map(effect => [effect.id, effect.enabled]), [['warm', false], ['detail', true], ['geometry', true]]);
		assert.equal(JSON.stringify(recipe()), before);
	} finally { await f.dispose(); }
});

test('retained color matte editing preserves IDs and unrelated gradients, and removal prunes only its own binding', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [range(), { ...gradientGraph(), id: 'linear' }, { ...rectangleGraph(), id: 'rectangle' }],
		maskBindings: [{ effectId: 'warm', maskId: 'mask' }, { effectId: 'detail', maskId: 'linear' }] });
	const f = await fixture('en', initial), wire = JSON.stringify(initial);
	try {
		assert.deepEqual(f.control(f.text.gradient).options.map(option => option.value), ['', 'mask']);
		await f.change(f.text.gradient, 'mask'); assert.equal(f.control(f.text.red).value, '1'); assert.equal(f.control(f.text.radius).value, '0'); assert.equal(f.control(f.text.falloff).value, '1');
		await f.change(f.text.red, '0'); await f.change(f.text.radius, '1'); await f.change(f.text.falloff, '0'); await f.click(f.text.apply);
		const edited = f.applied[0]!.value, mask = edited.masks.find(value => value.id === 'mask')!;
		assert.equal(mask.kind, 'matte'); assert.equal(mask.outputNodeId, 'range');
		assert.deepEqual(mask.nodes, [{ id: 'range', kind: 'color-range', color: { r: 0, g: 0, b: 0 }, radius: 1, falloff: 0 }]);
		for (const id of ['linear', 'rectangle']) assert.deepEqual(edited.masks.find(value => value.id === id), initial.masks.find(value => value.id === id));
		assert.equal(JSON.stringify(initial), wire);
		await f.click(f.text.remove); assert.equal(f.applied.length, 2); assert.deepEqual(f.applied[1]!.value.masks.map(value => value.id), ['linear', 'rectangle']);
		assert.deepEqual(f.applied[1]!.value.maskBindings, [{ effectId: 'detail', maskId: 'linear' }]);
	} finally { await f.dispose(); }
});

test('color overlay requires an explicit bound effect and invalid fractions cannot publish', async () => {
	const f = await fixture();
	try {
		await f.click(f.text.apply); assert.equal(f.applied.length, 0); await f.change(f.binds()[0]!.getAttribute('aria-label')!, true);
		for (const [label, bad, good] of [[f.text.red, '2', '1'], [f.text.green, 'NaN', '0'], [f.text.blue, '-0.1', '0'],
			[f.text.radius, '-0', '0.1'], [f.text.radius, '-0.1', '0.1'], [f.text.radius, '1.1', '0.1'], [f.text.falloff, '', '0.1']] as const) {
			await f.change(label, bad); await f.click(f.text.apply); assert.equal(f.applied.length, 0);
			assert.ok(f.dom.one('[role="alert"]').textContent); await f.change(label, good);
		}
		await f.change(f.text.showOverlay, true); assert.equal(f.control(f.text.overlayEffect).value, '');
		await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		await f.change(f.text.overlayEffect, 'warm'); await f.click(f.text.apply);
		assert.deepEqual(f.applied[0]!.overlay, { maskId: f.applied[0]!.value.masks[0]!.id, effectId: 'warm' });
	} finally { await f.dispose(); }
});

test('wrong-kind replacement and disabled, retired or unmounted callbacks cannot edit or dismiss another owner', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [range()], maskBindings: [{ effectId: 'warm', maskId: 'mask' }] });
	const f = await fixture('en', initial); let staleApply: ((...args: unknown[]) => unknown) | undefined, staleClose: ((...args: unknown[]) => unknown) | undefined;
	try {
		await f.change(f.text.gradient, 'mask'); staleApply = reactProps(f.button(f.text.apply)).onClick; staleClose = reactProps(f.button(f.text.close)).onClick;
		const replacement = normalizeImageDevelopStateV1OrV2({ ...initial, masks: [gradientGraph()] }), wire = JSON.stringify(replacement);
		await f.replace(replacement); await f.click(f.text.apply); await f.click(f.text.remove); assert.equal(f.applied.length, 0); assert.equal(JSON.stringify(replacement), wire);
		await act(async () => { staleApply?.({}); staleClose?.({}); }); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
		await f.replace(initial, true); await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		await f.replace(initial); f.retire(); await f.click(f.text.apply); await f.click(f.text.close); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
	} finally { await f.dispose(); }
	await act(async () => { staleApply?.({}); staleClose?.({}); }); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
});

test('changing the offered range kind retires old color callbacks and cannot replace or remove a retained color matte', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [range()], maskBindings: [{ effectId: 'warm', maskId: 'mask' }] });
	const f = await fixture('en', initial), wire = JSON.stringify(initial);
	try {
		await f.change(f.text.gradient, 'mask');
		const oldApply = reactProps(f.button(f.text.apply)).onClick, oldRemove = reactProps(f.button(f.text.remove)).onClick;
		await f.replace(initial, false, 'luminance-range');
		await act(async () => { oldApply?.({}); oldRemove?.({}); }); await f.click(f.text.apply); await f.click(f.text.remove);
		assert.equal(f.applied.length, 0); assert.equal(JSON.stringify(initial), wire);
		await f.change(f.text.gradient, '');
		assert.equal(f.control(f.text.lower).value, '0'); assert.equal(f.control(f.text.upper).value, '1'); assert.equal(f.control(f.text.falloff).value, '0');
		await f.change(f.binds()[1]!.getAttribute('aria-label')!, true); await f.click(f.text.apply);
		assert.equal(f.applied.length, 1);
		assert.deepEqual(f.applied[0]!.value.masks.find(mask => mask.id === 'mask'), initial.masks[0]);
		assert.ok(f.applied[0]!.value.masks.some(mask => mask.id !== 'mask' && mask.nodes[0]?.kind === 'luminance-range'));
	} finally { await f.dispose(); }
});
