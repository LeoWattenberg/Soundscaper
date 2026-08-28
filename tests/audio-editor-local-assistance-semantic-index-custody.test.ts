/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
	createAssistanceSemanticDerivativeBundleV1,
} from '../src/common/editor/assistance/semantic-derivative-bundle-v1.ts';
import { createLocalAssistanceSemanticIndexCustodyV1 } from
	'../src/common/editor/controller/local-assistance-semantic-index-custody.ts';
import { AssistanceDerivativeRepository } from
	'../src/common/editor/storage/assistance-derivative-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

const PROJECT_IDENTITY = Object.freeze({ schemaFamily: 'framescaper' as const, schemaVersion: 1 as const });

test('semantic custody reopens current transcript, visual, and OCR indexes from disposable records',
	async () => {
		const repository = derivativeRepository();
		const workflow = assistanceWorkflowFixture();
		await repository.save(workflow, 'embeddings', payload('transcript', [[1, 0]], [{
			resultId: 'shared', timelineFrame: 100, label: 'spoken launch plan',
		}], []));
		await repository.save(workflow, 'visual-index', payload('visual', [[1, 0]], [{
			resultId: 'shared', timelineFrame: 100, label: 'launch slide',
		}], [{ resultId: 'shared', timelineFrame: 100, label: 'Launch Plan' }]));
		const custody = createLocalAssistanceSemanticIndexCustodyV1(repository);
		const loaded = await custody.loadAuthenticated({
			...PROJECT_IDENTITY, projectId: 'project-a', projectRevision: 8,
		}, new AbortController().signal) as {
			records: readonly { kind: string }[];
			index: { transcript: { rows: readonly unknown[] }; visual: { rows: readonly unknown[] };
				ocr: readonly unknown[] };
		};
		assert.deepEqual(loaded.records.map(({ kind }) => kind), ['embeddings', 'visual-index']);
		assert.equal(loaded.index.transcript.rows.length, 1);
		assert.equal(loaded.index.visual.rows.length, 1);
		assert.equal(loaded.index.ocr.length, 1);
	});

test('semantic custody treats stale, deleted, or semantically corrupt records as unavailable', async () => {
	const repository = derivativeRepository();
	const workflow = assistanceWorkflowFixture();
	await repository.save(workflow, 'embeddings', payload('transcript', [[1, 0]], [{
		resultId: 'chunk:0', timelineFrame: 10, label: 'hello',
	}], []));
	const custody = createLocalAssistanceSemanticIndexCustodyV1(repository);
	assert.equal(await custody.loadAuthenticated({
		...PROJECT_IDENTITY, projectId: 'project-a', projectRevision: 9,
	}, new AbortController().signal), null);
	await repository.purgeProject('project-a');
	assert.equal(await custody.loadAuthenticated({
		...PROJECT_IDENTITY, projectId: 'project-a', projectRevision: 8,
	}, new AbortController().signal), null);
});

function payload(
	provider: 'transcript' | 'visual',
	vectors: readonly (readonly number[])[],
	rows: readonly Readonly<{ resultId: string; timelineFrame: number; label: string }>[],
	ocr: readonly Readonly<{ resultId: string; timelineFrame: number; label: string }>[],
) {
	return { mediaType: ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
		bytes: createAssistanceSemanticDerivativeBundleV1({
			provider, ...PROJECT_IDENTITY,
			projectId: 'project-a', projectRevision: 8, sequenceId: 'sequence-a',
			sourceId: 'source-a', matrix: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors }),
			rows, ocr,
		}) };
}

function derivativeRepository(): AssistanceDerivativeRepository {
	const memory = getMemoryDatabase(`semantic-custody-${String(Date.now())}-${Math.random().toString(16)}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	return new AssistanceDerivativeRepository(port);
}
