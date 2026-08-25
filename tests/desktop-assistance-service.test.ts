/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	AssistanceInstallCancelledError,
	createAssistanceService,
} from '../desktop/assistance-service.ts';
import { LocalModelCapacity } from '../desktop/local-model-capacity.ts';
import { localModelBlobName } from '../desktop/local-model-store.ts';
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

const EVIDENCE = testLocalModelEvidence('silero-vad-v6', {
	attributionRequired: true,
	purpose: 'Voice activity detection for the test assistance pipeline.',
	codeLicense: 'MIT',
	weightsLicense: 'MIT',
	provenanceSources: Object.freeze(['https://upstream.invalid/repo']),
});
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

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
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

test('capacity is admitted before the first model download request', { timeout: 20_000 }, async (t) => {
	let fetches = 0;
	const capacity = new LocalModelCapacity({
		statfsImpl: async () => ({ bavail: 1n, bsize: 1n }),
	});
	const service = await serviceIn(t, {
		capacity,
		fetchImpl: (() => { fetches += 1; throw new Error('must not fetch'); }) as typeof fetch,
	});

	await assert.rejects(service.install('silero-vad-v6'), /available disk space/iu);
	assert.equal(fetches, 0);
});

test('install cancellation is typed and acknowledges only after transfer quiescence', { timeout: 20_000 }, async (t) => {
	const transferStarted = deferred<void>();
	const cleanupStarted = deferred<void>();
	const releaseCleanup = deferred<void>();
	const fetchImpl = (async (_url: unknown, init?: { signal?: AbortSignal }) => ({
		status: 200,
		headers: { get: () => String(ENCODER.length) },
		body: (async function* stream() {
			try {
				transferStarted.resolve();
				await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
				init?.signal?.throwIfAborted();
				yield new Uint8Array(Buffer.from(ENCODER));
			} finally {
				cleanupStarted.resolve();
				await releaseCleanup.promise;
			}
		})(),
	})) as unknown as typeof fetch;
	const service = await serviceIn(t, { fetchImpl });
	const install = service.install('silero-vad-v6');
	void install.catch(() => undefined);
	await transferStarted.promise;

	let acknowledged = false;
	const cancellation = service.cancelInstall('silero-vad-v6').then((result) => {
		acknowledged = true;
		return result;
	});
	await cleanupStarted.promise;
	assert.equal(acknowledged, false, 'the helper body has not quiesced yet');
	releaseCleanup.resolve();

	assert.deepEqual(await cancellation, {
		contractVersion: 1, modelId: 'silero-vad-v6', outcome: 'cancelled',
	});
	await assert.rejects(install, (error: unknown) => {
		assert.ok(error instanceof AssistanceInstallCancelledError);
		assert.equal(error.code, 'ASSISTANCE_INSTALL_CANCELLED');
		assert.equal(error.modelId, 'silero-vad-v6');
		return true;
	});
	assert.deepEqual(await service.cancelInstall('silero-vad-v6'), {
		contractVersion: 1, modelId: 'silero-vad-v6', outcome: 'not-active',
	});
});

test('an explicit seed-directory install has no network fallback', { timeout: 20_000 }, async (t) => {
	const source = await mkdtemp(join(tmpdir(), 'scape-assistance-seed-'));
	t.after(() => rm(source, { recursive: true, force: true }));
	await writeFile(join(source, 'encoder.onnx'), ENCODER);
	await writeFile(join(source, 'tokens.txt'), TOKENS);
	let fetches = 0;
	const service = await serviceIn(t, {
		fetchImpl: (() => { fetches += 1; throw new Error('must not fetch'); }) as typeof fetch,
	});

	const installed = await service.installPreseeded('silero-vad-v6', source);
	assert.equal(installed.availability, 'installed');
	assert.equal(fetches, 0);
	assert.equal((await service.listInstalled())[0]?.modelId, 'silero-vad-v6');
});

test('offline install cancellation also waits for the active filesystem operation', { timeout: 20_000 }, async (t) => {
	const source = await mkdtemp(join(tmpdir(), 'scape-assistance-seed-cancel-'));
	t.after(() => rm(source, { recursive: true, force: true }));
	await writeFile(join(source, 'encoder.onnx'), ENCODER);
	await writeFile(join(source, 'tokens.txt'), TOKENS);
	const capacityEntered = deferred<void>();
	const releaseCapacity = deferred<void>();
	class DelayedCapacity extends LocalModelCapacity {
		override async reserve(rootPath: string, byteLength: number) {
			capacityEntered.resolve();
			await releaseCapacity.promise;
			return super.reserve(rootPath, byteLength);
		}
	}
	const service = await serviceIn(t, { capacity: new DelayedCapacity() });
	const install = service.installPreseeded('silero-vad-v6', source);
	void install.catch(() => undefined);
	await capacityEntered.promise;

	let acknowledged = false;
	const cancellation = service.cancelInstall('silero-vad-v6').then((result) => {
		acknowledged = true;
		return result;
	});
	await Promise.resolve();
	assert.equal(acknowledged, false);
	releaseCapacity.resolve();

	assert.equal((await cancellation).outcome, 'cancelled');
	await assert.rejects(install, AssistanceInstallCancelledError);
	assert.deepEqual(await service.listInstalled(), []);
});

test('direct content-addressed pre-seeds reconcile with zero network', { timeout: 20_000 }, async (t) => {
	let fetches = 0;
	const service = await serviceIn(t, {
		fetchImpl: (() => { fetches += 1; throw new Error('must not fetch'); }) as typeof fetch,
	});
	await mkdir(join(service.modelsDirectory, 'blobs'), { recursive: true });
	await writeFile(join(service.modelsDirectory, 'blobs', localModelBlobName(digest(ENCODER))), ENCODER);
	await writeFile(join(service.modelsDirectory, 'blobs', localModelBlobName(digest(TOKENS))), TOKENS);

	const report = await service.reconcilePreseeded();
	assert.deepEqual(report.installedModelIds, ['silero-vad-v6']);
	assert.equal(fetches, 0);
	assert.equal((await service.status()).models[0]?.availability, 'installed');
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

test('a stale installed manifest does not impersonate the current catalog entry', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	await service.install('silero-vad-v6');
	const manifestPath = join(service.modelsDirectory, 'manifests', 'silero-vad-v6.json');
	const manifest = JSON.parse(String(await readFile(manifestPath))) as Record<string, unknown>;
	await writeFile(manifestPath, `${JSON.stringify({ ...manifest, version: 'older' })}\n`);

	const model = (await service.status()).models[0];
	assert.equal(model?.availability, 'installable');
	assert.equal(model?.installedBytes, null);
	await assert.rejects(
		service.resolveModelPaths('silero-vad-v6'),
		/does not match the current authenticated catalog/iu,
	);
});

test('removing a model reclaims its bytes and returns it to installable', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	await service.install('silero-vad-v6');

	assert.equal(await service.remove('silero-vad-v6'), ENCODER.length + TOKENS.length);
	assert.deepEqual(await service.listInstalled(), []);
	assert.equal((await service.status()).models[0]?.availability, 'installable');
});

test('garbage collection and installed notices are explicit authenticated service operations', { timeout: 20_000 }, async (t) => {
	const service = await serviceIn(t);
	await service.install('silero-vad-v6');
	const orphanContents = 'orphaned bytes';
	const orphanDigest = digest(orphanContents);
	await writeFile(
		join(service.modelsDirectory, 'blobs', localModelBlobName(orphanDigest)),
		orphanContents,
	);

	const notices = await service.installedNotices();
	assert.equal(notices[0]?.modelId, 'silero-vad-v6');
	assert.equal(notices[0]?.attributionRequired, true);
	assert.equal(notices[0]?.weightsLicense, 'MIT');
	const collection = await service.garbageCollect();
	assert.equal(collection.reclaimedBlobBytes, orphanContents.length);
});

test('service relocation changes authority only after verified settings persistence', { timeout: 20_000 }, async (t) => {
	const targetParent = await mkdtemp(join(tmpdir(), 'scape-assistance-relocate-'));
	t.after(() => rm(targetParent, { recursive: true, force: true }));
	const target = join(targetParent, 'models');
	let persisted: string | null = null;
	const service = await serviceIn(t, {
		persistModelsDirectory: async (directory: string) => { persisted = directory; },
	});
	await service.install('silero-vad-v6');
	const source = service.modelsDirectory;

	const result = await service.relocate(target);
	assert.equal(persisted, target);
	assert.equal(result.sourceRemoved, true);
	assert.equal(service.modelsDirectory, target);
	assert.equal((await service.status()).models[0]?.availability, 'installed');
	await assert.rejects(lstat(source), /ENOENT/iu);
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
