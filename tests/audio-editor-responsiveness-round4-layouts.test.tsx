/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { AudacityEffectLayout } from '../src/common/editor/ui/AudacityEffectLayout.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installResponsivenessTestDom as installReactTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

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
