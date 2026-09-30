/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHelperResourcePolicy } from '../desktop/helper-contract.ts';
import {
	createOpenFxHelperWorker,
	openFxHelperTransferredPortCount,
} from '../desktop/openfx-helper-worker.ts';

test('an OpenFX utility worker negotiates only its configured process kind', () => {
	for (const [mode, kind] of [['scanner', 'ofx-scan'], ['runtime', 'ofx-host']] as const) {
		const posted: unknown[] = [];
		const worker = createOpenFxHelperWorker({
			mode,
			post: (message) => posted.push(message),
			runner: { run: () => handle(Promise.resolve({})) },
			setIntervalImpl: inertInterval as unknown as typeof setInterval,
			clearIntervalImpl: () => undefined,
		});
		assert.deepEqual(posted[0], { contractVersion: 1, type: 'hello', kinds: [kind] });
		worker.dispose();
	}
});

test('a scanner worker refuses host jobs and a runtime worker refuses scan jobs', () => {
	for (const [mode, kind] of [['scanner', 'ofx-host'], ['runtime', 'ofx-scan']] as const) {
		const exits: number[] = [];
		const worker = createOpenFxHelperWorker({
			mode, post: () => undefined,
			runner: { run: () => handle(Promise.resolve({})) },
			setIntervalImpl: inertInterval as unknown as typeof setInterval, clearIntervalImpl: () => undefined,
			exit: (code) => exits.push(code),
		});
		worker.handleMessage({
			contractVersion: 1, type: 'job', jobId: '12'.repeat(20), kind, jobContractVersion: 1,
			grant: {}, resourcePolicy: resourcePolicy(),
		}, []);
		assert.deepEqual(exits, [1]);
	}
});

test('the worker admits exactly the MessagePorts bound by each OpenFX grant', () => {
	assert.equal(openFxHelperTransferredPortCount('ofx-scan', {
		descriptor: {},
	} as never), 1);
	assert.equal(openFxHelperTransferredPortCount('ofx-host', {
		plan: {}, inputs: [{ frame: {} }, { frame: {} }], output: {},
	} as never), 4);
});

test('the worker closes transferred ports when a job never reaches data-plane I/O', () => {
	const rejected = new ClosePort();
	const posted: Array<Record<string, unknown>> = [];
	const worker = createOpenFxHelperWorker({
		mode: 'scanner', post: (message) => posted.push(message as Record<string, unknown>),
		runner: { run: () => { throw new Error('grant rejected'); } },
		setIntervalImpl: inertInterval as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
	});
	worker.handleMessage(scanJob(), [rejected]);
	assert.equal(rejected.closes, 1, 'a synchronous grant refusal owns and closes its transferred port');
	assert.deepEqual(posted.at(-1), {
		contractVersion: 1,
		type: 'error',
		jobId: '12'.repeat(20),
		error: { name: 'Error', message: 'grant rejected' },
	});

	const surplus = [new ClosePort(), new ClosePort()];
	const mismatched = createOpenFxHelperWorker({
		mode: 'scanner', post: () => undefined,
		runner: { run: () => handle(Promise.resolve({})) },
		setIntervalImpl: inertInterval as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
	});
	mismatched.handleMessage(scanJob(), surplus);
	assert.deepEqual(surplus.map(({ closes }) => closes), [1, 1]);

	const activePort = new ClosePort();
	const active = createOpenFxHelperWorker({
		mode: 'scanner', post: () => undefined,
		runner: { run: () => handle(new Promise(() => undefined)) },
		setIntervalImpl: inertInterval as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
	});
	active.handleMessage(scanJob(), [activePort]);
	active.dispose();
	assert.equal(activePort.closes, 1, 'disposing an admitted job closes ports its I/O did not');
	const latePort = new ClosePort();
	active.handleMessage(scanJob(), [latePort]);
	assert.equal(latePort.closes, 1, 'a disposed OpenFX worker still closes rejected transfers');
});

test('OpenFX cancellation quiesces before acknowledgement without closing runner-owned ports', async () => {
	const posted: Array<Record<string, unknown>> = [];
	const port = new ClosePort();
	let heartbeat: () => void = () => assert.fail('the worker did not install its heartbeat');
	let finishJob: (value: unknown) => void = () => undefined;
	const completion = new Promise<unknown>((resolve) => { finishJob = resolve; });
	const worker = createOpenFxHelperWorker({
		mode: 'scanner',
		post: (message) => posted.push(message as Record<string, unknown>),
		runner: {
			run: () => ({
				completion,
				cancel: async () => { finishJob({ late: true }); },
			}),
		},
		setIntervalImpl: ((callback: () => void) => {
			heartbeat = callback;
			return { unref() {} };
		}) as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
	});
	worker.handleMessage(scanJob(), [port]);
	heartbeat();
	assert.deepEqual(posted.at(-1), {
		contractVersion: 1, type: 'heartbeat', jobId: '12'.repeat(20),
	});
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: '12'.repeat(20) }, []);
	await tick();
	assert.deepEqual(posted.at(-1), {
		contractVersion: 1, type: 'cancelled', jobId: '12'.repeat(20),
	});
	assert.equal(posted.some(({ type }) => type === 'result'), false);
	assert.equal(port.closes, 0, 'the runner retains custody through its successful cancel operation');
	worker.dispose();
});

function handle(completion: Promise<unknown>) {
	return { completion, cancel: async () => undefined };
}

function inertInterval(): ReturnType<typeof setInterval> {
	return { unref() {} } as unknown as ReturnType<typeof setInterval>;
}

function resourcePolicy() {
	return {
		maximumInputBytes: 1, maximumOutputBytes: 1, maximumScratchBytes: 1,
		maximumRssBytes: 1, maximumJobDurationMs: 1, maximumInFlightChunks: 1,
	};
}

function scanJob() {
	const streamId = '34'.repeat(20);
	return {
		contractVersion: 1, type: 'job', jobId: '12'.repeat(20), kind: 'ofx-scan',
		jobContractVersion: 1,
		grant: {
			executable: {
				role: 'ofx-scanner', path: '/runtime/ofx-scanner', bytes: 32_768,
				sha256: '1'.repeat(64), identity: { dev: 1, ino: 2 },
			},
			pluginBinary: {
				role: 'ofx-plugin', path: '/plugins/example.ofx', bytes: 16_384,
				sha256: '2'.repeat(64), identity: { dev: 1, ino: 3 },
			},
			descriptor: {
				dataPlaneVersion: 1, transport: 'message-port', streamId,
				direction: 'helper-to-host', exactByteLength: null, maximumByteLength: 4_096,
				maximumChunkBytes: 4_096, maximumInFlightChunks: 1,
			},
			scratch: {
				rootPath: '/scratch/framescaper', rootIdentity: { dev: 1, ino: 4 },
				reservationId: '56'.repeat(20), maximumBytes: 8_192,
			},
		},
		resourcePolicy: normalizeHelperResourcePolicy(undefined, 'ofx-scan'),
	};
}

class ClosePort {
	closes = 0;
	postMessage(): void {}
	on(): void {}
	close(): void { this.closes += 1; }
}

async function tick(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
