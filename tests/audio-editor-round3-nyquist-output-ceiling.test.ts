/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { freezeNyquistResult, normalizeNyquistRole, nyquistAudioResultBytes,
	nyquistMaximumOutputFrames } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { throwIfAborted } from '../src/common/editor/controller/shared/app-helpers.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { NYQUIST_MAX_TOTAL_AUDIO_SAMPLES } from '../src/common/editor/nyquist/audio-budget.ts';
import { NYQUIST_MAX_TOTAL_AUDIO_SAMPLES as protocolAudioSamples,
	normalizeNyquistRequest } from '../src/common/editor/nyquist/protocol.js';
import { planNyquistOutputAdmission } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-output-admission.ts';

test('the eager admission contract and optional protocol retain the same per-channel audio budget', () => {
	assert.equal(NYQUIST_MAX_TOTAL_AUDIO_SAMPLES, 24 * 1024 * 1024);
	assert.equal(protocolAudioSamples, NYQUIST_MAX_TOTAL_AUDIO_SAMPLES);
	for (const channelCount of [1, 2, 32]) {
		const channelFrames = Math.floor(NYQUIST_MAX_TOTAL_AUDIO_SAMPLES / channelCount);
		const request = normalizeNyquistRequest({ source: '*track*',
			channels: Array.from({ length: channelCount }, () => Float32Array.of(0.25)),
			sampleRate: 8_000, maxOutputFrames: channelFrames + 1 });
		assert.equal(request.maxOutputFrames, channelFrames);
		assert.deepEqual(planNyquistOutputAdmission(channelFrames, channelCount, false),
			{ renderFrames: channelFrames, completeFrames: channelFrames - 1 });
	}
});

async function fixture(seconds: number) {
	const sampleRate = 8_000;
	const input = new Float32Array(seconds * sampleRate).fill(0.25);
	const project = createCurrentAudioEditorProject({ id: 'interview', sampleRate });
	const runtime = await loadNyquistWasm(await readFile(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	let publications = 0;
	const state = { audacityEffectProcessing: false, nyquistAbort: null, nyquistResult: null };
	const lifetime = new EditorControllerLifetime();
	const service = createSelectionEffectExecutionService({
		lifetime, state, getProject: () => project,
		captureProject: () => ({ projectId: project.id }), assertProject: () => undefined,
		activeSelection: () => null,
		audacityEffectSelectionDetails: () => ({}),
		audacityEffectTargets: () => [{ track: { id: 'voice' }, startFrame: 0,
			endFrame: input.length, durationFrames: input.length, channelCount: 1 }],
		cancelAudacityEffectPreview: () => undefined,
		copy: { audacityProcessing: 'Processing', nyquistApplied: 'Applied', nyquistPrompt: 'Nyquist prompt',
			nyquistAudioOutputTooLong: 'Nyquist audio exceeds the output limit.' },
		editingBlocked: () => false,
		freezeNyquistResult, normalizeNyquistRole, nyquistAudioResultBytes, nyquistMaximumOutputFrames,
		NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES: 100_000_000,
		nyquistHostProperties: () => ({}),
		nyquistEvaluator: async (request: Parameters<typeof runtime.evaluate>[0]) => runtime.evaluate(request),
		persistAudacityEffectResults: async () => { publications++; },
		preflightStorage: async () => undefined,
		projectDurationFrames: () => input.length, projectSampleRate: () => sampleRate,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: async () => [input],
		setStatus: () => undefined, throwIfAborted, updateTaskProgress: () => undefined,
	});
	return { service, state, project, input, get publications() { return publications; } };
}

test('the actual Nyquist runtime cannot publish an identity recording truncated at the output ceiling', async () => {
	const run = await fixture(301);
	const before = structuredClone(run.project);
	await assert.rejects(run.service.runNyquistEvaluation({ source: '*track*' }), /Nyquist audio exceeds/u);
	assert.equal(run.publications, 0);
	assert.equal(run.state.audacityEffectProcessing, false);
	assert.deepEqual(run.project, before);
	assert.equal(run.input.length, 301 * 8_000);
	assert.equal(run.input.at(-1), 0.25);
});

test('an exact-ceiling recording and an intentionally shorter result remain valid', async () => {
	const exact = await fixture(300);
	const result = await exact.service.runNyquistEvaluation({ source: '*track*' }) as { frameCount: number };
	assert.equal(result.frameCount, 300 * 8_000);
	assert.equal(exact.publications, 1);
	const longer = await fixture(301);
	const short = await longer.service.runNyquistEvaluation({ source: '(extract-abs 0 1 *track*)' }) as { frameCount: number };
	assert.equal(short.frameCount, 8_000);
	assert.equal(longer.publications, 1);
});
