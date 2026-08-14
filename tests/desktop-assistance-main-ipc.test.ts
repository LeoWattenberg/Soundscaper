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

const CHANNELS = Object.freeze({
	listAssistanceModels: 'soundscaper:v1:assistance:list',
	installAssistanceModel: 'soundscaper:v1:assistance:install',
	removeAssistanceModel: 'soundscaper:v1:assistance:remove',
	assistanceInstallProgress: 'soundscaper:v1:event:assistance-progress',
});

const CATALOG = Object.freeze({
	schemaVersion: 1,
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
		upstream: null,
		artifacts: null,
	}],
});

function harness(service: unknown) {
	const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
	const sent: [string, unknown][] = [];
	let built = 0;
	registerAssistanceIpc({
		channels: CHANNELS,
		handle: (channel, listener) => handlers.set(channel, listener),
		sendToRenderer: (channel, payload) => sent.push([channel, payload]),
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
		'soundscaper:v1:assistance:install',
		'soundscaper:v1:assistance:list',
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
			localModelEvidence: [{ id: 'silero-vad-v6' }],
			refusedLocalModels: [{ id: 'crisperwhisper' }],
		},
		runtime,
		totalMemoryBytes: 8 * 1024 ** 3,
	});

	assert.equal((await service.status()).models.length, 1);
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
			runtime,
			totalMemoryBytes: 1024,
		}),
		/carries no local model evidence/iu,
	);
});
