/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useEffectPickerCatalog, usePresetOptions, useDefaultPresetEdited, useEffectAboutPresentation, useControlTrackOptions } from '../src/common/editor/ui/inspector/useEffectPresentation.ts';
import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';
import { effectAboutMetadata } from '../src/common/editor/ui/inspector/effect-about-metadata.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { reactProps } from './helpers/react-test-dom.ts';
import { installResponsivenessTestDom as installReactTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

test('effect picker, preset options/default comparisons and control-track choices survive unrelated renders', async () => {
	const dom = installReactTestDom(); let labelReads = 0, presetReads = 0, paramsReads = 0, trackReads = 0;
	let types = ['audacity-invert']; let copy = { get effectNameAudacityInvert() { labelReads++; return 'Inversion'; }, effectPresetCustom: 'Custom' };
	const presets = [{ id: 'preset', get label() { presetReads++; return 'My preset'; }, custom: true }];
	let params: Readonly<Record<string, unknown>> = { get gain() { paramsReads++; return 2; } }; let defaults: Readonly<Record<string, unknown>> = { gain: 1 };
	let tracks = [{ id: 'a', type: 'audio', get name() { trackReads++; return 'A'; } }, { id: 'b', type: 'video', name: 'B' }];
	let result: readonly unknown[] = []; let selected = 'preset';
	function Harness({ revision }: { revision: number }) { result = [useEffectPickerCatalog(types, copy), usePresetOptions(presets, selected, true, 'Custom'), useDefaultPresetEdited(true, params, defaults), useControlTrackOptions(tracks, '', true)]; return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const first = result; assert.ok(labelReads > 0 && presetReads > 0 && paramsReads > 0 && trackReads > 0); const work = { labelReads, presetReads, paramsReads, trackReads };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.deepEqual({ labelReads, presetReads, paramsReads, trackReads }, work); assert.equal(result[0], first[0]); assert.equal(result[1], first[1]); assert.equal(result[2], true); assert.equal(result[3], first[3]);
		selected = ''; await act(async () => root.render(<Harness revision={31} />)); assert.notEqual(result[1], first[1]);
		types = ['audacity-invert', 'audacity-amplify']; copy = { effectNameAudacityInvert: 'Umkehr', effectPresetCustom: 'Benutzerdefiniert' }; params = { gain: 1 }; defaults = { gain: 1 }; tracks = [{ id: 'c', type: 'audio', name: 'C' }];
		await act(async () => root.render(<Harness revision={32} />)); assert.notEqual(result[0], first[0]); assert.equal(result[2], false); assert.notEqual(result[3], first[3]);
		assert.deepEqual((result[0] as ReturnType<typeof useEffectPickerCatalog>)[0], { value: 'audacity-invert', label: 'Umkehr', search: 'umkehr' });
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
test('About metadata stays available through its existing menu but is built only when opened', async () => {
	const dom = installReactTestDom(); let reads = 0, opened = false;
	const subject = { get type() { reads++; return 'audacity-invert'; } }; const copy = {};
	let about: ReturnType<typeof useEffectAboutPresentation>;
	function Harness({ revision }: { revision: number }) { about = useEffectAboutPresentation(opened, subject, copy); return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		for (let revision = 0; revision < 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(reads, 0); assert.equal(about!, null);
		opened = true; await act(async () => root.render(<Harness revision={30} />)); const first = about!; assert.ok(reads > 0);
		const work = reads; await act(async () => root.render(<Harness revision={31} />)); assert.equal(reads, work); assert.equal(about!, first);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});


test('About retains the original non-null subject boundary including an empty identifier', async () => {
	const dom = installReactTestDom(); let about: ReturnType<typeof useEffectAboutPresentation>;
	function Harness() { about = useEffectAboutPresentation(true, '', ENGLISH_COPY); return <span />; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />)); assert.deepEqual(about!, effectAboutMetadata('', ENGLISH_COPY));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('a disabled preset bar still admits the existing About menu for an empty non-null identifier', async () => {
	const dom = installReactTestDom(); const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EffectPresetBar copy={ENGLISH_COPY} presets={[]} disabled aboutEffect=""
			onSelect={() => undefined} onSave={() => undefined} onSaveAs={() => undefined} onReset={() => undefined}
			onDelete={() => undefined} onImport={() => undefined} onExport={() => undefined} />));
		const trigger = dom.one(`[aria-label="${ENGLISH_COPY.moreOptions}"]`);
		await act(async () => { reactProps(trigger).onClick({ currentTarget: trigger }); });
		assert.ok(dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]').some(item => item.textContent === 'About'));
	} finally {
		await act(async () => root.unmount());
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
