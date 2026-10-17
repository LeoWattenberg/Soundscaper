/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopMaskManagerV1, { type PhotoDevelopMaskManagerPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopMaskManagerV1.tsx';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { videoMaskMatteGraphComputationV1 } from '../src/common/editor/video-mask-matte-name-v2.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

type Operation = 'union' | 'subtract' | 'intersect';
const BRUSH = `brush-mask-v1:2:2:${'a'.repeat(64)}`;
function rectangle(id: string, name: string, x: number) {
	return { schemaVersion: 2, id, name, kind: 'matte', inputs: [], nodes: [
		{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x, y: 0, width: 0.75, height: 1 },
	], outputNodeId: 'shape' };
}
function recipe(): PhotoLibraryDevelopSettingsV2 {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }),
		createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 50 } }),
	], masks: [rectangle('selected', 'Foreground', 0), rectangle('operand', 'Other', 0.25),
		{ schemaVersion: 2, id: 'brush', name: 'Paint', kind: 'mask', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: BRUSH }],
			nodes: [{ id: 'paint-node', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint-node' },
	], maskBindings: [{ effectId: 'tone', maskId: 'selected' }, { effectId: 'detail', maskId: 'operand' }] });
}
function compositionCopy(locale = 'en') {
	return locale === 'de' ? {
		operand: 'Mit Maske kombinieren', chooseOperand: 'Maske auswählen', union: 'Maske addieren', subtract: 'Maske subtrahieren', intersect: 'Schnittmenge bilden',
		help: 'Die ausgewählte Maske mit einer anderen kombinieren. Subtrahieren entfernt die Abdeckung der anderen Maske. Änderungen bleiben bis zum Anwenden lokal.',
	} : {
		operand: 'Combine with mask', chooseOperand: 'Choose a mask', union: 'Add mask', subtract: 'Subtract mask', intersect: 'Intersect masks',
		help: 'Combine the selected mask with another mask. Subtract removes the other mask’s coverage. Changes remain local until Apply.',
	};
}

async function fixture(locale = 'en', initial = recipe(), strict = false) {
	let develop = initial, disabled = false, current = true, closed = 0;
	let renderedProps: PhotoDevelopMaskManagerPropsV1;
	const applied: Array<{ value: PhotoLibraryDevelopSettingsV2; overlay: Parameters<PhotoDevelopMaskManagerPropsV1['onApply']>[1] }> = [];
	const onApply: PhotoDevelopMaskManagerPropsV1['onApply'] = function (this: PhotoDevelopMaskManagerPropsV1, value, overlay) {
		assert.equal(this, renderedProps); applied.push({ value: normalizeImageDevelopStateV1OrV2(value), overlay });
	};
	const mounted = await mountPhotoImportUi(() => {
		const element = <PhotoDevelopMaskManagerV1 develop={develop} locale={locale} disabled={disabled} isCurrent={() => current}
			onApply={onApply} onClose={function (this: PhotoDevelopMaskManagerPropsV1) { assert.equal(this, renderedProps); closed++; }} />;
		renderedProps = element.props; return strict ? <StrictMode>{element}</StrictMode> : element;
	});
	const text = photoDevelopMaskManagementCopy(locale), composition = compositionCopy(locale);
	const control = (label: string) => {
		const field = mounted.dom.container.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label);
		assert.ok(field, label); return field;
	};
	const value = (label: string) => {
		const raw = Object.getOwnPropertyDescriptor(reactProps(control(label)), 'value')?.value as unknown;
		assert.ok(typeof raw === 'string'); return raw;
	};
	const button = (label: string) => {
		const field = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(field, label); return field;
	};
	const change = async (label: string, raw: string | boolean) => {
		await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: typeof raw === 'boolean' ? { checked: raw } : { value: raw } }); });
	};
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); }); };
	return { ...mounted, text, composition, applied, control, value, button, change, click, closed: () => closed,
		retire() { current = false; },
		async replace(next: PhotoLibraryDevelopSettingsV2, nextDisabled = false) { develop = next; disabled = nextDisabled; await mounted.render(); },
	};
}

const GOLDEN: Readonly<Record<Operation, readonly number[]>> = Object.freeze({
	union: [255, 255, 255, 255], subtract: [255, 0, 0, 0], intersect: [0, 255, 255, 0],
});

for (const locale of ['en', 'de']) for (const operation of ['union', 'subtract', 'intersect'] as const) {
	test(`${locale}: ${operation} composes locally with exact coverage and preserves names, bindings, donor and pending raw name`, async () => {
		const initial = recipe(), wire = JSON.stringify(initial), f = await fixture(locale, initial);
		try {
			await f.change(f.text.mask, 'selected'); const operand = f.control(f.composition.operand);
			assert.equal(f.value(f.composition.operand), '');
			assert.deepEqual(operand.options.map(option => option.value), ['', 'brush', 'operand']);
			assert.deepEqual(operand.options.map(option => option.textContent), [f.composition.chooseOperand, 'Paint (brush)', 'Other (operand)']);
			assert.equal(f.button(f.composition[operation]).hasAttribute('disabled'), true);
			assert.equal(f.button(f.composition[operation]).type, 'button'); operand.focus(); assert.equal(document.activeElement, operand);
			assert.ok(f.dom.container.textContent.includes(f.composition.help));
			await f.change(f.text.name, '  Pending e\u0301  '); await f.change(f.text.showOverlay, true); await f.change(f.text.overlayEffect, 'tone');
			await f.change(f.composition.operand, 'operand'); await f.click(f.composition[operation]);
			assert.equal(f.applied.length, 0); assert.equal(f.value(f.text.mask), 'selected');
			assert.equal(f.value(f.text.name), '  Pending e\u0301  ', 'Composition cannot implicitly rename a graph.');
			assert.equal(f.control(f.text.mask).options.find(option => option.value === 'selected')!.textContent, 'Foreground (selected)');
			assert.equal(f.control(f.text.showOverlay).checked, true); assert.equal(f.value(f.text.overlayEffect), 'tone');
			await f.click(f.text.apply); assert.equal(f.applied.length, 1);
			const result = f.applied[0]!.value, selected = result.masks.find(mask => mask.id === 'selected')!;
			assert.deepEqual(f.applied[0]!.overlay, { maskId: 'selected', effectId: 'tone' });
			assert.equal(selected.schemaVersion, 2); if (selected.schemaVersion === 2) assert.equal(selected.name, 'Foreground');
			assert.equal(selected.kind, 'matte'); assert.equal(selected.id, 'selected');
			assert.deepEqual(selected.nodes.find(node => node.id === 'shape'), initial.masks.find(mask => mask.id === 'selected')!.nodes[0]);
			assert.deepEqual(result.masks.filter(mask => mask.id !== 'selected'), initial.masks.filter(mask => mask.id !== 'selected'));
			assert.deepEqual(result.effects, initial.effects); assert.deepEqual(result.geometry, initial.geometry); assert.deepEqual(result.maskBindings, initial.maskBindings);
			const plane = evaluateVideoMaskMatteRgbaV13(videoMaskMatteGraphComputationV1(selected), 4, 1);
			try { assert.deepEqual(Array.from(plane), GOLDEN[operation]); } finally { plane.fill(0); }
			assert.equal(JSON.stringify(initial), wire);
		} finally { await f.dispose(); }
	});
}

test('Close discards composition, while repeated operations accumulate only within the selected local graph', async () => {
	const initial = recipe(), f = await fixture('en', initial);
	try {
		await f.change(f.text.mask, 'selected'); await f.change(f.composition.operand, 'operand'); await f.click(f.composition.union);
		await f.click(f.composition.subtract); await f.click(f.text.close); assert.equal(f.closed(), 1); assert.equal(f.applied.length, 0); assert.deepEqual(initial, recipe());
	} finally { await f.dispose(); }
	const reopened = await fixture('en', initial);
	try {
		await reopened.change(reopened.text.mask, 'selected'); await reopened.change(reopened.composition.operand, 'operand');
		await reopened.click(reopened.composition.union); await reopened.click(reopened.composition.subtract); await reopened.click(reopened.text.apply);
		const selected = reopened.applied[0]!.value.masks.find(mask => mask.id === 'selected')!;
		const plane = evaluateVideoMaskMatteRgbaV13(videoMaskMatteGraphComputationV1(selected), 4, 1);
		try { assert.deepEqual(Array.from(plane), [255, 0, 0, 0]); } finally { plane.fill(0); }
		assert.deepEqual(reopened.applied[0]!.value.masks.filter(mask => mask.id !== 'selected'), initial.masks.filter(mask => mask.id !== 'selected'));
	} finally { await reopened.dispose(); }
});

test('missing, selected and stale operands cannot compose; one or zero graphs stay manageable', async () => {
	const f = await fixture();
	try {
		await f.change(f.text.mask, 'selected');
		for (const id of ['', 'selected', 'missing']) {
			await f.change(f.composition.operand, id); assert.equal(f.value(f.composition.operand), '');
			for (const operation of ['union', 'subtract', 'intersect'] as const) {
				assert.equal(f.button(f.composition[operation]).hasAttribute('disabled'), true); await f.click(f.composition[operation]);
			}
		}
		await f.change(f.composition.operand, 'operand'); await f.change(f.text.mask, 'operand');
		assert.equal(f.value(f.composition.operand), ''); assert.ok(!f.control(f.composition.operand).options.some(option => option.value === 'operand'));
		await f.click(f.text.apply); assert.deepEqual(f.applied[0]!.value, recipe());
		const single = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [rectangle('selected', 'Foreground', 0)], maskBindings: [] });
		await f.replace(single); assert.equal(f.control(f.composition.operand).hasAttribute('disabled'), true);
		assert.deepEqual(f.control(f.composition.operand).options.map(option => option.value), ['']);
		await f.click(f.composition.union); await f.click(f.text.remove); assert.equal(f.value(f.text.mask), '');
		await f.click(f.composition.subtract); await f.click(f.text.apply); assert.equal(f.applied.at(-1)!.value.masks.length, 0);
	} finally { await f.dispose(); }
});

test('retained composition handlers refuse same-event, form replacement, disabled, Close and unmounted targets before stale event access', async () => {
	const f = await fixture(); let retained: ((...args: unknown[]) => unknown) | undefined;
	try {
		await f.change(f.text.mask, 'selected'); await f.change(f.composition.operand, 'operand');
		retained = reactProps(f.button(f.composition.union)).onClick;
		await act(async () => { retained?.({}); retained?.({}); }); await f.click(f.text.apply);
		assert.equal(f.applied[0]!.value.masks.find(mask => mask.id === 'selected')!.nodes.length, 3, 'An old same-event handler cannot append twice.');
		const staleChange = reactProps(f.control(f.composition.operand)).onChange; let reads = 0;
		const event = { get currentTarget() { reads++; return { value: 'brush' }; } };
		await f.replace(recipe()); await act(async () => { retained?.({}); staleChange?.(event); }); assert.equal(reads, 0);
		await f.change(f.text.mask, 'selected'); await f.change(f.composition.operand, 'operand'); retained = reactProps(f.button(f.composition.subtract)).onClick;
		await f.replace(recipe(), true); await act(async () => { retained?.({}); });
		assert.equal(f.button(f.composition.subtract).hasAttribute('disabled'), true); await f.click(f.composition.subtract); assert.equal(f.applied.length, 1);
		await f.replace(recipe()); await f.change(f.text.mask, 'selected'); await f.change(f.composition.operand, 'operand');
		retained = reactProps(f.button(f.composition.intersect)).onClick; await f.click(f.text.close); await act(async () => { retained?.({}); });
		assert.equal(f.closed(), 1); assert.equal(f.applied.length, 1);
	} finally { await f.dispose(); }
	await act(async () => { retained?.({}); }); assert.equal(f.applied.length, 1);
});

test('StrictMode setup replay keeps composition live, and external retirement fences actions before operand event access', async () => {
	const f = await fixture('en', recipe(), true);
	try {
		await f.change(f.text.mask, 'selected'); await f.change(f.composition.operand, 'operand'); await f.click(f.composition.intersect); await f.click(f.text.apply);
		assert.equal(f.applied.length, 1); assert.equal(f.applied[0]!.value.masks.find(mask => mask.id === 'selected')!.nodes.length, 3);
		const changed = reactProps(f.control(f.composition.operand)).onChange; let reads = 0;
		f.retire(); await act(async () => { changed?.({ get currentTarget() { reads++; return { value: 'brush' }; } }); });
		await f.click(f.composition.union); await f.click(f.text.apply); assert.equal(reads, 0); assert.equal(f.applied.length, 1);
	} finally { await f.dispose(); }
});
