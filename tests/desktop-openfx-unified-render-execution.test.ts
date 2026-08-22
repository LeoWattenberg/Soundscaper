/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { HelperJobRequest, HelperSupervisorSnapshot } from '../desktop/helper-supervisor.ts';
import {
	OfxIsolatedHostManager,
	type OfxIsolatedWorkerPort,
} from '../desktop/openfx-isolated-host-manager.ts';
import {
	createUnifiedExactOfxHostAttemptV1,
	executeUnifiedExactOfxNodeV1,
	type OfxUnifiedHostAttemptResourcesV1,
} from '../desktop/openfx-unified-render-execution.ts';
import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';
import type {
	HelperDataPlaneOutputReservation,
} from '../desktop/helper-data-plane-output-reservation.ts';
import type { HelperOfxHostJobGrant } from '../desktop/helper-contract.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { createUnifiedExactRenderOfxRetimerSourceTime } from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import {
	createUnifiedExactRenderPlan,
	type UnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderPlanV12,
} from '../src/common/editor/unified-exact-render-plan.ts';
import type { OfxEffectRuntimeV26 } from '../src/common/editor/native-ofx-state-v26.ts';
import {
	unifiedExactPlanFixture,
	unifiedExactTimingFixture,
} from './helpers/unified-exact-render-plan-fixture.ts';

const INPUT_SHA = '44'.repeat(32);
const RENDERED_SHA = '55'.repeat(32);

class Worker implements OfxIsolatedWorkerPort {
	readonly requests: Array<HelperJobRequest<'ofx-scan' | 'ofx-host'>> = [];
	readonly failures: Error[] = [];
	quarantined = false;
	disposals = 0;

	async runJob<Kind extends 'ofx-scan' | 'ofx-host'>(
		request: HelperJobRequest<Kind>,
	): Promise<unknown> {
		this.requests.push(request as HelperJobRequest<'ofx-scan' | 'ofx-host'>);
		const failure = this.failures.shift();
		if (failure) throw failure;
		if (request.kind === 'ofx-scan') throw new Error('scan is not used by this fixture');
		const output = (request.grant as HelperOfxHostJobGrant).output;
		return { output: {
			streamId: output.frame.streamId,
			byteLength: output.frame.exactByteLength,
			sha256: RENDERED_SHA,
		} };
	}

	snapshot(): HelperSupervisorSnapshot {
		return {
			state: this.quarantined ? 'quarantined' : 'ready',
			recentCrashes: this.quarantined ? 3 : 0,
			quarantined: this.quarantined,
		};
	}

	clearQuarantine(): void { this.quarantined = false; }
	dispose(): void { this.disposals += 1; }
}

test('a V12 node becomes one fingerprint-, state-, plan-, input-, and output-bound helper attempt', () => {
	const plan = candidatePlan();
	const resources = attemptResources(plan, 'cpu');
	const attempt = createUnifiedExactOfxHostAttemptV1(plan, 'ofx-1', 'cpu', resources);
	const effect = effectNode(plan);
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	assert.deepEqual({
		planVersion: attempt.invocation.unifiedPlanVersion,
		planSha256: attempt.invocation.unifiedPlanSha256,
		nodeId: attempt.invocation.nodeId,
		instanceId: attempt.invocation.instanceId,
		stateSha256: attempt.invocation.stateSha256,
		inputIds: attempt.invocation.inputFrameStreamIds,
		outputId: attempt.invocation.outputFrameStreamId,
	}, {
		planVersion: 12,
		planSha256: envelope.fingerprint,
		nodeId: effect.nodeId,
		instanceId: effect.state.instanceId,
		stateSha256: fingerprintNativeMediaPlan(effect.state).sha256,
		inputIds: [resources.inputs[0]?.binding.streamId],
		outputId: resources.output.binding.streamId,
	});
	assert.deepEqual(attempt.request.grant.inputs.map(({ name, sourceRef, frame }) => ({
		name, sourceRef, sha256: frame.sha256,
	})), [{ name: 'Source', sourceRef: 'source-1', sha256: INPUT_SHA }]);
	assert.deepEqual(attempt.request.grant.inputs[0], {
		name: 'Source', sourceRef: 'source-1', pixelFormat: 'rgba8',
		width: 1, height: 1, rowBytes: 4, frame: resources.inputs[0]?.binding,
	});
	assert.deepEqual(attempt.request.grant.output, {
		pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4,
		frame: resources.output.binding,
	});
	assert.deepEqual(attempt.request.dataPlaneTransfers?.map(({ streamId }) => streamId), [
		resources.plan.binding.streamId,
		resources.inputs[0]?.binding.streamId,
		resources.output.binding.streamId,
	]);
});

test('V12 attempt admission refuses forged plan, plug-in, named input, transfer, and SourceTime authority', () => {
	const plan = candidatePlan();
	const valid = attemptResources(plan, 'cpu');
	const cases: OfxUnifiedHostAttemptResourcesV1[] = [
		{ ...valid, plan: { ...valid.plan, binding: { ...valid.plan.binding, sha256: '66'.repeat(32) } } },
		{ ...valid, pluginBinary: { ...valid.pluginBinary, sha256: '66'.repeat(32) } },
		{ ...valid, inputs: [{ ...valid.inputs[0]!, sourceRef: 'source-other' }] },
		{ ...valid, output: {
			...valid.output,
			transfer: { ...valid.output.transfer, streamId: '67'.repeat(20) },
		} },
		{ ...valid, retimerSourceTime: { ...valid.retimerSourceTime! } },
	];
	for (const resources of cases) {
		assert.throws(
			() => createUnifiedExactOfxHostAttemptV1(plan, 'ofx-1', 'cpu', resources),
			/authentic|binary|input|plan|SourceTime|stream|transfer/iu,
		);
	}
});

test('production-unattested and a non-fixture plug-in never spawn and use only fresh frozen recovery', async () => {
	for (const [executionPolicy, plan] of [
		['production-unattested', candidatePlan()],
		['framescaper-conformance-fixture', candidatePlan('net.example.ThirdParty')],
	] as const) {
		let spawns = 0;
		let resourceCalls = 0;
		const manager = managerWith(() => { spawns += 1; return new Worker(); });
		const result = await executeUnifiedExactOfxNodeV1(manager, {
			plan,
			instanceId: 'ofx-1',
			runtime: runtime(plan),
			requestedBackend: 'cpu',
			executionPolicy,
			createAttemptResources: () => {
				resourceCalls += 1;
				return attemptResources(plan, 'cpu');
			},
		});
		assert.equal(result.mode, 'frozen');
		assert.equal(result.reason, 'isolation-unavailable');
		assert.equal(result.frozenFallback?.externalMediaSourceId, 'source-1');
		assert.equal(spawns, 0);
		assert.equal(resourceCalls, 0);
		manager.dispose();
	}
});

test('stale or unavailable runtime state resolves before execution without mutating authored state', async () => {
	const plan = candidatePlan();
	const manager = managerWith(() => { throw new Error('must not spawn'); });
	const freshMissing = await executeUnifiedExactOfxNodeV1(manager, {
		plan, instanceId: 'ofx-1', runtime: runtime(plan, { availability: 'missing' }),
		requestedBackend: 'cpu', executionPolicy: 'framescaper-conformance-fixture',
		createAttemptResources: () => { throw new Error('must not resolve resources'); },
	});
	assert.deepEqual(
		(({ mode, availability, authoredStatePreserved }) => ({
			mode, availability, authoredStatePreserved,
		}))(freshMissing),
		{ mode: 'frozen', availability: 'missing', authoredStatePreserved: true },
	);
	const stale = await executeUnifiedExactOfxNodeV1(manager, {
		plan,
		instanceId: 'ofx-1',
		runtime: runtime(plan, {
			availability: 'fingerprint-changed',
			freshness: { ...effectNode(plan).state.freshness, inputIdentitiesSha256: '77'.repeat(32) },
		}),
		requestedBackend: 'cpu',
		executionPolicy: 'framescaper-conformance-fixture',
		createAttemptResources: () => { throw new Error('must not resolve resources'); },
	});
	assert.equal(stale.mode, 'bypass');
	assert.equal(stale.frozenFallback, null);
	manager.dispose();
});

test('the conformance fixture retries a failed GPU attempt on CPU in the same fingerprint runtime', async () => {
	const plan = candidatePlan();
	const worker = new Worker();
	worker.failures.push(new Error('cuda device lost'));
	const fingerprints: string[] = [];
	const manager = managerWith((fingerprint) => {
		fingerprints.push(fingerprint);
		return worker;
	});
	const result = await executeUnifiedExactOfxNodeV1(manager, {
		plan,
		instanceId: 'ofx-1',
		runtime: runtime(plan),
		requestedBackend: 'cuda',
		executionPolicy: 'framescaper-conformance-fixture',
		createAttemptResources: (backend) => attemptResources(plan, backend),
	});
	assert.deepEqual(
		(({ mode, backend, retriedOnCpu, reportsDegradation }) => (
			{ mode, backend, retriedOnCpu, reportsDegradation }
		))(result as Extract<typeof result, { mode: 'render' }>),
		{ mode: 'render', backend: 'cpu', retriedOnCpu: true, reportsDegradation: true },
	);
	assert.equal(worker.requests.length, 2);
	assert.equal(new Set(fingerprints).size, 1);
	assert.equal(manager.snapshot().runtimes.length, 1);
	manager.dispose();
});

test('CPU fallback preflight cannot change authenticated input or output authority', async () => {
	const plan = candidatePlan();
	let spawns = 0;
	const manager = managerWith(() => { spawns += 1; return new Worker(); });
	await assert.rejects(executeUnifiedExactOfxNodeV1(manager, {
		plan,
		instanceId: 'ofx-1',
		runtime: runtime(plan),
		requestedBackend: 'cuda',
		executionPolicy: 'framescaper-conformance-fixture',
		createAttemptResources: (backend) => {
			const resources = attemptResources(plan, backend);
			return backend === 'cpu' ? {
				...resources,
				inputs: [{ ...resources.inputs[0]!, binding: {
					...resources.inputs[0]!.binding, sha256: '88'.repeat(32),
				} }],
			} : resources;
		},
	}), /CPU retry must preserve exact/iu);
	assert.equal(spawns, 0);
	manager.dispose();
});

test('crash and quarantine preserve fresh frozen playback; cancellation remains cancellation', async () => {
	const plan = candidatePlan();
	for (const quarantined of [false, true]) {
		const worker = new Worker();
		worker.failures.push(new Error('runtime crashed'));
		worker.quarantined = quarantined;
		const manager = managerWith(() => worker);
		const result = await executeUnifiedExactOfxNodeV1(manager, {
			plan, instanceId: 'ofx-1', runtime: runtime(plan), requestedBackend: 'cpu',
			executionPolicy: 'framescaper-conformance-fixture',
			createAttemptResources: (backend) => attemptResources(plan, backend),
		});
		assert.equal(result.mode, 'frozen');
		assert.equal(result.availability, quarantined ? 'quarantined' : 'crashed');
		assert.equal(result.authoredStatePreserved, true);
		manager.dispose();
	}

	const controller = new AbortController();
	const cancelling = new Worker();
	cancelling.runJob = async function runJob<Kind extends 'ofx-scan' | 'ofx-host'>(
		request: HelperJobRequest<Kind>,
	): Promise<unknown> {
		this.requests.push(request as HelperJobRequest<'ofx-scan' | 'ofx-host'>);
		controller.abort();
		throw new DOMException('cancelled', 'AbortError');
	};
	const manager = managerWith(() => cancelling);
	await assert.rejects(executeUnifiedExactOfxNodeV1(manager, {
		plan, instanceId: 'ofx-1', runtime: runtime(plan), requestedBackend: 'cpu',
		executionPolicy: 'framescaper-conformance-fixture', signal: controller.signal,
		createAttemptResources: (backend) => attemptResources(plan, backend),
	}), /cancel/iu);
	manager.dispose();
});

function candidatePlan(pluginId = 'org.framescaper.conformance'): UnifiedExactRenderPlanV12 {
	const raw = structuredClone(unifiedExactPlanFixture(12));
	const effect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!effect || !('state' in effect)) throw new Error('fixture effect is unavailable');
	(effect.state as { pluginId: string }).pluginId = pluginId;
	return createUnifiedExactRenderPlan(raw) as UnifiedExactRenderPlanV12;
}

function effectNode(plan: UnifiedExactRenderPlanV12): UnifiedExactRenderOpenFxNode {
	const effect = plan.nodes.find((node): node is UnifiedExactRenderOpenFxNode => node.kind === 'openfx');
	if (!effect) throw new Error('fixture effect is unavailable');
	return effect;
}

function runtime(
	plan: UnifiedExactRenderPlanV12,
	overrides: Partial<OfxEffectRuntimeV26> = {},
): OfxEffectRuntimeV26 {
	const state = effectNode(plan).state;
	return {
		availability: 'available',
		pluginId: state.pluginId,
		binarySha256: state.binarySha256,
		freshness: state.freshness,
		...overrides,
	};
}

function attemptResources(
	plan: UnifiedExactRenderPlanV12,
	backend: 'cpu' | 'cuda' | 'opengl' | 'opencl' | 'metal',
): OfxUnifiedHostAttemptResourcesV1 {
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	const prefix = backend === 'cpu' ? 2 : 1;
	return {
		invocationId: `ofx-${backend}`,
		abortSignalId: `abort-${backend}`,
		executable: executable('ofx-host', '/runtime/ofx-host', '33'.repeat(32)),
		pluginBinary: executable(
			'ofx-plugin', '/fixtures/framescaper-conformance.ofx', effectNode(plan).state.binarySha256,
		),
		plan: bound(binding(
			'host-to-helper', `${String(prefix)}0`.repeat(20),
			envelope.canonicalByteLength, envelope.fingerprint,
		)),
		inputs: [{
			name: 'Source', sourceRef: 'source-1',
			pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4,
			...bound(binding('host-to-helper', `${String(prefix)}1`.repeat(20), 4, INPUT_SHA)),
		}],
		output: {
			pixelFormat: 'rgba8', width: 1, height: 1, rowBytes: 4,
			...boundOutput(outputReservation(`${String(prefix)}2`.repeat(20), 4)),
		},
		scratch: {
			rootPath: '/scratch/framescaper', rootIdentity: { dev: 4, ino: 21 },
			reservationId: `${String(prefix)}3`.repeat(20), maximumBytes: 8_192,
		},
		retimerSourceTime: createUnifiedExactRenderOfxRetimerSourceTime(
			plan, 'ofx-1', 3, unifiedExactTimingFixture(),
		),
	};
}

function executable(role: 'ofx-host' | 'ofx-plugin', path: string, sha256: string) {
	return { role, path, bytes: 32_768, sha256, identity: { dev: 4, ino: 18 } };
}

function binding(
	direction: 'host-to-helper' | 'helper-to-host',
	streamId: string,
	byteLength: number,
	sha256: string,
): HelperDataPlaneBinding {
	return {
		dataPlaneVersion: 1, transport: 'message-port', streamId, direction, byteLength, sha256,
		maximumChunkBytes: Math.max(1, Math.min(byteLength, 16 * 1024 * 1024)),
		maximumInFlightChunks: 1,
	};
}

function outputReservation(
	streamId: string,
	exactByteLength: number,
): HelperDataPlaneOutputReservation {
	return {
		dataPlaneVersion: 1, transport: 'message-port', streamId,
		direction: 'helper-to-host', exactByteLength, maximumByteLength: exactByteLength,
		maximumChunkBytes: exactByteLength, maximumInFlightChunks: 1,
	};
}

function bound(bindingValue: HelperDataPlaneBinding) {
	return {
		binding: bindingValue,
		transfer: {
			streamId: bindingValue.streamId,
			port: { postMessage() {}, close() {} },
		},
	};
}

function boundOutput(bindingValue: HelperDataPlaneOutputReservation) {
	return {
		binding: bindingValue,
		transfer: {
			streamId: bindingValue.streamId,
			port: { postMessage() {}, close() {} },
		},
	};
}

function managerWith(createRuntime: (fingerprint: string) => Worker): OfxIsolatedHostManager {
	return new OfxIsolatedHostManager({
		createScanner: () => new Worker(),
		createRuntime,
	});
}
