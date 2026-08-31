/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	NATIVE_MEDIA_HELPER_PROCESS_KINDS,
	createNativeMediaHelperWorker,
	type NativeMediaHelperProcessRunner,
} from '../desktop/native-media-helper-worker.ts';
import { normalizeHelperResourcePolicy } from '../desktop/helper-contract.ts';

const JOB_ID = 'ab'.repeat(20);

test('the utility helper negotiates only probe and the four media operations', () => {
	const harness = workerHarness();
	assert.deepEqual(NATIVE_MEDIA_HELPER_PROCESS_KINDS, [
		'probe-video-source', 'media-decode', 'media-encode', 'media-render', 'media-proxy',
	]);
	assert.deepEqual(harness.messages[0], {
		contractVersion: 1, type: 'hello', kinds: [...NATIVE_MEDIA_HELPER_PROCESS_KINDS],
	});
	assert.equal((harness.messages[0]?.kinds as readonly unknown[]).includes('ofx-host'), false);
	harness.worker.dispose(0);
});

test('the production utility entry reopens and self-tests the media host before creating its worker', async () => {
	const source = await readFile(new URL('../desktop/native-media-helper-process.js', import.meta.url), 'utf8');
	const reopen = source.indexOf('await reopenNativeMediaHelperDescriptor(config)');
	const selfTest = source.indexOf('await runFramescaperMediaHostSelfTest(descriptor)');
	const worker = source.indexOf('createNativeMediaHelperWorker({');
	assert.ok(reopen >= 0 && selfTest > reopen && worker > selfTest);
	assert.match(source, /describeFramescaperMediaHostAvailability\(config\.location\)/u);
	assert.doesNotMatch(source, /createFramescaperMediaReviewPayloadPorts/u);
	assert.doesNotMatch(source, /JSON\.parse[^;]+productionReadiness/su);
	assert.doesNotMatch(source, /child_process|\bspawn\s*\(/u);
});

test('one admitted job receives its exact transferred ports and emits one validated result', async () => {
	let receivedPorts: readonly unknown[] = [];
	const harness = workerHarness({
		run(request) {
			receivedPorts = request.ports;
			return handle(Promise.resolve({ probe: true }));
		},
	});
	const port = Object.freeze({ postMessage() {}, on() {}, close() {} });
	harness.worker.handleMessage(probeMessage(), [port]);
	assert.equal(harness.exits.length, 1, 'a control-only probe must reject transferred ports');

	const accepted = workerHarness({
		run(request) {
			receivedPorts = request.ports;
			return handle(Promise.resolve({ probe: true }));
		},
	});
	accepted.worker.handleMessage(probeMessage(), []);
	await tick();
	assert.deepEqual(receivedPorts, []);
	assert.deepEqual(accepted.messages.at(-1), {
		contractVersion: 1, type: 'result', jobId: JOB_ID, result: { probe: true },
	});
});

test('cancellation awaits helper quiescence and answers cancelled instead of a late result', async () => {
	let resolveJob: (value: unknown) => void = () => undefined;
	let cancels = 0;
	const completion = new Promise<unknown>((resolve) => { resolveJob = resolve; });
	const harness = workerHarness({
		run: () => ({
			completion,
			cancel: async () => { cancels += 1; resolveJob({ tooLate: true }); },
		}),
	});
	harness.worker.handleMessage(probeMessage(), []);
	harness.worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID }, []);
	await tick();
	assert.equal(cancels, 1);
	assert.deepEqual(harness.messages.at(-1), {
		contractVersion: 1, type: 'cancelled', jobId: JOB_ID,
	});
	assert.equal(harness.messages.some((message) => message.type === 'result'
		&& resultField(message.result, 'tooLate') === true), false);
});

test('unknown kinds, malformed control, and ports on non-job messages terminate fail-closed', () => {
	for (const [message, ports] of [
		[{ ...probeMessage(), kind: 'ofx-host' }, []],
		[{ contractVersion: 2, type: 'shutdown' }, []],
		[{ contractVersion: 1, type: 'shutdown' }, [{}]],
	] as const) {
		const harness = workerHarness();
		harness.worker.handleMessage(message, ports);
		assert.deepEqual(harness.exits, [1]);
	}
});

function probeMessage() {
	return {
		contractVersion: 1,
		type: 'job',
		jobId: JOB_ID,
		kind: 'probe-video-source',
		jobContractVersion: 1,
		grant: { mediaPath: '/media/video.mov', mediaBytes: 12, identity: { dev: 1, ino: 2 } },
		resourcePolicy: normalizeHelperResourcePolicy(undefined, 'probe-video-source'),
	};
}

function workerHarness(
	runner: NativeMediaHelperProcessRunner = { run: () => handle(Promise.resolve({ ok: true })) },
) {
	const messages: Array<Record<string, unknown>> = [];
	const exits: number[] = [];
	const worker = createNativeMediaHelperWorker({
		post: (message) => { messages.push(message as Record<string, unknown>); },
		runner,
		setIntervalImpl: (() => ({ unref() {} })) as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
		exit: (code) => { exits.push(code); },
	});
	return { worker, messages, exits };
}

function handle(completion: Promise<unknown>) {
	return Object.freeze({ completion, cancel: async () => undefined });
}

async function tick(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function resultField(value: unknown, key: string): unknown {
	return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : null;
}
