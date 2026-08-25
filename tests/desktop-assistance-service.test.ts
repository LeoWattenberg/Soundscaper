/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAssistanceService } from '../desktop/assistance-service.ts';
import {
	signedTestLocalModelCatalog,
	testLocalModelEvidence,
	testLocalModelEvidencePin,
	TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS,
} from './helpers/local-model-catalog-v2-fixture.ts';

const GIB = 1024 ** 3;
const ENCODER = 'encoder weights';
const TOKENS = 'token list';

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

const EVIDENCE = testLocalModelEvidence('silero-vad-v6', { attributionRequired: true });
const CATALOG = signedTestLocalModelCatalog({
	schemaVersion: 2,
	publication: {
		bucket: 'soundscaper-assets',
		prefix: 'models',
		publicBaseUrl: 'https://assets.soundscaper.org/models/',
		jurisdiction: 'eu',
	},
	entries: [
		{
			modelId: 'silero-vad-v6',
			version: '6.2.1',
			task: 'voice-activity-detection',
			platforms: ['linux-x64'],
			minimumMemoryBytes: 2 * GIB,
			licensingEvidence: testLocalModelEvidencePin(EVIDENCE),
			upstream: {
				source: 'https://upstream.invalid/repo',
				revision: 'abc123',
				artifacts: [
					{ fileName: 'encoder.onnx', byteLength: ENCODER.length, sha256: digest(ENCODER), url: 'https://upstream.invalid/encoder.onnx' },
					{ fileName: 'tokens.txt', byteLength: TOKENS.length, sha256: digest(TOKENS), url: 'https://upstream.invalid/tokens.txt' },
				],
			},
			distribution: { kind: 'identity-mirrored' },
			artifacts: [
				{ fileName: 'encoder.onnx', byteLength: ENCODER.length, sha256: digest(ENCODER), url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/encoder.onnx' },
				{ fileName: 'tokens.txt', byteLength: TOKENS.length, sha256: digest(TOKENS), url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/tokens.txt' },
			],
		},
	],
});

const BODIES = new Map([
	['https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/encoder.onnx', ENCODER],
	['https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/tokens.txt', TOKENS],
]);

function stubFetch(): typeof fetch {
	return (async (url: unknown) => {
		const body = BODIES.get(String(url));
		if (body === undefined) return { status: 404, headers: { get: () => null }, body: null };
		return {
			status: 200,
			headers: { get: () => String(body.length) },
			body: (async function* stream() { yield new Uint8Array(Buffer.from(body)); })(),
		};
	}) as unknown as typeof fetch;
}

function runtimeStub(available: boolean, reason: string | null = null) {
	return {
		status: async () => ({ available, reason, moduleId: 'sherpa-onnx-node' }),
		recognize: async () => ({ language: null, segments: [] }),
	};
}

async function serviceIn(t: { after: (fn: () => unknown) => void }, overrides = {}) {
	const userDataPath = await mkdtemp(join(tmpdir(), 'scape-assistance-service-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	return createAssistanceService({
		userDataPath,
		catalog: CATALOG,
		licensingEvidence: [EVIDENCE],
		catalogSignatureOptions: TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS,
		runtime: runtimeStub(true),
		platform: 'linux-x64',
		totalMemoryBytes: 16 * GIB,
		fetchImpl: stubFetch(),
		...overrides,
	});
}

test('status reports the models directory and every offered model', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	const status = await service.status();

	assert.ok(status.modelsDirectory.endsWith(join('models')), 'the default lives under userData');
	assert.equal(status.runtimeAvailable, true);
	assert.deepEqual(status.models.map(({ modelId, availability }) => [modelId, availability]), [
		['silero-vad-v6', 'installable'],
	]);
	assert.equal(status.models[0]?.downloadBytes, ENCODER.length + TOKENS.length);
	assert.equal(status.models[0]?.installedBytes, null);
	assert.equal(status.models[0]?.attributionRequired, true);
});

test('a chosen models directory overrides the default', { timeout: 20_000 }, async (t) => {
	const chosen = await mkdtemp(join(tmpdir(), 'scape-chosen-models-'));
	t.after(() => rm(chosen, { recursive: true, force: true }));
	const service = await serviceIn(t, { settingsDirectory: chosen });

	assert.equal(service.modelsDirectory, chosen);
	assert.equal((await service.status()).modelsDirectory, chosen);
});

test('installing fetches, verifies, and reports the model as installed', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	const progress: string[] = [];

	const view = await service.install('silero-vad-v6', ({ fileName, completedBytes }) => {
		progress.push(`${fileName}:${completedBytes}`);
	});

	assert.equal(view.availability, 'installed');
	assert.equal(view.installedBytes, ENCODER.length + TOKENS.length);
	assert.equal(view.attributionRequired, true);
	assert.deepEqual(progress, [`encoder.onnx:${ENCODER.length}`, `tokens.txt:${TOKENS.length}`]);

	const status = await service.status();
	assert.equal(status.models[0]?.availability, 'installed');
	assert.equal(status.models[0]?.installedBytes, ENCODER.length + TOKENS.length);
});

test('a model outside the authenticated catalog cannot be installed', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);

	await assert.rejects(service.install('absent-model'), /not offered by this build/iu);
});

test('installed artifacts resolve to store paths by role', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	await service.install('silero-vad-v6');

	const paths = await service.resolveModelPaths('silero-vad-v6');
	assert.deepEqual(Object.keys(paths).sort(), ['encoder', 'tokens']);
	assert.ok(paths.encoder?.includes(`sha256-${digest(ENCODER)}`), 'paths are content-addressed');

	await assert.rejects(service.resolveModelPaths('absent-model'), /is not installed/iu);
});

test('runtime path resolution rehashes installed artifacts', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	await service.install('silero-vad-v6');
	const paths = await service.resolveModelPaths('silero-vad-v6');
	await writeFile(paths.encoder as string, 'tampered weights');

	await assert.rejects(
		service.resolveModelPaths('silero-vad-v6'),
		/failed its integrity check/iu,
	);
});

test('removing a model reclaims its bytes and returns it to installable', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	await service.install('silero-vad-v6');

	assert.equal(await service.remove('silero-vad-v6'), ENCODER.length + TOKENS.length);
	assert.deepEqual(await service.listInstalled(), []);
	assert.equal((await service.status()).models[0]?.availability, 'installable');
});

test('an unavailable runtime is reported rather than hidden', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t, {
		runtime: runtimeStub(false, 'The optional speech runtime is not installed.'),
	});

	const status = await service.status();
	assert.equal(status.runtimeAvailable, false);
	assert.match(status.runtimeReason ?? '', /not installed/iu);
	assert.equal(status.models[0]?.availability, 'installable', 'models install without the runtime');
});

test('a catalog that disagrees with the licensing register fails at construction', { timeout: 20_000 }, async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'scape-assistance-service-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));

	assert.throws(
		() => createAssistanceService({
			userDataPath,
			catalog: CATALOG,
			licensingEvidence: [],
			catalogSignatureOptions: TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS,
			runtime: runtimeStub(true),
		}),
		/needs exactly one licensing evidence record/iu,
		'a build whose catalog and register disagree fails at startup',
	);
});

test('a machine that cannot run a model still reports it honestly', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t, { platform: 'win32-arm64', totalMemoryBytes: 1 * GIB });

	assert.equal((await service.status()).models[0]?.availability, 'unsupported-platform');
});
