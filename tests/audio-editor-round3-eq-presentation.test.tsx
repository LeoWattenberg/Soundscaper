/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import FilterCurveEqEditor from '../src/common/editor/ui/inspector/FilterCurveEqEditor.tsx';
import GraphicEqEditor from '../src/common/editor/ui/inspector/GraphicEqEditor.tsx';
import { createGraphicEqGesture } from '../src/common/editor/controller/effects/graphic-eq-gesture.ts';
import { useEqDraftFrame, useGraphicEqGrid, useFilterEqGrid, useFilterEqPolyline, useFilterResponseFrequencies } from '../src/common/editor/ui/inspector/useEqPresentation.ts';
import { filterCurvePolyline, filterCurvePointAt } from '../src/common/editor/audacity-effects/filter-curve.ts';

void test('EQ grids and projected paths retain exact geometry; gain view changes preserve analysis frequencies', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let reads = 0; const points = [{ get frequency() { reads++; return 100; }, gain: 4 }, { frequency: 1000, gain: -6 }];
	let viewport = { sampleRate: 48000, linearFrequencyScale: false, minimumDb: -30, maximumDb: 30 };
	let result: readonly unknown[] = [];
	function Harness({ revision }: { revision: number }) {
		result = [useGraphicEqGrid(-24, 24), useFilterEqGrid(viewport), useFilterEqPolyline(points, viewport), useFilterResponseFrequencies(viewport.sampleRate, viewport.linearFrequencyScale)];
		return <span>{revision}</span>;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const first = result; const work = reads;
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(reads, work); result.forEach((value, index) => assert.equal(value, first[index]));
		const expected = filterCurvePolyline(points, viewport).split(' ').map(pair => { const [x, y] = pair.split(',').map(Number); return `${56 + x! * 568},${16 + y! * 244}`; }).join(' ');
		assert.equal(result[2], expected);
		assert.deepEqual(result[3], Array.from({ length: 257 }, (_, index) => filterCurvePointAt({ x: index / 256, y: 0 }, viewport).frequency));
		viewport = { ...viewport, minimumDb: -60 }; await act(async () => root.render(<Harness revision={31} />));
		assert.notEqual(result[1], first[1]); assert.notEqual(result[2], first[2]); assert.equal(result[3], first[3]);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

void test('graphic EQ keeps every raw sweep sample, owner release and cancellation while drafts await a frame', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; requestAnimationFrame?: (callback: FrameRequestCallback) => number; cancelAnimationFrame?: (id: number) => void };
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const previous = globals.IS_REACT_ACT_ENVIRONMENT, raf = globals.requestAnimationFrame, caf = globals.cancelAnimationFrame;
	globals.IS_REACT_ACT_ENVIRONMENT = true; const callbacks = new Map<number, FrameRequestCallback>(); let frameId = 0;
	globals.requestAnimationFrame = callback => { callbacks.set(++frameId, callback); return frameId; }; globals.cancelAnimationFrame = id => { callbacks.delete(id); };
	const descriptor = { frequencies: [100, 200, 300], default: [0, 0, 0], minimum: -20, maximum: 20, step: 0.5 };
	const bounds = descriptor.frequencies.map((_value, index) => ({ left: index * 32, right: index * 32 + 16, top: 0, bottom: 100 }));
	const oracle = createGraphicEqGesture(descriptor); oracle.begin(descriptor.default, bounds, { x: 8, y: 25 }); oracle.move({ x: 40, y: 75 }); oracle.move({ x: 8, y: 0 }); oracle.move({ x: 72, y: 100 });
	const expected = oracle.complete()!.gains; let committed: readonly number[] | null = null; let commits = 0;
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<GraphicEqEditor name="bands" label="Bands" descriptor={descriptor} disabled={false} copy={{}} gestureFor={() => ({})} onCommit={value => { commits++; committed = value; }} />));
		const board = dom.container.querySelector('.audio-editor-graphic-eq__board')!;
		Object.assign(board, { setPointerCapture: () => undefined, hasPointerCapture: () => false });
		const sliders = dom.container.querySelectorAll('[role="slider"]'); sliders.forEach((slider, index) => Object.assign(slider, { getBoundingClientRect: () => bounds[index] }));
		const event = { currentTarget: board, target: sliders[0], clientX: 8, clientY: 25, pointerId: 1, button: 0, preventDefault() {}, stopPropagation() {} };
		const invoke = async (name: string, changes: object = {}) => { await act(async () => { (reactProps(board)[name] as (event: unknown) => void)({ ...event, ...changes }); }); };
		await invoke('onPointerDownCapture'); await invoke('onPointerMoveCapture', { clientX: 40, clientY: 75 }); await invoke('onPointerMoveCapture', { clientX: 8, clientY: 0 });
		assert.equal(callbacks.size, 1); await invoke('onPointerMoveCapture', { pointerId: 2, clientX: 72, clientY: 50 }); await invoke('onPointerUpCapture', { pointerId: 2 }); assert.equal(callbacks.size, 1);
		await invoke('onPointerUpCapture', { clientX: 72, clientY: 100 }); assert.deepEqual(committed, expected); assert.equal(callbacks.size, 0); assert.equal(commits, 1);
		await invoke('onPointerDownCapture'); await invoke('onPointerMoveCapture', { clientX: 40, clientY: 75 }); assert.equal(callbacks.size, 1);
		await invoke('onKeyDown', { key: 'Escape' }); assert.equal(callbacks.size, 0); assert.equal(commits, 1);
	} finally { await act(async () => root.unmount()); globals.requestAnimationFrame = raf; globals.cancelAnimationFrame = caf; if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

void test('EQ drafts publish once per frame and cancellation retires pending previews', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; requestAnimationFrame?: (callback: FrameRequestCallback) => number; cancelAnimationFrame?: (id: number) => void };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT, raf = globals.requestAnimationFrame, caf = globals.cancelAnimationFrame;
	globals.IS_REACT_ACT_ENVIRONMENT = true; const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
	globals.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; }; globals.cancelAnimationFrame = value => { callbacks.delete(value); };
	let renders = 0; let output: number | null = null; let frame: ReturnType<typeof useEqDraftFrame<number>>;
	function Harness() { const [draft, setDraft] = useState<number | null>(null); output = draft; renders++; frame = useEqDraftFrame(setDraft); return null; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />)); const initial = renders;
		await act(async () => { frame!.publish(1); frame!.publish(2); frame!.publish(3); }); assert.equal(renders, initial); assert.equal(callbacks.size, 1);
		await act(async () => { for (const callback of callbacks.values()) callback(0); callbacks.clear(); }); assert.equal(output, 3); assert.equal(renders, initial + 1);
		await act(async () => { frame!.publish(4); frame!.cancel(); }); assert.equal(callbacks.size, 0); assert.equal(output, 3);
	} finally { await act(async () => root.unmount()); globals.requestAnimationFrame = raf; globals.cancelAnimationFrame = caf; globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

void test('a filter-curve pointer press reads its rectangle once and release commits the final position', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	let reads = 0; let committed: readonly { frequency: number; gain: number }[] = [];
	try {
		await act(async () => root.render(<FilterCurveEqEditor name="curve" label="Curve" sampleRate={48000} linearFrequencyScale={false} filterLength={512} copy={{}} disabled={false} onCommit={value => { committed = value; }} />));
		const svg = dom.container.querySelector('svg')!;
		Object.assign(svg, { getBoundingClientRect: () => { reads++; return { left: 0, top: 0, width: 640, height: 300 }; }, setPointerCapture: () => undefined, hasPointerCapture: () => false });
		const props = reactProps(svg); const event = { currentTarget: svg, clientX: 120, clientY: 100, pointerId: 1, button: 0, preventDefault() {} };
		await act(async () => { (props.onPointerDown as (event: unknown) => void)(event); }); assert.equal(reads, 1);
		await act(async () => { (reactProps(svg).onPointerUp as (event: unknown) => void)({ ...event, clientX: 300, clientY: 120 }); });
		assert.equal(committed.length, 1);
		assert.ok(Math.abs(committed[0]!.gain - (30 - (120 - 16) / 244 * 60)) < 1e-9);
	} finally { await act(async () => root.unmount()); if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
