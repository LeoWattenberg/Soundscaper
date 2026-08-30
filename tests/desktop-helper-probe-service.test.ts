/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopHelperProbeService,
	HELPER_PROBE_MAXIMUM_INPUT_BYTES,
	MAXIMUM_PENDING_HELPER_PROBES,
	type HelperProbeSupervisorPort,
} from '../desktop/helper-probe-service.ts';
import { encodeVideoTimingAsset } from '../src/common/editor/video-timing-asset.ts';
import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import { HelperSupervisionError, type HelperJobRequest } from '../desktop/helper-supervisor.ts';

const OWNER = Object.freeze({ renderer: 1 });
const OTHER_OWNER = Object.freeze({ renderer: 2 });
const CAPABILITY_ID = 'ab'.repeat(32);

const VALID_RESULT = Object.freeze({
	timingAsset: encodeVideoTimingAsset({
		timescale: 30,
		presentationTicks: [0n, 1n, 2n],
		finalFrameDurationTicks: 1n,
	}),
	nominalRate: { num: 30, den: 1 },
	characteristics: createUnreportedVideoSourceCharacteristics(),
});

function createHarness(options: Readonly<{
	enabled?: boolean;
	quarantined?: boolean;
	grantSize?: number;
	resolveGrant?: () => Promise<Readonly<{
		path: string;
		size: number;
		identity: Readonly<{ dev: number; ino: number }>;
	}> | null>;
	runJob?: (request: HelperJobRequest) => Promise<unknown>;
}> = {}) {
	let probeSequence = 0;
	const jobs: HelperJobRequest[] = [];
	let quarantined = options.quarantined ?? false;
	const supervisor: HelperProbeSupervisorPort = {
		runJob: async (request) => {
			jobs.push(request);
			if (options.runJob) return options.runJob(request);
			request.signal?.throwIfAborted();
			return request.validateResult
				? request.validateResult(structuredClone(VALID_RESULT))
				: structuredClone(VALID_RESULT);
		},
		snapshot: () => Object.freeze({ state: quarantined ? 'quarantined' : 'ready', quarantined }),
		clearQuarantine: () => {
			quarantined = false;
		},
		dispose: () => {},
	};
	const service = new DesktopHelperProbeService({
		supervisor,
		grants: {
			resolveHelperGrant: async (id, { owner }) => options.resolveGrant
				? options.resolveGrant()
				: (
				id === CAPABILITY_ID && owner === OWNER
					? Object.freeze({
						path: '/media/example.mp4', size: options.grantSize ?? 4_096,
						identity: Object.freeze({ dev: 3, ino: 42 }),
					})
					: null
			),
		},
		isEnabled: () => options.enabled !== false,
		mintProbeId: () => (++probeSequence).toString(16).padStart(40, '0'),
	});
	return { service, jobs };
}

test('helper probe service round-trips a validated probe by opaque capability id only', async () => {
	const { service, jobs } = createHarness();
	const { probeId } = await service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID });
	const completion = await service.awaitProbe({ owner: OWNER, probeId });
	assert.equal(completion.status, 'probed');
	assert.ok(completion.status === 'probed' && completion.timingAsset.byteLength > 0);
	assert.equal(jobs.length, 1);
	assert.equal(jobs[0].kind, 'probe-video-source');
	assert.equal(jobs[0].grant.mediaPath, '/media/example.mp4');
	assert.equal(jobs[0].grant.mediaBytes, 4_096);
	await assert.rejects(
		service.awaitProbe({ owner: OWNER, probeId }),
		/not pending/u,
		'a probe completion is delivered exactly once',
	);
});

test('helper probe service refuses disabled, quarantined, unknown, and foreign-owner requests', async () => {
	const disabled = createHarness({ enabled: false });
	await assert.rejects(
		disabled.service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID }),
		(error: Error & { code?: string }) => error.code === 'helper-disabled',
	);
	const quarantined = createHarness({ quarantined: true });
	await assert.rejects(
		quarantined.service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID }),
		(error: Error & { code?: string }) => error.code === 'helper-quarantined',
	);
	const { service } = createHarness();
	await assert.rejects(
		service.beginProbe({ owner: OWNER, capabilityId: 'cd'.repeat(32) }),
		(error: Error & { code?: string }) => error.code === 'unknown-capability',
	);
	await assert.rejects(
		service.beginProbe({ owner: OTHER_OWNER, capabilityId: CAPABILITY_ID }),
		(error: Error & { code?: string }) => error.code === 'unknown-capability',
		'a capability owned by another renderer identity must be invisible',
	);
	const { probeId } = await service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID });
	await assert.rejects(
		service.awaitProbe({ owner: OTHER_OWNER, probeId }),
		/not pending/u,
		'a probe pending for one owner must be invisible to another',
	);
	assert.deepEqual(service.cancelProbe({ owner: OTHER_OWNER, probeId }), { cancelled: false });
});

test('an input past the probe memory ceiling degrades to the wasm probe, never an RSS kill', async () => {
	// The engine holds at least twice the input in memory under a 1 GiB RSS
	// ceiling; admitting a larger file killed the helper mid-job and charged
	// its crash ledger, quarantining the surface after a few large imports.
	const oversized = createHarness({ grantSize: HELPER_PROBE_MAXIMUM_INPUT_BYTES + 1 });
	await assert.rejects(
		oversized.service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID }),
		(error: Error & { code?: string }) => error.code === 'input-too-large',
	);
	assert.equal(oversized.jobs.length, 0, 'an unprobeable input must never reach the helper');
	const bounded = createHarness();
	await bounded.service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID });
	assert.equal(bounded.jobs[0]?.resourcePolicy?.maximumInputBytes, HELPER_PROBE_MAXIMUM_INPUT_BYTES,
		'the admitted job policy pins the same ceiling so a mis-sized grant cannot slip past');
});

test('helper probe service bounds pending probes and reports supervision failures as typed completions', async () => {
	let release: () => void = () => {};
	const blocked = new Promise<unknown>((resolve) => {
		release = () => resolve(structuredClone(VALID_RESULT));
	});
	const { service } = createHarness({ runJob: () => blocked });
	const pending: string[] = [];
	for (let index = 0; index < MAXIMUM_PENDING_HELPER_PROBES; index += 1) {
		pending.push((await service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID })).probeId);
	}
	await assert.rejects(
		service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID }),
		(error: Error & { code?: string }) => error.code === 'helper-busy',
	);
	release();
	const first = await service.awaitProbe({ owner: OWNER, probeId: pending[0] });
	assert.equal(first.status, 'probed');

	const failing = createHarness({
		runJob: async () => {
			throw new HelperSupervisionError('heartbeat', 'The helper stopped reporting liveness and was terminated.');
		},
	});
	const failure = await failing.service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID });
	const failed = await failing.service.awaitProbe({ owner: OWNER, probeId: failure.probeId });
	assert.equal(failed.status, 'failed');
	assert.ok(failed.status === 'failed' && failed.code === 'helper-failed');
	assert.match(failed.status === 'failed' ? failed.message : '', /stopped reporting liveness/u);
});

test('helper probe service reserves its pending bound before asynchronous grant resolution', async () => {
	let releaseGrants: () => void = () => undefined;
	let resolutions = 0;
	const grantGate = new Promise<void>((resolve) => { releaseGrants = resolve; });
	const { service } = createHarness({ resolveGrant: async () => {
		resolutions += 1;
		await grantGate;
		return Object.freeze({ path: '/media/example.mp4', size: 4_096,
			identity: Object.freeze({ dev: 3, ino: 42 }) });
	} });
	const admitted = Array.from({ length: MAXIMUM_PENDING_HELPER_PROBES }, () => (
		service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID })
	));
	await Promise.resolve();
	await assert.rejects(
		service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID }),
		(error: Error & { code?: string }) => error.code === 'helper-busy',
	);
	assert.equal(resolutions, MAXIMUM_PENDING_HELPER_PROBES);
	releaseGrants();
	for (const { probeId } of await Promise.all(admitted)) {
		await service.awaitProbe({ owner: OWNER, probeId });
	}
});

test('helper probe service cancellation and owner revocation abort supervised jobs', async () => {
	const observedSignals: AbortSignal[] = [];
	const { service } = createHarness({
		runJob: (request) => new Promise((_resolve, reject) => {
			observedSignals.push(request.signal!);
			request.signal!.addEventListener('abort', () => {
				reject(new HelperSupervisionError('cancelled', 'The helper job was cancelled.'));
			}, { once: true });
		}),
	});
	const { probeId } = await service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID });
	assert.deepEqual(service.cancelProbe({ owner: OWNER, probeId }), { cancelled: true });
	const completion = await service.awaitProbe({ owner: OWNER, probeId });
	assert.ok(completion.status === 'failed' && completion.code === 'helper-cancelled');

	const revoked = await service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID });
	service.revokeOwner(OWNER);
	assert.equal(observedSignals.at(-1)?.aborted, true, 'owner revocation must abort in-flight probes');
	await assert.rejects(
		service.awaitProbe({ owner: OWNER, probeId: revoked.probeId }),
		/not pending/u,
		'owner revocation must drop the pending record',
	);
});

test('helper probe service re-validates helper results in main before the renderer sees them', async () => {
	const { service } = createHarness({
		runJob: async (request) => request.validateResult!({
			timingAsset: new Uint8Array([1, 2, 3]),
			nominalRate: { num: 30, den: 1 },
			characteristics: null,
		}),
	});
	const { probeId } = await service.beginProbe({ owner: OWNER, capabilityId: CAPABILITY_ID });
	const completion = await service.awaitProbe({ owner: OWNER, probeId });
	assert.ok(completion.status === 'failed', 'a result the contract rejects must never reach the renderer as probed');
});
