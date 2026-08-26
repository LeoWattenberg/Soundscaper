/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createAssistanceWorkflowNomicTokenizerResolverV1,
} from '../desktop/assistance-workflow-nomic-tokenizer-resolver.ts';
import type { InstalledLocalModel } from '../desktop/local-model-store.ts';
import type { AssistanceNomicTokenizerV1 } from
	'../src/common/editor/assistance/nomic-tokenizer-v1.ts';
import type { AssistanceWorkflowModelBindingV1 } from
	'../src/common/editor/assistance/workflow.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { nomicTokenizerArtifactFixture } from './assistance-nomic-tokenizer-fixture.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

const MODEL_ID = 'nomic-embed-text-v1.5';
const MODEL_VERSION = '1.5.0';
const STAGES = Object.freeze([
	'chunk-transcript', 'embed-transcript', 'publish-transcript-index',
]);

test('resolves the exact installed nomic tokenizer through authenticated model paths', async () => {
	await withHarness(async (harness) => {
		const tokenizer = await harness.resolve();
		assert.ok(tokenizer);
		assert.deepEqual(tokenizer.encode('Hello world'), [7592, 2088]);
		assert.equal(Object.isFrozen(tokenizer), true);
		assert.deepEqual(harness.resolvedModelIds, [MODEL_ID]);
	});
});

test('rejects foreign workflow authority and nomic model substitution before model lookup', async () => {
	await withHarness(async (harness) => {
		const foreignId = binding({ modelId: 'different-embedder' }, harness.binding.artifactSha256s);
		await assert.rejects(harness.resolve({ requestBinding: foreignId, callbackModel: foreignId }),
			/exact|nomic|identity/iu);
		const foreignVersion = binding({ version: '1.4.0' }, harness.binding.artifactSha256s);
		await assert.rejects(harness.resolve({
			requestBinding: foreignVersion, callbackModel: foreignVersion,
		}), /exact|nomic|version|identity/iu);
		await assert.rejects(harness.resolve({ callbackModel: {
			...harness.binding, artifactSha256s: ['f'.repeat(64)],
		} }), /callback|binding|correlate|authority/iu);
		assert.deepEqual(harness.resolvedModelIds, []);
	});
});

test('returns unavailable for absent, ambiguous, or binding-mismatched installed inventory', async () => {
	await withHarness(async (harness) => {
		harness.installed = [];
		assert.equal(await harness.resolve(), null);
		harness.installed = [harness.installation, harness.installation];
		assert.equal(await harness.resolve(), null);
		harness.installed = [Object.freeze({
			...harness.installation,
			artifacts: Object.freeze(harness.installation.artifacts.map((artifact, index) =>
				index === 0 ? Object.freeze({ ...artifact, sha256: 'e'.repeat(64) }) : artifact)),
		})];
		assert.equal(await harness.resolve(), null);
		assert.deepEqual(harness.resolvedModelIds, []);
	});
});

test('admits exactly the model graph plus four tokenizer/config artifact roles', async () => {
	await withHarness(async (harness) => {
		harness.installed = [Object.freeze({
			...harness.installation,
			artifacts: Object.freeze(harness.installation.artifacts.map((artifact) =>
				artifact.fileName === 'tokenizer_config.json'
					? Object.freeze({ ...artifact, fileName: 'tokenizer-copy.json' }) : artifact)),
		})];
		assert.equal(await harness.resolve(), null);

		harness.installed = [harness.installation];
		harness.paths = Object.freeze({ ...harness.paths, unexpected: harness.paths.config! });
		assert.equal(await harness.resolve(), null);
	});
});

test('turns authenticated path staleness, deletion, and digest drift into typed unavailability', async () => {
	await withHarness(async (harness) => {
		harness.resolveError = new Error(`${MODEL_ID} is not installed.`);
		assert.equal(await harness.resolve(), null);
		harness.resolveError = null;
		await unlink(harness.paths.tokenizer!);
		assert.equal(await harness.resolve(), null);
	});

	await withHarness(async (harness) => {
		const original = harness.bodies.tokenizer!;
		const altered = Uint8Array.from(original);
		altered[altered.byteLength - 1] = altered[altered.byteLength - 1] === 0x7d ? 0x7c : 0x7d;
		await writeFile(harness.paths.tokenizer!, altered);
		assert.equal(await harness.resolve(), null);
	});
});

test('returns unavailable when authenticated bytes violate pinned tokenizer semantics or bounds', async () => {
	await withHarness(async (harness) => {
		const tokenizerConfig = harness.installation.artifacts.find(
			({ fileName }) => fileName === 'tokenizer_config.json',
		)!;
		harness.installed = [Object.freeze({
			...harness.installation,
			artifacts: Object.freeze(harness.installation.artifacts.map((artifact) =>
				artifact === tokenizerConfig
					? Object.freeze({ ...artifact, byteLength: 1024 * 1024 + 1 }) : artifact)),
		})];
		assert.equal(await harness.resolve(), null);
	});

	await withHarness(async (harness) => {
		const invalid = new TextEncoder().encode('{}');
		await writeFile(harness.paths.tokenizer_config!, invalid);
		const digest = sha256(invalid);
		const artifacts = harness.installation.artifacts.map((artifact) =>
			artifact.fileName === 'tokenizer_config.json'
				? Object.freeze({ ...artifact, byteLength: invalid.byteLength, sha256: digest }) : artifact);
		harness.installed = [Object.freeze({
			...harness.installation, artifacts: Object.freeze(artifacts),
		})];
		const digests = artifacts.map(({ sha256: value }) => value).sort();
		const matching = binding({}, digests);
		assert.equal(await harness.resolve({ requestBinding: matching, callbackModel: matching }), null);
	});
});

test('propagates cancellation before lookup and after authenticated path resolution', async () => {
	await withHarness(async (harness) => {
		const before = new AbortController();
		before.abort();
		await assert.rejects(harness.resolve({ signal: before.signal }), { name: 'AbortError' });
		assert.deepEqual(harness.resolvedModelIds, []);

		const during = new AbortController();
		harness.afterResolve = () => during.abort();
		await assert.rejects(harness.resolve({ signal: during.signal }), { name: 'AbortError' });
	});
});

interface ResolveOverrides {
	readonly requestBinding?: AssistanceWorkflowModelBindingV1;
	readonly callbackModel?: AssistanceWorkflowModelBindingV1;
	readonly signal?: AbortSignal;
}

interface Harness {
	readonly binding: AssistanceWorkflowModelBindingV1;
	readonly installation: InstalledLocalModel;
	readonly bodies: Readonly<Record<string, Uint8Array>>;
	readonly resolvedModelIds: string[];
	installed: readonly InstalledLocalModel[];
	paths: Readonly<Record<string, string>>;
	resolveError: Error | null;
	afterResolve: (() => void) | null;
	resolve(overrides?: ResolveOverrides): Promise<AssistanceNomicTokenizerV1 | null>;
}

async function createHarness(directory: string): Promise<Harness> {
	const tokenizer = nomicTokenizerArtifactFixture();
	const bodies = Object.freeze({
		model_quantized: Uint8Array.of(1, 2, 3, 4),
		tokenizer: tokenizer.tokenizer,
		tokenizer_config: tokenizer.tokenizerConfig,
		special_tokens_map: tokenizer.specialTokensMap,
		config: tokenizer.config,
	});
	const artifacts = await Promise.all(Object.entries(bodies).map(async ([role, bytes]) => {
		const fileName = `${role}${role === 'model_quantized' ? '.onnx' : '.json'}`;
		await writeFile(join(directory, fileName), bytes);
		return Object.freeze({ fileName, byteLength: bytes.byteLength, sha256: sha256(bytes) });
	}));
	const installation = Object.freeze({ modelId: MODEL_ID, version: MODEL_VERSION,
		artifacts: Object.freeze(artifacts),
		totalBytes: artifacts.reduce((total, artifact) => total + artifact.byteLength, 0),
	});
	const exactBinding = binding({}, artifacts.map(({ sha256: value }) => value).sort());
	const harness: Harness = {
		binding: exactBinding,
		installation,
		bodies,
		installed: [installation],
		paths: Object.freeze(Object.fromEntries(Object.keys(bodies).map((role) =>
			[role, join(directory, `${role}${role === 'model_quantized' ? '.onnx' : '.json'}`)]))),
		resolvedModelIds: [],
		resolveError: null,
		afterResolve: null,
		async resolve(overrides = {}) {
			const requestBinding = overrides.requestBinding ?? exactBinding;
			const request = workflow(requestBinding);
			const resolver = createAssistanceWorkflowNomicTokenizerResolverV1({ models: {
				listInstalled: async () => harness.installed,
				resolveModelPaths: async (modelId) => {
					harness.resolvedModelIds.push(modelId);
					if (harness.resolveError) throw harness.resolveError;
					harness.afterResolve?.();
					return harness.paths;
				},
			} });
			return await resolver({ request, model: overrides.callbackModel ?? requestBinding,
				signal: overrides.signal ?? new AbortController().signal });
		},
	};
	return harness;
}

function workflow(model: AssistanceWorkflowModelBindingV1) {
	const jobId = '01'.repeat(20);
	const settings = defaultAssistanceWorkflowSettingsV1('index-transcript');
	return assistanceWorkflowFixture({
		jobId, workflowId: 'index-transcript', settings, stageIds: STAGES, models: [model],
		inputs: [
			claim('input', jobId, 'chunk-transcript', 'transcript', 1),
			claim('input', jobId, 'embed-transcript', 'text-chunks', 2),
			claim('input', jobId, 'publish-transcript-index', 'text-chunks', 3),
			claim('input', jobId, 'publish-transcript-index', 'embeddings', 4),
		],
		outputs: [
			claim('output', jobId, 'chunk-transcript', 'text-chunks', 5),
			claim('output', jobId, 'embed-transcript', 'embeddings', 6),
			claim('output', jobId, 'publish-transcript-index', 'transcript-index', 7),
		],
	});
}

function binding(
	overrides: Partial<AssistanceWorkflowModelBindingV1>, digests: readonly string[],
): AssistanceWorkflowModelBindingV1 {
	return Object.freeze({ bindingVersion: 1, stageId: 'embed-transcript',
		slotId: 'text-embedder', modelId: MODEL_ID, version: MODEL_VERSION,
		artifactSha256s: Object.freeze([...digests]), ...overrides });
}

function claim(
	direction: 'input' | 'output', jobId: string, stageId: string, slotId: string, index: number,
) {
	return Object.freeze({ claimVersion: 1 as const, direction,
		claimId: index.toString(16).padStart(40, '0'), jobId, stageId, slotId });
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'assistance-nomic-resolver-'));
	try { await run(await createHarness(directory)); }
	finally { await rm(directory, { recursive: true, force: true }); }
}
