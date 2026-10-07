/* SPDX-License-Identifier: GPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useClassicFilterPlot, useDuckEnvelope, useLegacyCompressorCurve } from '../src/common/editor/ui/useLegacyEffectGraphPresentation.ts';
import { audacityClassicFilterGainDb } from '../src/common/editor/ui/audacity-legacy-effect-graphs.ts';
import { installResponsivenessTestDom as installReactTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

test('classic filter plots retain gain analysis across viewport changes and invalidate parameter/sample-rate changes', async () => {
	const dom = installReactTestDom(); let reads = 0;
	let parameters = { get cutoffHz() { reads++; return 1000; }, family: 'chebyshev-i', order: 5, passbandRippleDb: 1 };
	let minimum = -30, maximum = 20, sampleRate = 48000;
	let result: ReturnType<typeof useClassicFilterPlot>;
	function Harness({ revision }: { revision: number }) { result = useClassicFilterPlot(parameters, sampleRate, minimum, maximum); return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const initial = result!; const initialReads = reads;
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(reads, initialReads); assert.equal(result!, initial);
		minimum = -100; maximum = 10; await act(async () => root.render(<Harness revision={31} />));
		assert.equal(reads, initialReads); assert.equal(result!.frequencies, initial.frequencies); assert.notEqual(result!.response.line, initial.response.line);
		const expected = Array.from({ length: 400 }, (_, index) => {
			const x = index / 399, frequency = 20 * Math.exp(x * Math.log(sampleRate / 2 / 20));
			return { x: x * 100, y: Math.max(0, Math.min(100, (maximum - audacityClassicFilterGainDb(parameters, frequency, sampleRate)) / (maximum - minimum) * 100)) };
		});
		assert.deepEqual(result!.response.points, expected);
		const beforeChange = reads; parameters = { ...parameters, cutoffHz: 2000 }; sampleRate = 96000;
		await act(async () => root.render(<Harness revision={32} />));
		assert.notEqual(result!.response.line, initial.response.line); assert.notEqual(result!.frequencies, initial.frequencies); assert.equal(result!.response.maximumFrequency, 48000);
		assert.ok(beforeChange > initialReads);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
test('duck and legacy compressor curves retain their own immutable parameter derivations', async () => {
	const dom = installReactTestDom(); let duckReads = 0, compressorReads = 0;
	let duck: Readonly<Record<string, unknown>> = { get duckAmountDb() { duckReads++; return -12; } };
	let compressor: Readonly<Record<string, unknown>> = { get thresholdDb() { compressorReads++; return -12; } };
	let envelope: ReturnType<typeof useDuckEnvelope>, curve: ReturnType<typeof useLegacyCompressorCurve>;
	function Harness({ revision }: { revision: number }) { envelope = useDuckEnvelope(duck); curve = useLegacyCompressorCurve(compressor); return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const firstEnvelope = envelope!, firstCurve = curve!;
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(duckReads, 1); assert.equal(compressorReads, 1); assert.equal(envelope!, firstEnvelope); assert.equal(curve!, firstCurve);
		duck = { duckAmountDb: -20 }; compressor = { thresholdDb: -24 }; await act(async () => root.render(<Harness revision={31} />)); assert.notEqual(envelope!, firstEnvelope); assert.notEqual(curve!, firstCurve);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
