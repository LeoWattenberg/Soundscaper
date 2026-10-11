/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopLinearGradientDialogV1, { type PhotoDevelopLinearGradientDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopLinearGradientDialogV1.tsx';
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
async function fixture(locale = 'en', initial = recipe()) {
	let develop = initial, current = true, disabled = false, closed = 0;
	const applied: Readonly<{ value: PhotoDevelopLinearGradientDialogPropsV1['develop']; overlay: Parameters<PhotoDevelopLinearGradientDialogPropsV1['onApply']>[1] }>[] = [];
	let renderedProps: PhotoDevelopLinearGradientDialogPropsV1;
	const onApply: PhotoDevelopLinearGradientDialogPropsV1['onApply'] = function (this: unknown, value, overlay) {
		assert.equal(this, renderedProps); applied.push({ value, overlay });
	};
	const mounted = await mountPhotoImportUi(() => {
		const element = <PhotoDevelopLinearGradientDialogV1 develop={develop} locale={locale} disabled={disabled}
			isCurrent={() => current} onApply={onApply} onClose={() => { closed++; }} />;
		renderedProps = element.props; return element;
	});
	const text = photoDevelopLocalAdjustmentsCopy(locale);
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
	};
}

for (const locale of ['en', 'de']) test(`${locale}: accessible gradient fields bind multiple actual effects and change their enabled flags without binding geometry`, async () => {
	const f = await fixture(locale), before = JSON.stringify(recipe());
	try {
		assert.equal(f.binds().length, 2); assert.equal(f.enabled().length, 2);
		assert.equal(f.control(f.text.showOverlay).checked, false);
		for (const label of [f.text.startX, f.text.startY, f.text.endX, f.text.endY]) {
			const field = f.control(label); assert.equal(field.type, 'number'); assert.equal(field.getAttribute('step'), 'any');
			field.focus(); assert.equal(document.activeElement, field);
		}
		assert.equal(f.button(f.text.apply).tagName, 'BUTTON'); assert.equal(f.button(f.text.apply).type, 'button');
		for (const field of f.binds()) await f.change(field.getAttribute('aria-label')!, true);
		await f.change(f.enabled()[0]!.getAttribute('aria-label')!, false); await f.change(f.enabled()[1]!.getAttribute('aria-label')!, true);
		await f.change(f.text.startX, '0.25'); await f.change(f.text.endX, '0.75'); await f.click(f.text.apply);
		assert.equal(f.applied.length, 1); const { value, overlay } = f.applied[0]!, mask = value.masks[0]!;
		assert.equal(overlay, null); assert.deepEqual(value.maskBindings, [{ effectId: 'detail', maskId: mask.id }, { effectId: 'warm', maskId: mask.id }]);
		assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 4, 1)], [0, 64, 191, 255]);
		assert.deepEqual(value.effects.map(effect => [effect.id, effect.enabled]), [['warm', false], ['detail', true], ['geometry', true]]);
		assert.equal(JSON.stringify(recipe()), before);
	} finally { await f.dispose(); }
});

test('editing a retained matte gradient keeps its kind, identities and unrelated mask body, then removal prunes only its bindings', async () => {
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [{ ...gradientGraph(), kind: 'matte' }, { ...rectangleGraph(), id: 'other' }], maskBindings: [{ effectId: 'warm', maskId: 'mask' }] });
	const f = await fixture('en', initial), wire = JSON.stringify(initial);
	try {
		await f.change(f.text.gradient, 'mask'); assert.equal(f.control(f.text.endX).value, '1');
		await f.change(f.text.startX, '1'); await f.change(f.text.endX, '0'); await f.click(f.text.apply);
		const edited = f.applied[0]!.value, mask = edited.masks.find(value => value.id === 'mask')!;
		assert.equal(mask.kind, 'matte');
		assert.equal(mask.outputNodeId, 'gradient'); assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 4, 1)], [223, 159, 96, 32]);
		assert.deepEqual(edited.masks.find(value => value.id === 'other'), initial.masks.find(value => value.id === 'other'));
		assert.equal(JSON.stringify(initial), wire);
		await f.click(f.text.remove); assert.equal(f.applied.length, 2);
		assert.deepEqual(f.applied[1]!.value.masks.map(value => value.id), ['other']); assert.deepEqual(f.applied[1]!.value.maskBindings, []);
	} finally { await f.dispose(); }
});

test('showing an overlay requires an explicit bound effect choice even when only one effect is selected', async () => {
	const f = await fixture();
	try {
		await f.change(f.binds()[0]!.getAttribute('aria-label')!, true); await f.change(f.text.showOverlay, true);
		assert.equal(f.control(f.text.overlayEffect).value, ''); await f.click(f.text.apply);
		assert.equal(f.applied.length, 0); assert.equal(f.dom.one('[role="alert"]').textContent, f.text.invalid);
		await f.change(f.text.overlayEffect, 'warm'); await f.click(f.text.apply);
		assert.deepEqual(f.applied[0]!.overlay, { maskId: f.applied[0]!.value.masks[0]!.id, effectId: 'warm' });
	} finally { await f.dispose(); }
});

test('empty selection, coincident endpoints and nonfinite or out-of-bounds numbers refuse without publishing a draft', async () => {
	const f = await fixture();
	try {
		await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		await f.change(f.binds()[0]!.getAttribute('aria-label')!, true);
		for (const value of ['0', '', 'NaN', 'Infinity', '1000001']) {
			await f.change(f.text.endX, value); await f.click(f.text.apply);
			assert.equal(f.applied.length, 0); assert.equal(f.dom.one('[role="alert"]').textContent, f.text.invalid);
		}
		await f.change(f.text.endX, '1'); await f.click(f.text.apply); assert.equal(f.applied.length, 1);
	} finally { await f.dispose(); }
});

test('replaced, disabled, retired and unmounted presentation callbacks cannot apply or dismiss a new owner', async () => {
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
