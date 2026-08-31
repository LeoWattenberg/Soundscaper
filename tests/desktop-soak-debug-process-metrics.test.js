/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
	SOAK_DEBUG_FLAG,
	collectSoakDebugProcessMetrics,
	soakDebugProcessMetricsEnabled,
	validateSoakDebugProcessMetrics,
} from '../desktop/soak-debug-process-metrics.mjs';
import {
	SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX,
	createSoakDebugDialog,
} from '../desktop/soak-debug-dialog.mjs';

test('desktop process metrics are disabled unless the explicit startup flag is present', () => {
	assert.equal(soakDebugProcessMetricsEnabled(['Soundscaper']), false);
	assert.equal(soakDebugProcessMetricsEnabled(['Soundscaper', SOAK_DEBUG_FLAG]), true);
	assert.equal(soakDebugProcessMetricsEnabled(['Soundscaper', `${SOAK_DEBUG_FLAG}=1`]), false);
});

test('desktop process metrics return a closed read-only working-set projection', () => {
	const metrics = collectSoakDebugProcessMetrics({
		getAppMetrics: () => [
			{ pid: 20, type: 'Sandbox helper', memory: { workingSetSize: 2_048, privateBytes: 99 }, secret: '/tmp/a' },
			{ pid: 10, type: 'Browser', memory: { workingSetSize: 4_096 } },
		],
	});
	assert.deepEqual(metrics, {
		schemaVersion: 1,
		workingSetBytes: 6_291_456,
		processes: [
			{ pid: 10, type: 'Browser', workingSetBytes: 4_194_304 },
			{ pid: 20, type: 'Sandbox helper', workingSetBytes: 2_097_152 },
		],
	});
	assert.equal(Object.isFrozen(metrics), true);
	assert.equal(Object.isFrozen(metrics.processes), true);
	assert.deepEqual(validateSoakDebugProcessMetrics(structuredClone(metrics)), metrics);
	assert.throws(() => validateSoakDebugProcessMetrics({ ...metrics, path: '/tmp/private' }), /fields/iu);
});

test('the sandbox preload exposes the read-only bridge only under the startup flag', async () => {
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	const response = {
		schemaVersion: 1,
		workingSetBytes: 4_194_304,
		processes: [{ pid: 10, type: 'Browser', workingSetBytes: 4_194_304 }],
	};
	const dormant = evaluatePreload(source, ['electron'], response);
	assert.equal(Object.hasOwn(dormant.bridge, 'readSoakProcessMetrics'), false);
	const framescaper = evaluatePreload(source, [
		'electron', '--soundscaper-product=framescaper', SOAK_DEBUG_FLAG,
	], response);
	assert.equal(Object.hasOwn(framescaper.bridge, 'readSoakProcessMetrics'), false);

	const active = evaluatePreload(source, ['electron', SOAK_DEBUG_FLAG], response);
	assert.equal(typeof active.bridge.readSoakProcessMetrics, 'function');
	assert.deepEqual(JSON.parse(JSON.stringify(await active.bridge.readSoakProcessMetrics())), response);
	assert.deepEqual(active.invocations, ['soundscaper:v1:soak-debug:process-metrics']);

	const malicious = evaluatePreload(source, ['electron', SOAK_DEBUG_FLAG], { ...response, path: '/private' });
	await assert.rejects(malicious.bridge.readSoakProcessMetrics(), /fields/iu);
});

test('the soak dialog is dormant without the flag and contains automated outputs', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-soak-dialog-test-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const calls = [];
	const delegate = {
		async showSaveDialog(...args) { calls.push(['save', ...args]); return { canceled: true }; },
		async showOpenDialog(...args) { calls.push(['open', ...args]); return { canceled: true, filePaths: [] }; },
		async showMessageBox(...args) { calls.push(['message', ...args]); return { response: 0 }; },
	};
	const dormant = createSoakDebugDialog(delegate, ['Soundscaper']);
	assert.deepEqual(await dormant.showSaveDialog({}, { defaultPath: 'mix.wav' }), { canceled: true });
	assert.equal(calls.length, 1);

	const active = createSoakDebugDialog(delegate, [
		'Soundscaper', SOAK_DEBUG_FLAG, `${SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX}${resolve(directory)}`,
	]);
	const first = await active.showSaveDialog({}, { defaultPath: '../../mix.wav' });
	const second = await active.showSaveDialog({ defaultPath: 'mix.wav' });
	assert.equal(first.canceled, false);
	assert.equal(second.canceled, false);
	assert.equal(first.filePath, join(resolve(directory), 'mix-0001.wav'));
	assert.equal(second.filePath, join(resolve(directory), 'mix-0002.wav'));
	const destination = await active.showOpenDialog({}, {
		title: 'Select delivery destination', properties: ['openDirectory', 'createDirectory'],
	});
	assert.deepEqual(destination, {
		canceled: false, filePaths: [join(resolve(directory), 'delivery-destination')],
	});
	await active.showMessageBox({}, { message: 'still delegated' });
	assert.equal(calls.filter(([kind]) => kind === 'message').length, 1);
});

test('the soak dialog rejects ambiguous or relative output roots', () => {
	const delegate = { showSaveDialog() {}, showOpenDialog() {} };
	assert.throws(() => createSoakDebugDialog(delegate, [SOAK_DEBUG_FLAG]), /exactly one.*output directory/iu);
	assert.throws(() => createSoakDebugDialog(delegate, [
		SOAK_DEBUG_FLAG, `${SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX}relative`,
	]), /absolute/iu);
	assert.throws(() => createSoakDebugDialog(delegate, [
		SOAK_DEBUG_FLAG,
		`${SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX}/tmp/one`,
		`${SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX}/tmp/two`,
	]), /exactly one/iu);
});

test('desktop soak output names remain unique after the Electron process restarts', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-soak-dialog-restart-test-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const delegate = { showSaveDialog() {}, showOpenDialog() {} };
	const argumentsValue = [
		'Soundscaper', SOAK_DEBUG_FLAG,
		`${SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX}${resolve(directory)}`,
	];
	const beforeRestart = createSoakDebugDialog(delegate, argumentsValue);
	const first = await beforeRestart.showSaveDialog({ defaultPath: 'mix.wav' });
	await writeFile(first.filePath, 'first process output');

	const afterRestart = createSoakDebugDialog(delegate, argumentsValue);
	const second = await afterRestart.showSaveDialog({ defaultPath: 'mix.wav' });
	assert.equal(first.filePath, join(resolve(directory), 'mix-0001.wav'));
	assert.equal(second.filePath, join(resolve(directory), 'mix-0002.wav'));
});

function evaluatePreload(source, argv, response) {
	let bridge;
	const invocations = [];
	vm.runInNewContext(source, {
		ArrayBuffer, Object, Promise, RangeError, Reflect, String, TypeError, Uint8Array, URL,
		process: { argv },
		structuredClone,
		window: { addEventListener: () => {}, postMessage: () => {} },
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; },
			},
			ipcRenderer: {
				invoke(channel) { invocations.push(channel); return Promise.resolve(structuredClone(response)); },
				on: () => {}, postMessage: () => {}, removeListener: () => {}, send: () => {},
			},
		}),
	});
	return { bridge, invocations };
}
