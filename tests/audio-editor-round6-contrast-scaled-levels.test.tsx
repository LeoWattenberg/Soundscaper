/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { analyzeAudioChannels } from '../src/common/editor/analysis.js';
import { createAudioAnalysisService, type AnalysisDependencies } from '../src/common/editor/controller/analysis/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function fixture(raw = true) {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('contrast');
	let sample = .25;
	let selections: ReturnType<AnalysisDependencies['getContrastSelections']> = { foreground: null, background: null };
	const dependencies = {
		lifetime, state: { lastAnalysisRequest: null }, copy: ENGLISH_COPY,
		captureProject: () => generation.capture('contrast'),
		assertProject: (token: ReturnType<EditorProjectGeneration['capture']>) => generation.assertCurrent(token),
		getProject: () => ({ id: 'contrast', revision: 1, clips: [{}] }),
		getSelectedTrackId: () => null,
		getRange: () => ({ startFrame: 0, endFrame: 32 }),
		getActiveSelection: () => ({ startFrame: 0, endFrame: 32 }),
		getSpectrumWindowSize: () => 32,
		getContrastSelections: () => selections,
		setContrastSelections: (value: typeof selections) => { selections = value; },
		loadAnalysis: async () => null, saveAnalysis: async () => undefined,
		renderAudio: async () => ({ sampleRate: 8000, numberOfChannels: 1, length: 32,
			getChannelData: () => new Float32Array(32).fill(sample) }),
		analyzeChannels: async (channels: Float32Array[]) => {
			const result = analyzeAudioChannels(channels, 8000);
			return raw ? result : { rmsDbfs: result.rmsDbfs };
		},
		createVisuals: () => null,
		showAnalysis() {}, setProcessing() {}, setStatus() {}, publish() {},
		handleError(error: unknown) { throw error; },
	} satisfies AnalysisDependencies;
	const service = createAudioAnalysisService(dependencies);
	return { async measure(foreground: number, background: number) {
		sample = foreground; await service.captureContrast('foreground');
		sample = background; return service.captureContrast('background');
	} };
}

test('relative Contrast survives equal attenuation beneath the absolute meter floor', async () => {
	const healthy = await fixture().measure(.25, .25 / Math.sqrt(1000));
	assert.ok(healthy);
	assert.ok(Math.abs(healthy.differenceDb! - 30) < 1e-5);
	assert.equal(healthy.passes, true);
	const quiet = await fixture().measure(.25e-5, .25e-5 / Math.sqrt(1000));
	assert.ok(quiet);
	assert.equal(quiet.background?.rmsDb, -120, 'Keep the existing absolute display floor.');
	assert.ok(Math.abs(quiet.differenceDb! - 30) < 1e-5);
	assert.equal(quiet.passes, true);
});

test('relative Contrast preserves a quiet reversed foreground/background ratio', async () => {
	const report = await fixture().measure(.25e-5 / Math.sqrt(1000), .25e-5);
	assert.ok(report);
	assert.ok(Math.abs(report.differenceDb! + 30) < 1e-5);
	assert.equal(report.passes, false);
});

test('a nonzero quiet foreground exceeds a truly silent background', async () => {
	const report = await fixture().measure(.25e-5, 0);
	assert.ok(report);
	assert.equal(report.background?.rmsDb, -120);
	assert.equal(report.differenceDb, Infinity);
	assert.equal(report.passes, true);
});

test('a truly silent foreground fails against a nonzero background', async () => {
	const report = await fixture().measure(0, .25e-5);
	assert.ok(report);
	assert.equal(report.differenceDb, -Infinity);
	assert.equal(report.passes, false);
});

test('Contrast retains the zero-against-zero decision and completed legacy meter-only captures', async () => {
	const silent = await fixture().measure(0, 0);
	assert.ok(silent);
	assert.equal(silent.differenceDb, 0);
	assert.equal(silent.passes, false);
	const legacy = await fixture(false).measure(.25, .25 / Math.sqrt(1000));
	assert.ok(legacy);
	assert.ok(Math.abs(legacy.differenceDb! - 30) < 1e-5);
	assert.equal(legacy.passes, true);
});

for (const [differenceDb, label, passes] of [[Infinity, '∞ dB', true], [-Infinity, '−∞ dB', false], [25, '25.00 dB', true]] as const) {
	test(`Contrast displays a classified relative difference of ${label}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const project = { id: 'contrast', title: 'Contrast', sampleRate: 48_000,
			clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 48_000 }],
			tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
			selection: { startFrame: 0, endFrame: 48_000, trackIds: ['track'], clipIds: [] } };
		const snapshot = { project, ready: true, analysisProcessing: false, missingSourceIds: [],
			analysisReport: { type: 'contrast', foreground: { rmsDb: -120 }, background: { rmsDb: -120 }, differenceDb, passes } };
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<AnalysisDialog mode="contrast" controller={{ actions: { analysis: {} } }}
				snapshot={snapshot} copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
			const report = dom.one('[data-analysis-report="contrast"]');
			assert.ok(report.textContent.includes(`Difference: ${label}`));
			assert.ok(report.textContent.includes(passes ? ENGLISH_COPY.contrastPass : ENGLISH_COPY.contrastFail));
		} finally {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
