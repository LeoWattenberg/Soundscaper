/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AssistanceDerivativeRepository,
	createAssistanceDerivativeIdentityV1,
} from '../src/common/editor/storage/assistance-derivative-repository.ts';
import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);

test('assistance derivative identities bind project, sources, timing, and exact models', () => {
	const base = workflow();
	const identity = createAssistanceDerivativeIdentityV1(base, 'embeddings');
	const retried = workflow();
	retried.jobId = '9'.repeat(40);
	retried.inputs[0].jobId = retried.jobId;
	retried.inputs[0].claimId = '8'.repeat(40);
	retried.outputs[0].jobId = retried.jobId;
	retried.outputs[0].claimId = '7'.repeat(40);
	assert.equal(createAssistanceDerivativeIdentityV1(retried, 'embeddings').key, identity.key,
		'job and transport claim identities are intentionally reusable cache noise');

	for (const changed of [
		() => { const value = workflow(); value.fence.projectId = 'project-b'; return value; },
		() => { const value = workflow(); value.fence.sourceRanges[0].sourceStartFrame = 1; return value; },
		() => { const value = workflow(); value.fence.sourceRanges[0].sourceSampleRate = 44_100; return value; },
		() => { const value = workflow(); value.fence.sourceRanges[0].timingAuthoritySha256 = SHA_D; return value; },
		() => {
			const value = workflow();
			value.models[0].artifactSha256s = [SHA_D];
			value.fence.modelBindingsSha256 = assistanceWorkflowModelBindingsSha256V1(value.models);
			return value;
		},
	]) {
		assert.notEqual(createAssistanceDerivativeIdentityV1(changed(), 'embeddings').key, identity.key);
	}
	for (const changed of [
		() => { const value = workflow(); value.recipeVersion = 2; return value; },
		() => { const value = workflow(); value.settingsVersion = 2; return value; },
	]) assert.throws(() => createAssistanceDerivativeIdentityV1(changed(), 'embeddings'),
		/unsupported|disagrees/iu);
	assert.notEqual(createAssistanceDerivativeIdentityV1(base, 'recognized-text').key, identity.key);
	assert.notEqual(createAssistanceDerivativeIdentityV1(base, 'visual-index').key, identity.key);
	assert.match(identity.key, /^assistance-derivative-v1:[a-f0-9]{64}:[a-f0-9]{64}$/u);
});

test('assistance derivatives round-trip authenticated bytes without entering project state', async () => {
	const fixture = repositoryFixture();
	const source = Uint8Array.of(1, 2, 3, 4);
	const saved = await fixture.repository.save(workflow(), 'embeddings', {
		mediaType: 'application/vnd.soundscaper.embedding-matrix-v1', bytes: source,
	});
	source[0] = 99;
	const loaded = await fixture.repository.load(workflow(), 'embeddings');

	assert.equal(saved.payloadByteLength, 4);
	assert.deepEqual(loaded?.bytes, Uint8Array.of(1, 2, 3, 4));
	assert.notEqual(loaded?.bytes, saved.bytes);
	assert.equal(fixture.memory.projects.size, 0);
	assert.equal(fixture.keys().length, 1);
	const same = await fixture.repository.save(workflow(), 'embeddings', {
		mediaType: 'application/vnd.soundscaper.embedding-matrix-v1', bytes: Uint8Array.of(1, 2, 3, 4),
	});
	assert.equal(same.key, saved.key);
	await assert.rejects(fixture.repository.save(workflow(), 'embeddings', {
		mediaType: 'application/vnd.soundscaper.embedding-matrix-v1', bytes: Uint8Array.of(4, 3, 2, 1),
	}), /deterministic|disagree|collision/iu);
});

test('project-scoped derivative listing reopens authenticated records without crossing projects', async () => {
	const fixture = repositoryFixture();
	const first = workflow();
	const second = workflow();
	second.fence.sourceRanges[0].sourceStartFrame = 10;
	second.fence.sourceRanges[0].sourceEndFrame = 110;
	const otherProject = workflow();
	otherProject.fence.projectId = 'project-b';
	await fixture.repository.save(first, 'embeddings', payload([1]));
	await fixture.repository.save(second, 'visual-index', payload([2]));
	await fixture.repository.save(otherProject, 'embeddings', payload([3]));

	const listed = await fixture.repository.listProject('project-a');
	assert.deepEqual(listed.map(({ kind, bytes }) => [kind, [...bytes]]), [
		['embeddings', [1]], ['visual-index', [2]],
	]);
	assert.deepEqual(await fixture.repository.listProject('project-a', ['visual-index']), [listed[1]]);
	listed[0]!.bytes[0] = 99;
	assert.deepEqual((await fixture.repository.listProject('project-a'))[0]?.bytes, Uint8Array.of(1));
});

test('assistance derivative eviction is bounded and project purge cannot cross isolation scopes', async () => {
	let now = 1_000;
	const fixture = repositoryFixture({ maximumBytes: 8, maximumEntries: 2, maximumAgeMs: 1_000 }, () => now);
	const first = workflow();
	const second = workflow();
	second.fence.sourceRanges[0].sourceStartFrame = 10;
	second.fence.sourceRanges[0].sourceEndFrame = 110;
	const otherProject = workflow();
	otherProject.fence.projectId = 'project-b';

	await fixture.repository.save(first, 'audio-tags', payload([1, 1, 1, 1]));
	now += 1;
	await fixture.repository.save(second, 'audio-tags', payload([2, 2, 2, 2]));
	now += 1;
	await fixture.repository.save(otherProject, 'audio-tags', payload([3, 3, 3, 3]));

	assert.equal(await fixture.repository.load(first, 'audio-tags'), null, 'oldest derivative is evicted');
	assert.ok(await fixture.repository.load(second, 'audio-tags'));
	assert.ok(await fixture.repository.load(otherProject, 'audio-tags'));
	assert.equal(await fixture.repository.purgeProject('project-a'), 1);
	assert.equal(await fixture.repository.load(second, 'audio-tags'), null);
	assert.ok(await fixture.repository.load(otherProject, 'audio-tags'));
});

test('corrupt, expired, oversized, and externally deleted derivatives fail as cache misses or refusals', async () => {
	let now = 1_000;
	const fixture = repositoryFixture({ maximumBytes: 4, maximumEntries: 2, maximumAgeMs: 10 }, () => now);
	const saved = await fixture.repository.save(workflow(), 'shot-table', payload([1, 2, 3, 4]));
	const row = fixture.memory.analysis.get(saved.key) as { key: string; value: Record<string, unknown> };
	(row.value.bytes as Uint8Array)[0] = 9;
	assert.equal(await fixture.repository.load(workflow(), 'shot-table'), null);
	assert.equal(fixture.keys().length, 0, 'a corrupt owned row is discarded');

	await fixture.repository.save(workflow(), 'shot-table', payload([1, 2, 3, 4]));
	now = 1_010;
	assert.equal(await fixture.repository.load(workflow(), 'shot-table'), null, 'exact age boundary expires');
	await assert.rejects(fixture.repository.save(workflow(), 'shot-table', payload([1, 2, 3, 4, 5])),
		/cannot fit|limit/iu);
	fixture.memory.analysis.clear();
	assert.equal(await fixture.repository.load(workflow(), 'shot-table'), null,
		'external deletion is an ordinary reproducible cache miss');
});

function payload(values: readonly number[]) {
	return { mediaType: 'application/json', bytes: Uint8Array.from(values) };
}

function repositoryFixture(
	limits = { maximumBytes: 512 * 1024 * 1024, maximumEntries: 4_095, maximumAgeMs: 30_000 },
	now: () => number = () => 1_000,
) {
	const memory = getMemoryDatabase(`assistance-derivative-${String(Date.now())}-${Math.random().toString(16)}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	return {
		memory,
		repository: new AssistanceDerivativeRepository(port, { limits, now }),
		keys: () => [...memory.analysis.keys()].filter((key) => key.startsWith('assistance-derivative-v1:')),
	};
}

function workflow() {
	const jobId = '1'.repeat(40);
	const workflowId = 'advanced:text-embedding' as const;
	const stageIds = ['run-text-embedding'];
	const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
	const models = [{
		bindingVersion: 1 as const, stageId: 'run-text-embedding', slotId: 'model',
		modelId: 'nomic-embed-text-v1.5', version: '1.5.0', artifactSha256s: [SHA_C],
	}];
	return {
		contractVersion: 1,
		jobId,
		workflowId,
		recipeVersion: 1,
		settingsVersion: 1,
		settings,
		fence: {
			fenceVersion: 1,
			projectId: 'project-a', schemaVersion: 30, revision: 4, sequenceId: 'main',
			sourceRanges: [{
				slotId: 'audio', mediaKind: 'audio', sourceId: 'source-a', sourceSha256: SHA_A,
				sourceSampleRate: 48_000, occurrenceIds: ['clip-a'],
				sourceStartFrame: 0, sourceEndFrame: 100,
				linkMembershipSha256: SHA_B, timingAuthoritySha256: SHA_C, retimeKind: 'identity',
			}],
			transcriptBodySha256: null,
			recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
			settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
			modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
		},
		stageIds,
		models,
		inputs: [{
			claimVersion: 1, direction: 'input', claimId: '2'.repeat(40), jobId,
			stageId: 'run-text-embedding', slotId: 'text',
		}],
		outputs: [{
			claimVersion: 1, direction: 'output', claimId: '3'.repeat(40), jobId,
			stageId: 'run-text-embedding', slotId: 'embeddings',
		}],
	};
}
