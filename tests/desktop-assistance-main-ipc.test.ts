/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assistanceServiceFrom,
	registerAssistanceIpc,
} from '../desktop/assistance-main-ipc.ts';
import {
	signedTestLocalModelCatalog,
	testLocalModelEvidence,
	testLocalModelEvidencePin,
	TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS,
} from './helpers/local-model-catalog-v2-fixture.ts';

const CHANNELS = Object.freeze({
	listAssistanceModels: 'soundscaper:v1:assistance:list',
	installAssistanceModel: 'soundscaper:v1:assistance:install',
	cancelAssistanceModelInstall: 'soundscaper:v1:assistance:install:cancel',
	installPreseededAssistanceModel: 'soundscaper:v1:assistance:install-preseeded',
	reconcileAssistanceModels: 'soundscaper:v1:assistance:reconcile',
	collectAssistanceModelGarbage: 'soundscaper:v1:assistance:garbage-collect',
	listAssistanceModelNotices: 'soundscaper:v1:assistance:notices',
	relocateAssistanceModels: 'soundscaper:v1:assistance:relocate',
	removeAssistanceModel: 'soundscaper:v1:assistance:remove',
	assistanceInstallProgress: 'soundscaper:v1:event:assistance-progress',
});

const EVIDENCE = testLocalModelEvidence('silero-vad-v6');
const CATALOG = signedTestLocalModelCatalog({
	schemaVersion: 2,
	publication: {
		bucket: 'soundscaper-assets',
		prefix: 'models',
		publicBaseUrl: 'https://assets.soundscaper.org/models/',
		jurisdiction: 'eu',
	},
	entries: [{
		modelId: 'silero-vad-v6',
		version: '6.2.1',
		task: 'voice-activity-detection',
		platforms: ['linux-x64'],
		minimumMemoryBytes: 1024,
		licensingEvidence: testLocalModelEvidencePin(EVIDENCE),
		upstream: {
			source: 'https://upstream.invalid/repo',
			revision: 'abc123',
			artifacts: [{
				fileName: 'model.onnx', byteLength: 1, sha256: 'a'.repeat(64),
				url: 'https://upstream.invalid/model.onnx',
			}],
		},
		distribution: { kind: 'identity-mirrored' },
		artifacts: [{
			fileName: 'model.onnx', byteLength: 1, sha256: 'a'.repeat(64),
			url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/model.onnx',
		}],
	}],
});

function harness(service: unknown, pickers: {
	choosePreseedDirectory?: (modelId: string) => Promise<string | null>;
	chooseRelocationDirectory?: () => Promise<string | null>;
} = {}) {
	const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
	const sent: [string, unknown][] = [];
	let built = 0;
	registerAssistanceIpc({
		channels: CHANNELS,
		handle: (channel, listener) => handlers.set(channel, listener),
		sendToRenderer: (channel, payload) => sent.push([channel, payload]),
		choosePreseedDirectory: pickers.choosePreseedDirectory ?? (async () => null),
		chooseRelocationDirectory: pickers.chooseRelocationDirectory ?? (async () => null),
		createService: () => {
			built += 1;
			return service as never;
		},
	});
	return { handlers, sent, builtCount: () => built };
}

test('registering the bridge does not build the service', () => {
	const { handlers, builtCount } = harness({});

	assert.deepEqual([...handlers.keys()].sort(), [
		'soundscaper:v1:assistance:garbage-collect',
		'soundscaper:v1:assistance:install',
		'soundscaper:v1:assistance:install-preseeded',
		'soundscaper:v1:assistance:install:cancel',
		'soundscaper:v1:assistance:list',
		'soundscaper:v1:assistance:notices',
		'soundscaper:v1:assistance:reconcile',
		'soundscaper:v1:assistance:relocate',
		'soundscaper:v1:assistance:remove',
	]);
	assert.equal(builtCount(), 0, 'a user who never opens assistance pays nothing for it');
});

test('the service is built once, on first use', async () => {
	const { handlers, builtCount } = harness({
		status: async () => ({ models: [] }),
		install: async () => ({}),
		remove: async () => 0,
	});

	await handlers.get(CHANNELS.listAssistanceModels)?.(null);
	await handlers.get(CHANNELS.listAssistanceModels)?.(null);
	await handlers.get(CHANNELS.removeAssistanceModel)?.(null, 'silero-vad-v6');

	assert.equal(builtCount(), 1);
});

test('status projection cannot expose service paths or extra fields', async () => {
	const { handlers } = harness({
		status: async () => ({
			modelsDirectory: '/private/models',
			runtimeAvailable: false,
			runtimeReason: "dlopen '/private/runtime.node' failed",
			models: [{
				modelId: 'silero-vad-v6', version: '6.2.1', task: 'voice-activity-detection',
				availability: 'installed', downloadBytes: 1, installedBytes: 1,
				attributionRequired: false, artifactPath: '/private/models/model.onnx',
			}],
			privateStorePath: '/private/store',
		}),
	});

	const status = await handlers.get(CHANNELS.listAssistanceModels)?.(null) as Record<string, unknown>;
	assert.equal(Array.isArray(status.models), true);
	assert.deepEqual(Object.keys((status.models as Record<string, unknown>[])[0] ?? {}).sort(), [
		'attributionRequired', 'availability', 'downloadBytes', 'installedBytes',
		'modelId', 'task', 'version',
	]);
	assert.doesNotMatch(JSON.stringify(status), /private|path/iu);
	assert.equal(status.runtimeReason, 'The optional speech runtime failed to load.');
});

test('install progress is forwarded to the renderer', async () => {
	const { handlers, sent } = harness({
		install: async (_modelId: string, onProgress: (value: unknown) => void) => {
			onProgress({ modelId: 'silero-vad-v6', fileName: 'model.onnx', completedBytes: 1, totalBytes: 2 });
			return { modelId: 'silero-vad-v6' };
		},
	});

	await handlers.get(CHANNELS.installAssistanceModel)?.(null, 'silero-vad-v6');

	assert.deepEqual(sent, [[
		'soundscaper:v1:event:assistance-progress',
		{ modelId: 'silero-vad-v6', fileName: 'model.onnx', completedBytes: 1, totalBytes: 2 },
	]]);
});

test('offline installation obtains its directory from main and never from the renderer', async () => {
	const calls: unknown[][] = [];
	const { handlers } = harness({
		installPreseeded: async (...args: unknown[]) => {
			calls.push(args);
			return { modelId: 'silero-vad-v6' };
		},
	}, {
		choosePreseedDirectory: async (modelId) => {
			assert.equal(modelId, 'silero-vad-v6');
			return '/trusted/native/selection';
		},
	});

	await handlers.get(CHANNELS.installPreseededAssistanceModel)?.(
		null, 'silero-vad-v6', '/renderer/attempted/path',
	);

	assert.deepEqual(calls, [['silero-vad-v6', '/trusted/native/selection']]);
});

test('cancel, reconciliation, collection, notices, and relocation are explicit pathless operations', async () => {
	const called: string[] = [];
	const { handlers } = harness({
		cancelInstall: async (modelId: string) => {
			called.push(`cancel:${modelId}`);
			return { contractVersion: 1, modelId, outcome: 'cancelled' };
		},
		reconcilePreseeded: async () => {
			called.push('reconcile');
			return { installedModelIds: [], incompleteModelIds: [], rejected: [] };
		},
		garbageCollect: async () => {
			called.push('garbage');
			return { reclaimedBlobBytes: 1, discardedManifestCount: 2, discardedPartialCount: 3,
				discardedPartialBytes: 4, reclaimedBytes: 5 };
		},
		installedNotices: async () => {
			called.push('notices');
			return [{ schemaVersion: 1, modelId: 'silero-vad-v6', version: '6.2.1', purpose: 'VAD',
				codeLicense: 'MIT', weightsLicense: 'CC-BY-4.0', attributionRequired: true,
				provenanceSources: ['https://upstream.invalid/repo'], upstreamRevision: 'abc123',
				distributionKind: 'identity-mirrored', noticeDocument: 'THIRD_PARTY_LICENSES.md#models' }];
		},
		relocate: async (directory: string) => {
			called.push(`relocate:${directory}`);
			return { modelsDirectory: directory, totalBytes: 9, fileCount: 2, sourceRemoved: true };
		},
	}, { chooseRelocationDirectory: async () => '/trusted/native/target' });

	assert.deepEqual(await handlers.get(CHANNELS.cancelAssistanceModelInstall)?.(null, 'silero-vad-v6'),
		{ contractVersion: 1, modelId: 'silero-vad-v6', outcome: 'cancelled' });
	assert.deepEqual(await handlers.get(CHANNELS.reconcileAssistanceModels)?.(null),
		{ installedModelIds: [], incompleteModelIds: [], rejected: [] });
	assert.equal((await handlers.get(CHANNELS.collectAssistanceModelGarbage)?.(null) as { reclaimedBytes: number }).reclaimedBytes, 5);
	const notices = await handlers.get(CHANNELS.listAssistanceModelNotices)?.(null) as Record<string, unknown>[];
	assert.equal('noticeDocument' in notices[0], false);
	const relocation = await handlers.get(CHANNELS.relocateAssistanceModels)?.(null, '/renderer/path') as Record<string, unknown>;
	assert.deepEqual(relocation, { contractVersion: 1, totalBytes: 9, fileCount: 2, sourceRemoved: true });
	assert.equal('modelsDirectory' in relocation, false);
	assert.deepEqual(called, [
		'cancel:silero-vad-v6', 'reconcile', 'garbage', 'notices', 'relocate:/trusted/native/target',
	]);
});

test('cancelling a native picker does not construct or mutate the service', async () => {
	const { handlers, builtCount } = harness({}, {
		choosePreseedDirectory: async () => null,
		chooseRelocationDirectory: async () => null,
	});

	assert.equal(await handlers.get(CHANNELS.installPreseededAssistanceModel)?.(null, 'silero-vad-v6'), null);
	assert.equal(await handlers.get(CHANNELS.relocateAssistanceModels)?.(null), null);
	assert.equal(builtCount(), 0);
});

test('a malformed native picker result is refused before service construction', async () => {
	const { handlers, builtCount } = harness({}, {
		choosePreseedDirectory: async () => '../renderer-controlled',
		chooseRelocationDirectory: async () => 'relative-target',
	});

	await assert.rejects(
		Promise.resolve(handlers.get(CHANNELS.installPreseededAssistanceModel)?.(null, 'silero-vad-v6')),
		/selected offline model files could not be authenticated/iu,
	);
	await assert.rejects(
		Promise.resolve(handlers.get(CHANNELS.relocateAssistanceModels)?.(null)),
		/storage could not be relocated safely/iu,
	);
	assert.equal(builtCount(), 0);
});

test('native filesystem failures cross IPC without their paths', async () => {
	const { handlers } = harness({
		installPreseeded: async () => { throw new Error("ENOENT '/private/offline/model.onnx'"); },
		relocate: async () => { throw new Error("collision at '/private/target'"); },
	}, {
		choosePreseedDirectory: async () => '/private/offline',
		chooseRelocationDirectory: async () => '/private/target',
	});

	for (const operation of [
		() => handlers.get(CHANNELS.installPreseededAssistanceModel)?.(null, 'silero-vad-v6'),
		() => handlers.get(CHANNELS.relocateAssistanceModels)?.(null),
	]) {
		await assert.rejects(Promise.resolve().then(operation), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.equal(error.message.includes('/private/'), false);
			return true;
		});
	}
});

test('main validates model ids even though the preload already did', async () => {
	const { handlers, builtCount } = harness({ install: async () => ({}), remove: async () => 0 });

	for (const value of ['../escape', 'Model-A', '', 42, null, 'a'.repeat(70)]) {
		await assert.rejects(
			Promise.resolve().then(() => handlers.get(CHANNELS.installAssistanceModel)?.(null, value)),
			/Unsupported assistance model id/u,
			String(value),
		);
		await assert.rejects(
			Promise.resolve().then(() => handlers.get(CHANNELS.removeAssistanceModel)?.(null, value)),
			/Unsupported assistance model id/u,
			String(value),
		);
		await assert.rejects(
			Promise.resolve().then(() => handlers.get(CHANNELS.cancelAssistanceModelInstall)?.(null, value)),
			/Unsupported assistance model id/u,
			String(value),
		);
		await assert.rejects(
			Promise.resolve().then(() => handlers.get(CHANNELS.installPreseededAssistanceModel)?.(null, value)),
			/Unsupported assistance model id/u,
			String(value),
		);
	}
	assert.equal(builtCount(), 0, 'a refused id never reaches the service');
});

test('the licensing binding comes from the shipped register', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'scape-assistance-main-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const runtime = {
		status: async () => ({ available: false, reason: 'not installed', moduleId: 'sherpa-onnx-node' }),
		recognize: async () => ({ language: null, segments: [] }),
	};

	const service = assistanceServiceFrom({
		userDataPath,
		settingsDirectory: null,
		catalog: CATALOG,
		licensingMatrix: {
			localModelEvidence: [EVIDENCE],
			refusedLocalModels: [{ id: 'crisperwhisper' }],
		},
		catalogSignatureOptions: TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS,
		runtime,
		totalMemoryBytes: 8 * 1024 ** 3,
	});

	assert.equal((await service.status()).models.length, 1);
});

test('the service factory injects verified directory persistence', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'scape-assistance-main-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const persisted: string[] = [];
	const service = assistanceServiceFrom({
		userDataPath,
		settingsDirectory: null,
		catalog: CATALOG,
		licensingMatrix: { localModelEvidence: [EVIDENCE], refusedLocalModels: [] },
		catalogSignatureOptions: TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS,
		runtime: {
			status: async () => ({ available: false, reason: null, moduleId: 'sherpa-onnx-node' }),
			recognize: async () => ({ language: null, segments: [] }),
		},
		totalMemoryBytes: 1024,
		persistModelsDirectory: async (directory) => { persisted.push(directory); },
	});

	await assert.rejects(service.relocate(join(userDataPath, 'models', 'nested')), /must not overlap/iu);
	assert.deepEqual(persisted, []);
});

test('a register with no model evidence is refused rather than assumed empty', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'scape-assistance-main-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const runtime = {
		status: async () => ({ available: false, reason: null, moduleId: 'sherpa-onnx-node' }),
		recognize: async () => ({ language: null, segments: [] }),
	};

	assert.throws(
		() => assistanceServiceFrom({
			userDataPath,
			settingsDirectory: null,
			catalog: CATALOG,
			licensingMatrix: {},
			catalogSignatureOptions: TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS,
			runtime,
			totalMemoryBytes: 1024,
		}),
		/carries no local model evidence/iu,
	);
});
