/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MotionPropertyGraph from '../src/common/editor/ui/motionscaper/MotionPropertyGraph.tsx';
import MotionPlaneEditor from '../src/common/editor/ui/motionscaper/MotionPlaneEditor.tsx';
import { motionPlaneGeometry } from '../src/common/editor/ui/motionscaper/motion-plane-geometry.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const copy = motionscaperCopy('en');
const at = (num: number) => ({ num, den: 1 });

for (const key of ['Enter', ' ']) for (const disabled of [false, true]) {
	test(`Motion graph key ${JSON.stringify(key)} selects without authoring${disabled ? ' while disabled refuses' : ''}`, async () => {
		const selections: unknown[] = []; let commits = 0;
		const property = { ...motionScalar(0), curve: { anchors: [{ position: at(0), value: 0 }, { position: at(30), value: 30 }], segments: [{ kind: 'linear' as const }] } };
		const mounted = await mount(<MotionPropertyGraph copy={copy} property={property} channel={0} duration={60} frameRate={at(30)}
			selected={[]} disabled={disabled} onSelect={value => selections.push(value)} onCommit={() => { commits++; }} />);
		try {
			const point = mounted.dom.one('[data-motion-key-point="30/1"]'); let prevented = false;
			await act(async () => { reactProps(point).onKeyDown?.({ key, preventDefault() { prevented = true; } }); });
			assert.deepEqual(selections, disabled ? [] : [[at(30)]]); assert.equal(commits, 0); assert.equal(prevented, !disabled);
			assert.equal(point.getAttribute('tabindex'), disabled ? '-1' : '0');
		} finally { await mounted.dispose(); }
	});
	test(`Motion path point ${JSON.stringify(key)} selects without moving${disabled ? ' while disabled refuses' : ''}`, async () => {
		const selections: string[] = []; let commits = 0;
		const geometry = motionPlaneGeometry(motionRectanglePath({ x: 0, y: 0, width: 40, height: 40 }), { duration: 60, position: null, selected: '', copy });
		const mounted = await mount(<MotionPlaneEditor copy={copy} geometry={geometry} bounds={[0, 0, 100, 100]} selected="vertex:0" disabled={disabled}
			onSelect={value => selections.push(value)} onPreview={() => undefined} onCommit={() => { commits++; }} />);
		try {
			const point = mounted.dom.one('[data-motion-plane-point="vertex:1"]'); let prevented = false;
			await act(async () => { reactProps(point).onKeyDown?.({ key, preventDefault() { prevented = true; } }); });
			assert.deepEqual(selections, disabled ? [] : ['vertex:1']); assert.equal(commits, 0); assert.equal(prevented, !disabled);
			assert.equal(point.getAttribute('tabindex'), disabled ? '-1' : '0');
		} finally { await mounted.dispose(); }
	});
}

for (const kind of ['graph', 'path'] as const) for (const key of ['Enter', ' ']) {
	test(`Motion ${kind} ${JSON.stringify(key)} preserves modified shortcuts and composition and consumes repeats without selecting again`, async () => {
		const mounted = await control(kind);
		try {
			for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
				{ nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }, { defaultPrevented: true }]) {
				let prevented = false;
				await act(async () => { reactProps(mounted.point).onKeyDown?.({ key, ...extra, preventDefault() { prevented = true; } }); });
				assert.equal(prevented, false, JSON.stringify(extra));
			}
			assert.deepEqual(mounted.selections, []); assert.deepEqual(mounted.commits, []);
			for (const repeat of [false, true, true]) {
				let prevented = false;
				await act(async () => { reactProps(mounted.point).onKeyDown?.({ key, repeat, preventDefault() { prevented = true; } }); });
				assert.equal(prevented, true);
			}
			assert.deepEqual(mounted.selections, kind === 'graph' ? [[at(30)]] : ['vertex:1']); assert.deepEqual(mounted.commits, []);
		} finally { await mounted.dispose(); }
	});
}

for (const kind of ['graph', 'path'] as const) {
	test(`Motion ${kind} activation leaves Shift arrow distance and repeating arrow edits intact`, async () => {
		const mounted = await control(kind);
		try {
			let prevented = 0;
			for (const repeat of [false, true]) await act(async () => { reactProps(mounted.point).onKeyDown?.({ key: 'ArrowRight', shiftKey: true, repeat, preventDefault() { prevented++; } }); });
			assert.equal(prevented, 2); assert.equal(mounted.commits.length, 2);
			if (kind === 'graph') {
				assert.deepEqual(mounted.commits, [40, 40]); assert.deepEqual(mounted.selections, []);
			} else {
				assert.deepEqual(mounted.commits, [['vertex:1', [50, 0]], ['vertex:1', [50, 0]]]); assert.deepEqual(mounted.selections, ['vertex:1', 'vertex:1']);
			}
		} finally { await mounted.dispose(); }
	});
}

async function control(kind: 'graph' | 'path') {
	const selections: unknown[] = [], commits: unknown[] = [];
	const property = { ...motionScalar(0), curve: { anchors: [{ position: at(0), value: 0 }, { position: at(30), value: 30 }], segments: [{ kind: 'linear' as const }] } };
	const geometry = motionPlaneGeometry(motionRectanglePath({ x: 0, y: 0, width: 40, height: 40 }), { duration: 60, position: null, selected: '', copy });
	const mounted = await mount(kind === 'graph'
		? <MotionPropertyGraph copy={copy} property={property} channel={0} duration={60} frameRate={at(30)} selected={[]} disabled={false}
			onSelect={value => selections.push(value)} onCommit={create => { const result = create(); assert.equal(result.kind, 'scalar'); if (result.kind === 'scalar') commits.push(result.curve?.anchors[1]?.position.num); }} />
		: <MotionPlaneEditor copy={copy} geometry={geometry} bounds={[0, 0, 100, 100]} selected="vertex:0" disabled={false}
			onSelect={value => selections.push(value)} onPreview={() => undefined} onCommit={(id, value) => commits.push([id, value])} />);
	const point = mounted.dom.one(kind === 'graph' ? '[data-motion-key-point="30/1"]' : '[data-motion-plane-point="vertex:1"]');
	return { ...mounted, point, selections, commits };
}

async function mount(component: React.ReactNode) {
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = scope.IS_REACT_ACT_ENVIRONMENT; scope.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { value: React, configurable: true });
	await act(async () => { root.render(component); });
	return { dom, async dispose() {
		await act(async () => { root.unmount(); }); dom.restore(); scope.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	} };
}
