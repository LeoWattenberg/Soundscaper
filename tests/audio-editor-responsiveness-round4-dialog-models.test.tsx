/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installResponsivenessTestDom as installReactTestDom } from './helpers/responsiveness-round4-ui-dom.ts';
import { useAnalyzerLookup } from '../src/common/editor/ui/dialogs/useAnalyzerLookup.ts';
import { useCompBoundaries } from '../src/common/editor/ui/dialogs/take-comp-boundaries.ts';
import { useGeneratorFormatters, useMorseSummary } from '../src/common/editor/ui/dialogs/useGeneratorPresentation.ts';
import { useCompressionCurve } from '../src/common/editor/ui/useCompressionCurve.ts';
import { audacityCompressionCurve } from '../src/common/editor/ui/audacity-compression-curve.ts';
import { summarizeMorseCode } from '../src/common/editor/morse-code.ts';
import type { VampAnalyzerDescriptor } from '../src/common/editor/vamp-analysis.ts';

test('dialog lookup, shared comp boundaries and sampled compressor paths retain their owning inputs', async () => {
	const dom = installReactTestDom(); let analyzerReads = 0, outputReads = 0, boundaryReads = 0, thresholdReads = 0;
	const output = { get id() { outputReads++; return 'o'; }, name: 'Output', description: '', unit: '', sampleType: 'variable-sample-rate' as const, sampleRate: null, hasDuration: false };
	const first: VampAnalyzerDescriptor = { get analyzerId() { analyzerReads++; return 'a'; }, stableId: 's', binarySha256: '', name: 'First', maker: '', programs: [], parameters: [], outputs: [output] };
	let analyzers = [first, { ...first, name: 'Duplicate' }];
	let regions = [{ id: 'l', get endSample() { boundaryReads++; return 10; }, startSample: 0 }, { id: 'r', startSample: 10, endSample: 20 }, { id: 'gap', startSample: 30, endSample: 40 }];
	let parameters: Readonly<Record<string, unknown>> = { get thresholdDb() { thresholdReads++; return -12; }, kneeWidthDb: 6, ratio: 4, makeupGainDb: 9 };
	let result: readonly unknown[] = [];
	function Harness({ revision }: { revision: number }) { result = [useAnalyzerLookup(analyzers), useCompBoundaries(regions), useCompressionCurve(parameters)]; return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const initial = result; const reads = { analyzerReads, outputReads, boundaryReads, thresholdReads };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.deepEqual({ analyzerReads, outputReads, boundaryReads, thresholdReads }, reads); result.forEach((value, i) => assert.equal(value, initial[i]));
		const lookup = result[0] as ReturnType<typeof useAnalyzerLookup>;
		assert.equal(lookup.analyzers.get('a'), first); assert.equal(lookup.outputs.get(first)?.get('o'), output);
		assert.deepEqual(result[1], [{ leftRegionId: 'l', rightRegionId: 'r', boundarySample: 10 }]);
		assert.deepEqual(result[2], audacityCompressionCurve(parameters));
		analyzers = [first]; regions = [{ id: 'l', startSample: 0, endSample: 11 }, { id: 'r', startSample: 11, endSample: 20 }]; parameters = { ...parameters, thresholdDb: -20 };
		await act(async () => root.render(<Harness revision={31} />)); result.forEach((value, i) => assert.notEqual(value, initial[i]));
		assert.deepEqual(result[1], [{ leftRegionId: 'l', rightRegionId: 'r', boundarySample: 11 }]); assert.deepEqual(result[2], audacityCompressionCurve(parameters));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('Morse preview invalidates every encoding input and localized formatters retain only matching locale/options', async () => {
	const dom = installReactTestDom(); let text = 'SOS', speed = 20, type = 'morse', locale = 'en';
	const originalNumberFormat = Intl.NumberFormat; const priorNumberFormat = Object.getOwnPropertyDescriptor(Intl, 'NumberFormat')!; let constructors = 0;
	Object.defineProperty(Intl, 'NumberFormat', { ...priorNumberFormat, value: new Proxy(originalNumberFormat, { construct(target, args) { constructors++; return Reflect.construct(target, args) as Intl.NumberFormat; } }) });
	let summary: ReturnType<typeof useMorseSummary>; let formatters: ReturnType<typeof useGeneratorFormatters>;
	function Harness({ revision }: { revision: number }) { summary = useMorseSummary(type, text, speed); formatters = useGeneratorFormatters(type, locale); return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const initial = summary!, initialFormatters = formatters!;
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(summary!, initial); assert.equal(formatters!, initialFormatters); assert.equal(formatters!.number, null); assert.equal(constructors, 1);
		assert.equal(formatters!.seconds?.format(0.06), new originalNumberFormat('en', { maximumFractionDigits: 3, style: 'unit', unit: 'second', unitDisplay: 'short' }).format(0.06));
		text = 'A?'; speed = 10; locale = 'de'; await act(async () => root.render(<Harness revision={31} />));
		assert.deepEqual(summary!, summarizeMorseCode(text, speed)); assert.notEqual(summary!, initial); assert.notEqual(formatters!, initialFormatters); assert.equal(constructors, 2);
		type = 'dtmf'; await act(async () => root.render(<Harness revision={32} />)); assert.equal(summary!, null); assert.ok(formatters!.number); assert.ok(formatters!.seconds); assert.equal(constructors, 4);
		const dtmf = formatters!; text = 'invalid'; speed = 50; await act(async () => root.render(<Harness revision={33} />)); assert.equal(formatters!, dtmf); assert.equal(constructors, 4);
		type = 'tone'; await act(async () => root.render(<Harness revision={34} />)); assert.equal(formatters!.number, null); assert.equal(formatters!.seconds, null); assert.equal(constructors, 4);
	} finally { await act(async () => root.unmount()); Object.defineProperty(Intl, 'NumberFormat', priorNumberFormat); dom.restore(); }
});
