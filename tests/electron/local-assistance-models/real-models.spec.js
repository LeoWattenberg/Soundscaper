/* SPDX-License-Identifier: AGPL-3.0-only */

import { test, expect } from '@playwright/test';
import catalog from '../../../config/local-model-catalog.json' with { type: 'json' };
import manifest from '../../../config/local-model-real-test-cases.json' with { type: 'json' };
import { validateLocalModelRealTestCases } from '../../../scripts/lib/local-model-real-test-cases.mjs';
import { PROJECT_SCHEMA_VERSION } from '../../../src/common/editor/project-schema-identity.ts';
import { launchModelTestElectron } from './electron-fixture.js';
import { digest, prepareModelInput } from './model-inputs.js';
import { validateModelOutput } from './model-output-validation.js';

const OUTPUTS = Object.freeze({
	'voice-activity-detection': ['voice-activity', 'application/json'],
	'speech-recognition': ['transcript', 'application/json'],
	'speaker-diarization': ['speaker-turns', 'application/json'],
	'speech-enhancement': ['enhanced-audio', 'audio/wav'],
	'subject-detection': ['subject-tracks', 'application/vnd.soundscaper.subject-tracks+json'],
	'saliency-detection': ['saliency-map', 'application/vnd.soundscaper.saliency-map+json'],
	'optical-character-recognition': ['recognized-text', 'application/vnd.soundscaper.recognized-text+json'],
	'text-embedding': ['embeddings', 'application/vnd.soundscaper.embedding-matrix-v1'],
	'image-text-embedding': ['embeddings', 'application/vnd.soundscaper.embedding-matrix-v1'],
});

for (const modelCase of validateLocalModelRealTestCases(manifest, catalog)) {
	test(`${modelCase.id}: downloads and executes ${modelCase.modelIds.join(' + ')}`, async ({ browserName: _browserName }, testInfo) => {
		const target = `${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform}-${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch}`;
		const models = modelCase.modelIds.map((id) => catalog.entries.find((entry) => entry.modelId === id));
		const unsupported = models.filter((entry) => !entry.platforms.includes(target));
		test.skip(unsupported.length > 0, `Catalog does not publish ${unsupported.map((entry) => entry.modelId).join(', ')} on ${target}.`);
		const productId = process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_PRODUCT_ID ?? 'framescaper';
		const electron = await launchModelTestElectron({ testInfo, productId });
		try {
			for (const model of models) await test.step(`Download and authenticate ${model.modelId}`, async () => {
				const installed = await electron.installModel(model.modelId);
				expect(installed.version).toBe(model.version);
			});
			const input = await prepareModelInput(modelCase.fixtureId, electron.page);
			const sourceSha256 = digest(input.bytes);
			const selectionFence = {
				projectId: `nightly-${modelCase.id}`, schemaFamily: productId, schemaVersion: PROJECT_SCHEMA_VERSION,
				revision: 0, sequenceId: 'nightly-sequence', occurrenceIds: ['nightly-occurrence'],
				sourceId: modelCase.fixtureId, sourceSha256, sourceStartFrame: 0, sourceEndFrame: input.frameCount,
				linkMembershipSha256: digest('nightly-occurrence'),
				timingAuthoritySha256: digest(JSON.stringify(input.authority ?? { sampleRate: input.sampleRate, frameCount: input.frameCount })),
			};
			const [role, mediaType] = OUTPUTS[modelCase.operation];
			const run = await test.step('Execute the real model through Electron IPC', () => executeOperation(electron.page, {
				operation: modelCase.operation, expectedModels: models.map((model) => ({ modelId: model.modelId,
					version: model.version, artifactSha256s: model.artifacts.map((artifact) => artifact.sha256).sort() })), selectionFence,
				input: { base64: input.bytes.toString('base64'), role: input.role, mediaType: input.mediaType, sha256: sourceSha256 },
				output: { role, mediaType, maximumByteLength: 32 * 1024 * 1024 },
			}));
			await testInfo.attach('inference-evidence.json', { body: JSON.stringify({ caseId: modelCase.id,
				fixtureId: modelCase.fixtureId, sourceSha256, models, ...run, bytes: undefined }, null, 2), contentType: 'application/json' });
			expect(run.outcome.outcome, JSON.stringify(run.outcome)).toBe('completed');
			const output = Buffer.from(run.bytes);
			expect(digest(output)).toBe(run.outcome.result.outputs[0].sha256);
			expect(output.byteLength).toBe(run.outcome.result.outputs[0].byteLength);
			await testInfo.attach(mediaType === 'audio/wav' ? 'processed-audio.wav' : 'model-output.bin', { body: output, contentType: mediaType });
			const summary = validateModelOutput(modelCase.validation, output, input);
			await testInfo.attach('validation.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
		} finally {
			await electron.close();
		}
	});
}

async function executeOperation(page, request) {
	return page.evaluate(async (value) => {
		const bridge = globalThis.soundscaperDesktop.v1.localAssistance;
		const installed = await bridge.models();
		const models = value.expectedModels.map((expected) => {
			const model = installed.find((entry) => entry.modelId === expected.modelId);
			if (!model) throw new Error(`Installed model unavailable for inference: ${expected.modelId}`);
			if (model.version !== expected.version || JSON.stringify([...model.artifactSha256s].sort()) !== JSON.stringify(expected.artifactSha256s)) {
				throw new Error(`Installed model differs from the test catalog: ${expected.modelId}`);
			}
			return { modelId: model.modelId, version: model.version, artifactSha256s: model.artifactSha256s };
		});
		const { jobId } = await bridge.createJob();
		const progress = [];
		const unsubscribe = bridge.onProgress((event) => {
			if (event.jobId === jobId && progress.length < 4096) progress.push(event);
		});
		try {
			const bytes = Uint8Array.from(atob(value.input.base64), (character) => character.charCodeAt(0));
			const input = await bridge.stageInput({ jobId, role: value.input.role, mediaType: value.input.mediaType,
				sha256: value.input.sha256, bytes: new Blob([bytes], { type: value.input.mediaType }) });
			const output = await bridge.reserveOutput({ jobId, ...value.output });
			const started = performance.now();
			const outcome = await bridge.run({ contractVersion: 1, jobId, operation: value.operation,
				selectionFence: value.selectionFence, models, inputs: [input], outputs: [output] });
			const elapsedMs = performance.now() - started;
			if (outcome.outcome !== 'completed') return { outcome, elapsedMs, progress, bytes: [] };
			if (outcome.result.outputs.length !== 1) throw new Error('Expected exactly one authenticated model output.');
			const blob = await bridge.readOutput({ jobId, claim: outcome.result.outputs[0] });
			return { outcome, elapsedMs, progress, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
		} finally {
			unsubscribe();
			await bridge.release(jobId);
		}
	}, request);
}
