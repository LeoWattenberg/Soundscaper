/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopGradientDialogV1, { type PhotoDevelopGradientDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopGradientDialogV1.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { normalizeImageDevelopStateV1OrV2, defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { gradientGraph, rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';

function recipe() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('white-balance-v1', { id: 'warm' }),
		createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 50 } }),
		createVideoEffect('develop-geometry-v1', { id: 'geometry' }),
	] });
}
function radial() {
	return { schemaVersion: 1, id: 'mask', kind: 'matte', inputs: [], nodes: [
		{ id: 'radial', kind: 'radial-gradient', center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.25 }, innerFraction: 0.25 },
	], outputNodeId: 'radial' };
}
async function fixture(locale = 'en', initial = recipe()) {
	let develop = initial, current = true, disabled = false, closed = 0;
	let kind: 'linear-gradient' | 'radial-gradient' = 'radial-gradient';
	const applied: Readonly<{ value: PhotoDevelopGradientDialogPropsV1['develop']; overlay: Parameters<PhotoDevelopGradientDialogPropsV1['onApply']>[1] }>[] = [];
	let renderedProps: PhotoDevelopGradientDialogPropsV1;
	const onApply: PhotoDevelopGradientDialogPropsV1['onApply'] = function (this: unknown, value, overlay) {
		assert.equal(this, renderedProps); applied.push({ value, overlay });
	};
	const mounted = await mountPhotoImportUi(() => {
		const element = <PhotoDevelopGradientDialogV1 key={kind} kind={kind} develop={develop} locale={locale} disabled={disabled}
			isCurrent={() => current} onApply={onApply} onClose={() => { closed++; }} />;
		renderedProps = element.props; return element;
	});
	const text = photoDevelopLocalAdjustmentsCopy(locale, 'radial-gradient');
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
		async replace(value: typeof develop, nextDisabled = false) { develop = value; disabled = nextDisabled; await mounted.render(); },
		async replaceKind(value: typeof kind) { kind = value; await mounted.render(); },
	};
}

for (const locale of ['en', 'de']) test(`${locale}: radial fields are accessible and bind multiple actual nongeometry effects with independent coverage`, async () => {
	const f = await fixture(locale), before = JSON.stringify(recipe());
	try {
		assert.equal(f.control(f.text.gradient).value, ''); assert.equal(f.binds().length, 2); assert.equal(f.enabled().length, 2);
		assert.equal(f.control(f.text.showOverlay).checked, false);
		for (const [label, expected] of [[f.text.centerX, '0.5'], [f.text.centerY, '0.5'], [f.text.radiusX, '0.5'], [f.text.radiusY, '0.5'], [f.text.innerFraction, '0']] as const) {
			const field = f.control(label); assert.equal(field.type, 'number'); assert.equal(field.getAttribute('step'), 'any'); assert.equal(field.value, expected);
			field.focus(); assert.equal(document.activeElement, field);
		}
		assert.equal(f.button(f.text.apply).tagName, 'BUTTON'); assert.equal(f.button(f.text.apply).type, 'button');
		for (const field of f.binds()) await f.change(field.getAttribute('aria-label')!, true);
		await f.change(f.enabled()[0]!.getAttribute('aria-label')!, false); await f.change(f.enabled()[1]!.getAttribute('aria-label')!, true);
		await f.change(f.text.innerFraction, '0.5'); await f.click(f.text.apply);
		assert.equal(f.applied.length, 1); const { value, overlay } = f.applied[0]!, mask = value.masks[0]!;
		assert.equal(overlay, null); assert.deepEqual(value.maskBindings, [{ effectId: 'detail', maskId: mask.id }, { effectId: 'warm', maskId: mask.id }]);
		assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 5, 1)], [102, 255, 255, 255, 102]);
		assert.deepEqual(value.effects.map(effect => [effect.id, effect.enabled]), [['warm', false], ['detail', true], ['geometry', true]]);
		assert.equal(JSON.stringify(recipe()), before);
	} finally { await f.dispose(); }
});

test('retained radial matte editing preserves kind, graph/node identity and unrelated linear/rectangle masks', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [radial(), { ...gradientGraph(), id: 'linear' }, { ...rectangleGraph(), id: 'rectangle' }],
		maskBindings: [{ effectId: 'warm', maskId: 'mask' }, { effectId: 'detail', maskId: 'linear' }] });
	const f = await fixture('en', initial), wire = JSON.stringify(initial);
	try {
		assert.deepEqual(f.control(f.text.gradient).options.map(option => option.value), ['', 'mask']);
		await f.change(f.text.gradient, 'mask');
		assert.equal(f.control(f.text.radiusY).value, '0.25'); assert.equal(f.control(f.text.innerFraction).value, '0.25');
		await f.change(f.text.radiusX, '0.4'); await f.change(f.text.innerFraction, '0'); await f.click(f.text.apply);
		assert.equal(f.applied.length, 1); const edited = f.applied[0]!.value, mask = edited.masks.find(value => value.id === 'mask')!;
		assert.equal(mask.kind, 'matte'); assert.equal(mask.outputNodeId, 'radial');
		assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 5, 1)], [0, 128, 255, 128, 0]);
		for (const id of ['linear', 'rectangle']) assert.deepEqual(edited.masks.find(value => value.id === id), initial.masks.find(value => value.id === id));
		assert.equal(JSON.stringify(initial), wire);
		await f.click(f.text.remove); assert.equal(f.applied.length, 2);
		assert.deepEqual(f.applied[1]!.value.masks.map(value => value.id), ['linear', 'rectangle']);
		assert.deepEqual(f.applied[1]!.value.maskBindings, [{ effectId: 'detail', maskId: 'linear' }]);
	} finally { await f.dispose(); }
});

test('radial overlay starts off and requires an explicit bound effect even for a single selection', async () => {
	const f = await fixture();
	try {
		await f.change(f.binds()[0]!.getAttribute('aria-label')!, true); await f.change(f.text.showOverlay, true);
		assert.equal(f.control(f.text.overlayEffect).value, ''); await f.click(f.text.apply);
		assert.equal(f.applied.length, 0); assert.equal(f.dom.one('[role="alert"]').textContent, f.text.invalid);
		await f.change(f.text.overlayEffect, 'warm'); await f.click(f.text.apply);
		assert.deepEqual(f.applied[0]!.overlay, { maskId: f.applied[0]!.value.masks[0]!.id, effectId: 'warm' });
	} finally { await f.dispose(); }
});

test('unbound, nonfinite/out-of-bounds center, nonpositive radii and invalid falloff cannot publish a radial draft', async () => {
	const f = await fixture();
	try {
		await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		await f.change(f.binds()[0]!.getAttribute('aria-label')!, true);
		for (const [label, bad, good] of [[f.text.centerX, '1000001', '0.5'], [f.text.centerY, 'Infinity', '0.5'], [f.text.radiusX, '0', '0.5'],
			[f.text.radiusY, '-1', '0.5'], [f.text.radiusX, 'NaN', '0.5'], [f.text.innerFraction, '1', '0'], [f.text.innerFraction, '-0.1', '0'], [f.text.innerFraction, '', '0']] as const) {
			await f.change(label, bad); await f.click(f.text.apply); assert.equal(f.applied.length, 0);
			assert.equal(f.dom.one('[role="alert"]').textContent, f.text.invalid); await f.change(label, good);
		}
		await f.click(f.text.apply); assert.equal(f.applied.length, 1);
	} finally { await f.dispose(); }
});

test('radial callbacks captured before replacement, disability, retirement or unmount cannot affect a newer presentation', async () => {
	const f = await fixture();
	let staleApply: ((...args: unknown[]) => unknown) | undefined, staleClose: ((...args: unknown[]) => unknown) | undefined;
	try {
		await f.change(f.binds()[0]!.getAttribute('aria-label')!, true);
		staleApply = reactProps(f.button(f.text.apply)).onClick; staleClose = reactProps(f.button(f.text.close)).onClick;
		await f.replace(recipe()); await act(async () => { staleApply?.({}); staleClose?.({}); });
		assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
		await f.replace(recipe(), true); await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		await f.replace(recipe()); f.retire(); await f.click(f.text.apply); await f.click(f.text.close);
		assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
	} finally { await f.dispose(); }
	await act(async () => { staleApply?.({}); staleClose?.({}); }); assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
});

test('a retained ID changing graph kind cannot be rewritten or removed by radial actions, and kind-remount retires prior callbacks', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [radial()], maskBindings: [{ effectId: 'warm', maskId: 'mask' }] });
	const f = await fixture('en', initial);
	try {
		await f.change(f.text.gradient, 'mask');
		const staleApply = reactProps(f.button(f.text.apply)).onClick, staleClose = reactProps(f.button(f.text.close)).onClick;
		const replacement = normalizeImageDevelopStateV1OrV2({ ...initial, masks: [gradientGraph()] }), wire = JSON.stringify(replacement);
		await f.replace(replacement); await f.click(f.text.apply); await f.click(f.text.remove);
		assert.equal(f.applied.length, 0); assert.equal(JSON.stringify(replacement), wire);
		await f.replaceKind('linear-gradient');
		await act(async () => { staleApply?.({}); staleClose?.({}); });
		assert.equal(f.applied.length, 0); assert.equal(f.closed(), 0);
		const linear = photoDevelopLocalAdjustmentsCopy('en');
		assert.equal(f.control(linear.startX).value, '0');
		assert.equal(f.dom.container.querySelectorAll('input').some(node => node.getAttribute('aria-label') === f.text.centerX), false);
		await f.click(f.text.close); assert.equal(f.closed(), 1);
	} finally { await f.dispose(); }
});
