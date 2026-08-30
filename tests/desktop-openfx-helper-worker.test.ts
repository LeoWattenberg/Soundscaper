/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

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
	const worker = createOpenFxHelperWorker({
		mode: 'scanner', post: () => undefined,
		runner: { run: () => { throw new Error('grant rejected'); } },
		setIntervalImpl: inertInterval as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
	});
	worker.handleMessage(scanJob(), [rejected]);
	assert.equal(rejected.closes, 1, 'a synchronous grant refusal owns and closes its transferred port');

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
	return {
		contractVersion: 1, type: 'job', jobId: '12'.repeat(20), kind: 'ofx-scan',
		jobContractVersion: 1, grant: { descriptor: {} }, resourcePolicy: resourcePolicy(),
	};
}

class ClosePort {
	closes = 0;
	postMessage(): void {}
	on(): void {}
	close(): void { this.closes += 1; }
}
