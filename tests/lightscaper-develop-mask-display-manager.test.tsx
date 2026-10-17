/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopMaskManagerV1, { type PhotoDevelopMaskManagerPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopMaskManagerV1.tsx';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { normalizeImageDevelopStateV1OrV2, defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PhotoLibraryDevelopSettingsV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

function recipe() {
	const graph = (id: string) => ({ schemaVersion: 2, id, name: `Named ${id}`, kind: 'matte', inputs: [],
		nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' });
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone' }),
		createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 50 } })],
		masks: [graph('first'), graph('second')], maskBindings: [{ effectId: 'tone', maskId: 'first' }, { effectId: 'detail', maskId: 'second' }] });
}
function displayCopy(locale = 'en') {
	return locale === 'de' ? { mode: 'Maskenanzeige', color: 'Farbüberlagerung', grayscale: 'Graustufenmaske' }
		: { mode: 'Mask display', color: 'Color overlay', grayscale: 'Grayscale mask' };
}
async function fixture(locale = 'en', strict = false) {
	let develop: PhotoLibraryDevelopSettingsV2 = recipe(), disabled = false, current = true, closed = 0;
	let props: PhotoDevelopMaskManagerPropsV1;
	const applied: Array<{ value: PhotoLibraryDevelopSettingsV2; selection: Parameters<PhotoDevelopMaskManagerPropsV1['onApply']>[1] }> = [];
	const mounted = await mountPhotoImportUi(() => {
		const element = <PhotoDevelopMaskManagerV1 develop={develop} disabled={disabled} locale={locale} isCurrent={() => current}
			onApply={function (this: PhotoDevelopMaskManagerPropsV1, value, selection) { assert.equal(this, props); applied.push({ value, selection }); }}
			onClose={function (this: PhotoDevelopMaskManagerPropsV1) { assert.equal(this, props); closed++; }} />;
		props = element.props; return strict ? <StrictMode>{element}</StrictMode> : element;
	});
	const text = photoDevelopMaskManagementCopy(locale), display = displayCopy(locale);
	const field = (label: string) => { const node = mounted.dom.container.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label); assert.ok(node, label); return node; };
	const value = (label: string) => { const raw = Object.getOwnPropertyDescriptor(reactProps(field(label)), 'value')?.value as unknown; assert.ok(typeof raw === 'string'); return raw; };
	const change = async (label: string, next: string | boolean) => { await act(async () => { reactProps(field(label)).onChange?.({ currentTarget: typeof next === 'boolean' ? { checked: next } : { value: next } }); }); };
	const button = (label: string) => { const node = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(node, label); return node; };
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); }); };
	return { ...mounted, text, display, field, value, change, button, click, applied, closed: () => closed,
		retire() { current = false; }, async replace(next = recipe(), nextDisabled = false) { develop = next; disabled = nextDisabled; await mounted.render(); } };
}

for (const locale of ['en', 'de']) test(`${locale}: mask display is opt-in, defaults color and requires an explicit bound effect without changing the recipe`, async () => {
	const f = await fixture(locale), initial = recipe();
	try {
		assert.equal(f.field(f.text.showOverlay).checked, false); assert.equal(f.dom.find(`[aria-label="${f.display.mode}"]`), null);
		await f.change(f.text.showOverlay, true); const mode = f.field(f.display.mode);
		assert.equal(f.value(f.display.mode), 'color'); assert.deepEqual(mode.options.map(option => option.value), ['color', 'grayscale']);
		assert.deepEqual(mode.options.map(option => option.textContent), [f.display.color, f.display.grayscale]); mode.focus(); assert.equal(document.activeElement, mode);
		await f.change(f.display.mode, 'grayscale'); assert.equal(f.applied.length, 0); await f.click(f.text.apply);
		assert.equal(f.applied.length, 0); assert.ok(f.dom.find('[role="alert"]')); assert.equal(f.value(f.text.overlayEffect), '');
		await f.change(f.text.overlayEffect, 'tone'); await f.click(f.text.apply);
		assert.deepEqual(f.applied[0]!.selection, { maskId: 'first', effectId: 'tone', displayMode: 'grayscale' });
		assert.ok(Object.isFrozen(f.applied[0]!.selection)); assert.deepEqual(f.applied[0]!.value, initial); assert.equal(JSON.stringify(f.applied[0]!.value).includes('displayMode'), false);
		await f.change(f.display.mode, 'color'); assert.equal(f.applied[0]!.selection && Object.getOwnPropertyDescriptor(f.applied[0]!.selection, 'displayMode')?.value, 'grayscale');
		await f.click(f.text.apply); assert.deepEqual(f.applied[1]!.selection, { maskId: 'first', effectId: 'tone' }); assert.deepEqual(f.applied[1]!.value, initial);
	} finally { await f.dispose(); }
});

test('overlay off, mask change, recipe replacement and reopen reset display to color; Close never publishes a mode', async () => {
	const f = await fixture();
	try {
		await f.change(f.text.showOverlay, true); await f.change(f.display.mode, 'grayscale'); await f.change(f.text.showOverlay, false);
		assert.equal(f.dom.find(`[aria-label="${f.display.mode}"]`), null); await f.change(f.text.showOverlay, true); assert.equal(f.value(f.display.mode), 'color');
		await f.change(f.display.mode, 'grayscale'); await f.change(f.text.mask, 'second'); assert.equal(f.field(f.text.showOverlay).checked, false);
		await f.change(f.text.showOverlay, true); assert.equal(f.value(f.display.mode), 'color'); assert.equal(f.value(f.text.overlayEffect), '');
		await f.change(f.display.mode, 'grayscale'); await f.replace(); assert.equal(f.field(f.text.showOverlay).checked, false);
		await f.change(f.text.showOverlay, true); assert.equal(f.value(f.display.mode), 'color'); await f.change(f.display.mode, 'grayscale');
		await f.click(f.text.close); assert.equal(f.closed(), 1); assert.equal(f.applied.length, 0);
	} finally { await f.dispose(); }
	const reopened = await fixture();
	try { assert.equal(reopened.field(reopened.text.showOverlay).checked, false); await reopened.change(reopened.text.showOverlay, true); assert.equal(reopened.value(reopened.display.mode), 'color'); }
	finally { await reopened.dispose(); }
});

test('unknown display choices refuse without coercion, while existing name and composition actions keep a valid display selection local', async () => {
	const f = await fixture(); let coercions = 0;
	try {
		await f.change(f.text.showOverlay, true); const changed = reactProps(f.field(f.display.mode)).onChange;
		for (const bad of ['unknown', '', { toString() { coercions++; return 'grayscale'; } }]) {
			await act(async () => { changed?.({ currentTarget: { value: bad } }); }); assert.equal(f.value(f.display.mode), 'color');
		}
		assert.equal(coercions, 0); await f.change(f.display.mode, 'grayscale'); await f.change(f.text.overlayEffect, 'tone');
		await f.change(f.text.name, 'Pending raw name'); await f.change(f.text.operand, 'second'); await f.click(f.text.add);
		assert.equal(f.value(f.display.mode), 'grayscale'); assert.equal(f.value(f.text.name), 'Pending raw name'); assert.equal(f.value(f.text.overlayEffect), 'tone');
		await f.click(f.text.rename); assert.equal(f.value(f.display.mode), 'grayscale'); await f.click(f.text.apply);
		assert.deepEqual(f.applied[0]!.selection, { maskId: 'first', effectId: 'tone', displayMode: 'grayscale' });
		assert.equal(f.applied[0]!.value.masks.find(mask => mask.id === 'first')!.nodes.length, 3);
	} finally { await f.dispose(); }
});

test('retained display handlers reject same-event old forms, disabled owners, replacement, Close and unmount before event reflection', async () => {
	const f = await fixture(); let retained: ((...args: unknown[]) => unknown) | undefined, reads = 0;
	const hostile = { get currentTarget() { reads++; return { value: 'color' }; } };
	try {
		await f.change(f.text.showOverlay, true); retained = reactProps(f.field(f.display.mode)).onChange;
		await act(async () => { retained?.({ currentTarget: { value: 'grayscale' } }); retained?.(hostile); });
		assert.equal(reads, 0); assert.equal(f.value(f.display.mode), 'grayscale');
		retained = reactProps(f.field(f.display.mode)).onChange; await f.replace(recipe(), true); await act(async () => { retained?.(hostile); });
		await f.change(f.text.showOverlay, true); assert.equal(f.field(f.text.showOverlay).checked, false); assert.equal(reads, 0);
		await f.replace(); await f.change(f.text.showOverlay, true); retained = reactProps(f.field(f.display.mode)).onChange;
		await f.replace(); await act(async () => { retained?.(hostile); }); assert.equal(reads, 0);
		await f.change(f.text.showOverlay, true); retained = reactProps(f.field(f.display.mode)).onChange; await f.click(f.text.close);
		await act(async () => { retained?.(hostile); }); assert.equal(reads, 0); assert.equal(f.applied.length, 0);
	} finally { await f.dispose(); }
	await act(async () => { retained?.(hostile); }); assert.equal(reads, 0);
});

test('StrictMode setup replay admits a current grayscale display and external retirement prevents retained publication', async () => {
	const f = await fixture('en', true);
	try {
		await f.change(f.text.showOverlay, true); await f.change(f.display.mode, 'grayscale'); await f.change(f.text.overlayEffect, 'tone'); await f.click(f.text.apply);
		assert.deepEqual(f.applied[0]!.selection, { maskId: 'first', effectId: 'tone', displayMode: 'grayscale' });
		f.retire(); await f.change(f.display.mode, 'color'); await f.click(f.text.apply); assert.equal(f.applied.length, 1);
	} finally { await f.dispose(); }
});
