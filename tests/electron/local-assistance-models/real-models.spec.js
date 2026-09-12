/* SPDX-License-Identifier: AGPL-3.0-only */

import { test, expect } from '@playwright/test';
import catalog from '../../../config/local-model-catalog.json' with { type: 'json' };
import manifest from '../../../config/local-model-real-test-cases.json' with { type: 'json' };
import catalogTasks from '../../../config/milestone-7-model-catalog-tasks.json' with { type: 'json' };
import { validateLocalModelRealTestCases } from '../../../scripts/lib/local-model-real-test-cases.mjs';
import { PROJECT_SCHEMA_VERSION } from '../../../src/common/editor/project-schema-identity.ts';
import { launchModelTestElectron } from './electron-fixture.js';
import { digest, prepareModelInput } from './model-inputs.js';
import { validateModelOutputs } from './model-output-validation.js';
import { executeModelOperation, modelOutputReservations } from './model-operation.js';

for (const modelCase of validateLocalModelRealTestCases(manifest, catalog, { candidateTasks: catalogTasks.tasks })) {
	test(`${modelCase.id}: downloads and executes ${modelCase.modelIds.join(' + ')}`, async ({ browserName: _browserName }, testInfo) => {
		const target = `${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform}-${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch}`;
		const models = modelCase.modelIds.map((id) => catalog.entries.find((entry) => entry.modelId === id));
		for (const [index, model] of models.entries()) expect(model,
			`${modelCase.modelIds[index]} needs a published catalog entry before its real installation test can run.`).toBeDefined();
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
			const run = await test.step('Execute the real model through Electron IPC', () => executeModelOperation(electron.page, {
				operation: modelCase.operation, expectedModels: models.map((model) => ({ modelId: model.modelId,
					version: model.version, artifactSha256s: model.artifacts.map((artifact) => artifact.sha256).sort() })), selectionFence,
				inputs: [input, ...(input.additionalInputs ?? [])].map((entry) => ({ base64: entry.bytes.toString('base64'),
					role: entry.role, mediaType: entry.mediaType, sha256: digest(entry.bytes) })),
				outputs: modelOutputReservations(modelCase.operation),
			}));
			await testInfo.attach('inference-evidence.json', { body: JSON.stringify({ caseId: modelCase.id,
				fixtureId: modelCase.fixtureId, sourceSha256, models, ...run,
				outputs: run.outputs.map(({ claim }) => claim) }, null, 2), contentType: 'application/json' });
			expect(run.outcome.outcome, JSON.stringify(run.outcome)).toBe('completed');
			const outputs = [];
			for (const [index, { claim, bytes }] of run.outputs.entries()) {
				const output = Buffer.from(bytes);
				expect(digest(output)).toBe(claim.sha256);
				expect(output.byteLength).toBe(claim.byteLength);
				await testInfo.attach(`model-output-${index + 1}.${claim.mediaType === 'audio/wav' ? 'wav' : 'bin'}`,
					{ body: output, contentType: claim.mediaType });
				outputs.push(output);
			}
			const summary = validateModelOutputs(modelCase.validation, outputs, input);
			await testInfo.attach('validation.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
		} finally {
			await electron.close();
		}
	});
}
