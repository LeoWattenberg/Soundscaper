/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { VideoEffectRack } from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { useVideoEffectParameters } from '../src/common/editor/ui/inspector/useVideoEffectParameters.ts';
import { AudacityEffectLayout } from '../src/common/editor/ui/AudacityEffectLayout.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installResponsivenessTestDom as installReactTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('video effect descriptor entries survive value-only changes and unaffected rack rows skip render work', async () => {
	const dom = installReactTestDom(); let enumerations = 0, readsA = 0, readsB = 0, replacementReads = 0;
	const descriptor = new Proxy({ amount: { value: 1 } }, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
	let entries: ReturnType<typeof useVideoEffectParameters<{ value: number }>> = [];
	const effects = [{ id: 'a', type: 'color-adjust', params: { get brightness() { readsA++; return 0; }, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 } }, { id: 'b', type: 'color-adjust', params: { get brightness() { readsB++; return 0; }, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 } }];
	let clip = { id: 'clip', videoEffects: effects };
	const controller = { actions: { video: { effects: {} } } }; const onError = () => undefined;
	function Harness({ revision }: { revision: number }) { entries = useVideoEffectParameters(descriptor); return <div data-revision={revision}><VideoEffectRack clip={clip} controller={controller} copy={ENGLISH_COPY} disabled={false} onError={onError} /></div>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const initial = entries; const work = { readsA, readsB }; assert.ok(readsA > 0 && readsB > 0);
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(entries, initial); assert.equal(enumerations, 1); assert.deepEqual({ readsA, readsB }, work);
		clip = { id: 'clip', videoEffects: [{ ...effects[0]!, params: { get brightness() { replacementReads++; return 0.25; }, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 } }, effects[1]!] };
		await act(async () => root.render(<Harness revision={31} />)); assert.equal(readsB, work.readsB); assert.ok(replacementReads > 0);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('effect card grouping scans each immutable parameter definition once and refreshes new definitions', async () => {
	const dom = installReactTestDom(); let scans = 0;
	let params: Readonly<Record<string, object>> = new Proxy({ frequency: {}, threshold: {}, reduction: {}, attack: {}, release: {} }, { ownKeys(target) { scans++; return Reflect.ownKeys(target); } });
	let names: string[] = [];
	function Harness({ revision }: { revision: number }) { names = []; return <div data-revision={revision}><AudacityEffectLayout effectType="deesser" definition={{ params }} parameters={{}} renderParameter={(name: string) => { names.push(name); return <span>{name}</span>; }} copy={ENGLISH_COPY} /></div>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const initial = [...names];
		for (let revision = 1; revision <= 30; revision++) { await act(async () => root.render(<Harness revision={revision} />)); assert.deepEqual(names, initial); }
		assert.equal(scans, 1);
		params = { ...params, newParameter: {} }; await act(async () => root.render(<Harness revision={31} />)); assert.equal(names.filter(name => name === 'newParameter').length, 1);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
