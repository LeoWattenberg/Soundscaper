/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import {
	HelperContractViolationError,
	helperJobGrantResourceUsage,
	type HelperDataPlaneBinding,
	type HelperDataPlaneOutputReservation,
	type HelperOfxHostJobGrant,
	validateHelperJobGrant,
} from '../desktop/helper-contract.ts';
import {
	receiveHelperDataPlaneReservedFile,
	sendHelperDataPlaneFile,
	type HelperDataPlaneIoPort,
} from '../desktop/helper-data-plane-io.ts';
import {
	admitHelperDataPlaneTransfers,
	type HelperDataPlaneTransfer,
} from '../desktop/helper-data-plane-transfer.ts';
import type { FramescaperOpenFxHostDescriptor } from '../desktop/framescaper-openfx-host-payload.ts';
import {
	createOpenFxHelperJobRunner,
} from '../desktop/openfx-helper-job.ts';
import {
	prepareOpenFxMainAttemptV1,
	type PrepareOpenFxMainAttemptOptionsV1,
	type PreparedOpenFxMainAttemptV1,
} from '../desktop/openfx-main-attempt.ts';
import {
	framescaperOpenFxExecutionRequestV1,
} from '../desktop/openfx-main-execution-request.ts';
import { openFxHelperTransferredPortCount } from '../desktop/openfx-helper-worker.ts';
import {
	createUnifiedExactOfxHostAttemptV1,
	type OfxUnifiedHostAttemptResourcesV1,
} from '../desktop/openfx-unified-render-execution.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import {
	nativeMediaPlanVideoTimingAssetInputs,
	type NativeMediaPlanVideoTimingAssetInput,
} from '../src/common/editor/native-media-plan-video-timing.ts';
import { createOfxHostInvocationV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import { createUnifiedExactRenderOfxRetimerSourceTime } from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import {
	createUnifiedExactRenderPlan,
	createUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV12,
} from '../src/common/editor/unified-exact-render-plan.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import {
	unifiedExactPlanFixture,
	unifiedExactTimingFixture,
} from './helpers/unified-exact-render-plan-fixture.ts';
import { unifiedExactVfrPlanFixture } from './helpers/unified-exact-vfr-plan-fixture.ts';

const SHA = (byte: string): string => byte.repeat(64);
const PLUGIN_SHA = SHA('a');
const OUTPUT = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

interface ExpectedOfxTimingGrant {
	readonly role: 'video-timing';
	readonly binding: HelperDataPlaneBinding;
}

type ExpectedHostGrant = HelperOfxHostJobGrant & Readonly<{
	readonly videoTimingAssets: readonly ExpectedOfxTimingGrant[];
}>;

interface BoundTimingResource extends ExpectedOfxTimingGrant {
	readonly transfer: HelperDataPlaneTransfer;
}

type ExpectedAttemptResources = OfxUnifiedHostAttemptResourcesV1 & Readonly<{
	readonly videoTimingAssets: readonly BoundTimingResource[];
}>;

interface AttemptTimingBody {
	readonly input: NativeMediaPlanVideoTimingAssetInput;
	readonly bytes: Uint8Array;
}

type PrepareWithTiming = (
	options: PrepareOpenFxMainAttemptOptionsV1 & Readonly<{
		readonly videoTimingAssets?: readonly AttemptTimingBody[];
	}>,
) => Promise<Omit<PreparedOpenFxMainAttemptV1, 'resources'> & Readonly<{
	readonly resources: ExpectedAttemptResources;
}>>;

const prepareWithTiming = prepareOpenFxMainAttemptV1 as unknown as PrepareWithTiming;

test('CFR OpenFX grants keep the existing no-timing port order and accounting', () => {
	const grant = validateHelperJobGrant('ofx-host', cfrGrant());
	if (!('invocation' in grant)) throw new Error('The CFR render grant admitted as Interact.');
	if (grant.invocation.schemaVersion !== 1) throw new Error('The V1 fixture admitted as V2.');
	const legacyGrant = grant as HelperOfxHostJobGrant;
	assert.equal(Object.hasOwn(legacyGrant, 'videoTimingAssets'), false);
	const transfers = transfersFor(legacyGrant);
	const admitted = admitHelperDataPlaneTransfers('ofx-host', legacyGrant, [...transfers].reverse());
	assert.deepEqual(admitted, transfers.map(({ port }) => port));
	assert.equal(openFxHelperTransferredPortCount('ofx-host', legacyGrant), 3);
	const usage = helperJobGrantResourceUsage('ofx-host', legacyGrant);
	assert.equal(usage.dataPlaneBytes,
		legacyGrant.plan.byteLength + legacyGrant.inputs[0]!.frame.byteLength + legacyGrant.output.frame.maximumByteLength);
});

test('ofx-host grants close, account, and canonically order timing bindings', () => {
	const base = cfrGrant();
	const timings = [
		timingGrant('40'.repeat(20), 64, SHA('4')),
		timingGrant('50'.repeat(20), 72, SHA('5')),
	] as const;
	const admitted = validateHelperJobGrant('ofx-host', {
		...base, videoTimingAssets: timings,
	}) as unknown as ExpectedHostGrant;
	assert.deepEqual(admitted.videoTimingAssets, timings);
	const transfers = transfersFor(admitted);
	const ports = admitHelperDataPlaneTransfers('ofx-host', admitted, [
		transfers[4]!, transfers[2]!, transfers[0]!, transfers[3]!, transfers[1]!,
	]);
	assert.deepEqual(ports, transfers.map(({ port }) => port));
	assert.deepEqual(transfers.map(({ streamId }) => streamId), [
		admitted.plan.streamId,
		...timings.map(({ binding }) => binding.streamId),
		admitted.inputs[0]!.frame.streamId,
		admitted.output.frame.streamId,
	]);
	assert.equal(openFxHelperTransferredPortCount('ofx-host', admitted), 5);
	const usage = helperJobGrantResourceUsage('ofx-host', admitted);
	assert.equal(usage.inputBytes, admitted.executable.bytes + admitted.pluginBinary.bytes
		+ admitted.plan.byteLength + timings.reduce((sum, row) => sum + row.binding.byteLength, 0)
		+ admitted.inputs[0]!.frame.byteLength);
	assert.equal(usage.dataPlaneBytes, admitted.plan.byteLength
		+ timings.reduce((sum, row) => sum + row.binding.byteLength, 0)
		+ admitted.inputs[0]!.frame.byteLength + admitted.output.frame.maximumByteLength);

	for (const videoTimingAssets of [
		[],
		[{ ...timings[0]!, role: 'original' }],
		[{ ...timings[0]!, extra: true }],
		[timings[0], timings[0]],
		[timings[0], { ...timings[1]!, binding: {
			...timings[1]!.binding, sha256: timings[0]!.binding.sha256,
		} }],
		[timings[0], { ...timings[1]!, binding: {
			...timings[1]!.binding, streamId: timings[0]!.binding.streamId,
		} }],
	] as readonly unknown[][]) {
		assert.throws(
			() => validateHelperJobGrant('ofx-host', { ...base, videoTimingAssets }),
			(error: unknown) => error instanceof HelperContractViolationError
				&& error.code === 'unsafe-grant',
		);
	}
});

test('the main request admits canonical V12 VFR references without treating them as bytes', () => {
	const fixture = vfrCandidate(1);
	const request = framescaperOpenFxExecutionRequestV1(executionRequest(fixture));
	assert.equal(request.plan.sources[0]!.timing.kind, 'vfr');
	assert.equal(Object.hasOwn(request, 'videoTimingAssets'), false);
	assert.throws(() => framescaperOpenFxExecutionRequestV1({
		...executionRequest(fixture), videoTimingAssets: fixture.assets,
	}), /unsupported|fields/iu);
});

test('main attempt staging binds SCTI bytes in exact plan order before inputs', async (context) => {
	const fixture = vfrCandidate(2);
	const staged = await prepareAttempt(context, fixture, fixture.assets);
	try {
		assert.deepEqual(staged.resources.videoTimingAssets.map(({ role, binding }) => ({
			role, byteLength: binding.byteLength, sha256: binding.sha256,
		})), fixture.assets.map(({ input, bytes }) => ({
			role: 'video-timing', byteLength: bytes.byteLength, sha256: input.sha256,
		})));
		const attempt = createUnifiedExactOfxHostAttemptV1(
			fixture.plan, 'ofx-1', 'cpu', staged.resources,
		);
		assert.deepEqual(attempt.request.dataPlaneTransfers?.map(({ streamId }) => streamId), [
			staged.resources.plan.binding.streamId,
			...staged.resources.videoTimingAssets.map(({ binding }) => binding.streamId),
			staged.resources.inputs[0]!.binding.streamId,
			staged.resources.output.binding.streamId,
		]);
		assert.ok(staged.resources.scratch.maximumBytes >= fixture.assets.reduce(
			(sum, { bytes }) => sum + bytes.byteLength, 0,
		));
	} finally {
		await staged.finish(null);
	}
});

test('main attempt staging refuses missing, extra, duplicate, swapped, and tampered SCTI', async (context) => {
	const fixture = vfrCandidate(2);
	const unrelated = unrelatedTimingBody();
	const tampered = new Uint8Array(fixture.assets[0]!.bytes);
	tampered[tampered.length - 1] ^= 0xff;
	for (const [label, assets, pattern] of [
		['missing', [], /missing|exact timing asset count/iu],
		['extra', [...fixture.assets, unrelated], /extra|outside|exact timing asset count/iu],
		['duplicate', [fixture.assets[0]!, fixture.assets[0]!], /duplic|replay/iu],
		['swapped', [...fixture.assets].reverse(), /order|source|digest/iu],
		['tampered', [{ ...fixture.assets[0]!, bytes: tampered }, fixture.assets[1]!],
			/bytes|digest|changed/iu],
	] as const) {
		await expectPrepareRejected(context, fixture, assets, pattern, label);
	}
});

test('the OpenFX helper receives SCTI ports and emits only staged native timing grants', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-ofx-vfr-helper-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const scannerPath = join(root, 'scanner');
	const hostPath = join(root, 'host');
	const pluginPath = join(root, 'plugin.ofx');
	const scratchPath = join(root, 'scratch');
	await Promise.all([
		writeFile(scannerPath, 'scanner'), writeFile(hostPath, 'host'),
		writeFile(pluginPath, 'plugin'), mkdir(scratchPath),
	]);
	const [scanner, runtimeHost, plugin, scratch] = await Promise.all([
		descriptor(scannerPath), descriptor(hostPath), descriptor(pluginPath), stat(scratchPath),
	]);
	const fixture = vfrCandidate(1, plugin.sha256);
	const envelope = createNativeMediaPlanEnvelopeV1(fixture.plan, fixture.timingSidecars);
	const planBytes = Buffer.from(fingerprintNativeMediaPlan(fixture.plan).canonical);
	const inputBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
	const planBinding = dataBinding('10'.repeat(20), planBytes);
	const timingBinding = dataBinding('20'.repeat(20), fixture.assets[0]!.bytes);
	const inputBinding = dataBinding('30'.repeat(20), inputBytes);
	const output = outputBinding('40'.repeat(20), OUTPUT.byteLength);
	const invocation = createOfxHostInvocationV1({
		invocationId: 'vfr-helper', unifiedPlanVersion: 12,
		unifiedPlanSha256: envelope.fingerprint, nodeId: 'openfx-node', instanceId: 'ofx-1',
		pluginId: 'org.framescaper.conformance', pluginBinarySha256: plugin.sha256,
		context: 'retimer', action: 'render',
		stateSha256: fingerprintNativeMediaPlan(openFxNode(fixture.plan).state).sha256,
		inputFrameStreamIds: [inputBinding.streamId], outputFrameStreamId: output.streamId,
		outputOrdinal: 2, requestedBackend: 'cpu', abortSignalId: 'abort-vfr-helper',
		retimerSourceTime: createUnifiedExactRenderOfxRetimerSourceTime(
			fixture.plan, 'ofx-1', 2, fixture.timingSidecars,
		),
	});
	const hostDescriptor: FramescaperOpenFxHostDescriptor = {
		target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
		openfxVersion: '1.5.1', openfxCommit: 'ab77951', scanner, runtimeHost,
		isolation: {
			launcher: scanner, sandboxProfile: scanner, brokerPolicy: scanner, runtimeLibraries: [],
		},
		supportedGpuBackends: ['opengl', 'opencl', 'cuda'],
	};
	let nativeTiming: unknown = null;
	const runner = createOpenFxHelperJobRunner({
		descriptor: hostDescriptor, mode: 'runtime', pluginFingerprint: invocation.pluginFingerprint,
		invokeHost: (nativeInvocation) => processHandle((async () => {
			if (nativeInvocation.arguments[0] === '--scan') {
				return { exitCode: 0, stderr: '', stdout: scannerDescriptor(plugin.sha256) };
			}
			const grantPath = nativeInvocation.arguments[1]!;
			const nativeGrant = JSON.parse(String(await readFile(grantPath))) as {
				videoTimingAssets: Array<{ path: string; byteLength: number; sha256: string }>;
				output: { path: string };
			};
			nativeTiming = await Promise.all(nativeGrant.videoTimingAssets.map(async (row) => ({
				byteLength: row.byteLength, sha256: row.sha256,
				bytes: [...await readFile(row.path)],
			})));
			await writeFile(nativeGrant.output.path, OUTPUT, { flag: 'wx' });
			return { exitCode: 0, stderr: '', stdout: JSON.stringify({
				accepted: true, planVersion: 12, requestedBackend: 'cpu', backend: 'cpu',
				retriedOnCpu: false, reportsDegradation: false,
				gpuContextSetup: false, gpuContextReleased: false,
				outputStreamId: output.streamId, outputByteLength: OUTPUT.byteLength,
				outputSha256: digest(OUTPUT), outputWidth: 2, outputHeight: 2, outputRowBytes: 8,
			}) };
		})()),
	});
	const channels = Array.from({ length: 4 }, () => new MessageChannel());
	context.after(() => channels.forEach(({ port1, port2 }) => { port1.close(); port2.close(); }));
	const grant = {
		executable: executable('ofx-host', runtimeHost),
		pluginBinary: executable('ofx-plugin', plugin), invocation, plan: planBinding,
		videoTimingAssets: [{ role: 'video-timing', binding: timingBinding }],
		inputs: [{ name: 'Source', sourceRef: 'vfr-source', pixelFormat: 'rgba8',
			width: 2, height: 2, rowBytes: 8, frame: inputBinding }],
		output: { pixelFormat: 'rgba8', width: 2, height: 2, rowBytes: 8, frame: output },
		scratch: { rootPath: scratchPath, rootIdentity: { dev: scratch.dev, ino: scratch.ino },
			reservationId: '50'.repeat(20), maximumBytes: 1024 * 1024 },
	};
	const job = runner.run({ kind: 'ofx-host', grant: grant as unknown as HelperOfxHostJobGrant,
		ports: channels.map(({ port1 }) => port1 as unknown as HelperDataPlaneIoPort) });
	const planPath = join(root, 'plan.json');
	const timingPath = join(root, 'timing.scti');
	const inputPath = join(root, 'input.rgba');
	await Promise.all([
		writeFile(planPath, planBytes), writeFile(timingPath, fixture.assets[0]!.bytes),
		writeFile(inputPath, inputBytes),
	]);
	const receivedOutput = receiveHelperDataPlaneReservedFile({ reservation: output,
		port: channels[3]!.port2 as unknown as HelperDataPlaneIoPort, path: join(root, 'output.rgba') });
	const transfers = Promise.all([
		sendHelperDataPlaneFile({ binding: planBinding,
			port: channels[0]!.port2 as unknown as HelperDataPlaneIoPort, path: planPath }),
		sendHelperDataPlaneFile({ binding: timingBinding,
			port: channels[1]!.port2 as unknown as HelperDataPlaneIoPort, path: timingPath }),
		sendHelperDataPlaneFile({ binding: inputBinding,
			port: channels[2]!.port2 as unknown as HelperDataPlaneIoPort, path: inputPath }),
	]);
	const [completion, received] = await Promise.all([job.completion, receivedOutput, transfers]);
	assert.deepEqual((completion as Readonly<{ output: unknown }>).output, received);
	assert.deepEqual(nativeTiming, [{
		byteLength: fixture.assets[0]!.bytes.byteLength,
		sha256: fixture.assets[0]!.input.sha256,
		bytes: [...fixture.assets[0]!.bytes],
	}]);
});

function cfrPlan(): UnifiedExactRenderPlanV12 {
	const raw = structuredClone(unifiedExactPlanFixture(12));
	raw.output.canvas.width = 2;
	raw.output.canvas.height = 2;
	return createUnifiedExactRenderPlan(raw) as UnifiedExactRenderPlanV12;
}

function cfrGrant() {
	const plan = cfrPlan();
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	const input = dataBinding('20'.repeat(20), new Uint8Array(16), SHA('2'));
	const output = outputBinding('30'.repeat(20), 16);
	return {
		executable: { role: 'ofx-host' as const, path: '/runtime/ofx-host', bytes: 4_096,
			sha256: SHA('8'), identity: { dev: 1, ino: 2 } },
		pluginBinary: { role: 'ofx-plugin' as const, path: '/plugin/ofx', bytes: 2_048,
			sha256: PLUGIN_SHA, identity: { dev: 1, ino: 3 } },
		invocation: createOfxHostInvocationV1({
			invocationId: 'cfr-grant', unifiedPlanVersion: 12,
			unifiedPlanSha256: envelope.fingerprint, nodeId: 'openfx-node', instanceId: 'ofx-1',
			pluginId: 'net.example.Retimer', pluginBinarySha256: PLUGIN_SHA,
			context: 'retimer', action: 'render',
			stateSha256: fingerprintNativeMediaPlan(openFxNode(plan).state).sha256,
			inputFrameStreamIds: [input.streamId], outputFrameStreamId: output.streamId,
			outputOrdinal: 3, requestedBackend: 'cpu', abortSignalId: 'abort-cfr-grant',
			retimerSourceTime: createUnifiedExactRenderOfxRetimerSourceTime(
				plan, 'ofx-1', 3, unifiedExactTimingFixture(),
			),
		}),
		plan: dataBinding('10'.repeat(20), new Uint8Array(envelope.canonicalByteLength), envelope.fingerprint),
		inputs: [{ name: 'Source', sourceRef: 'source-1', pixelFormat: 'rgba8' as const,
			width: 2, height: 2, rowBytes: 8, frame: input }],
		output: { pixelFormat: 'rgba8' as const, width: 2, height: 2, rowBytes: 8, frame: output },
		scratch: { rootPath: '/scratch/ofx', rootIdentity: { dev: 1, ino: 4 },
			reservationId: '60'.repeat(20), maximumBytes: 1024 * 1024 },
	};
}

function timingGrant(streamId: string, byteLength: number, sha256: string): ExpectedOfxTimingGrant {
	return { role: 'video-timing', binding: dataBinding(streamId, new Uint8Array(byteLength), sha256) };
}

function transfersFor(grant: HelperOfxHostJobGrant | ExpectedHostGrant): HelperDataPlaneTransfer[] {
	const timing = 'videoTimingAssets' in grant ? grant.videoTimingAssets ?? [] : [];
	return [grant.plan, ...timing.map(({ binding }) => binding),
		...grant.inputs.map(({ frame }) => frame), grant.output.frame].map((binding) => ({
			streamId: binding.streamId, port: { postMessage() {}, close() {} },
		}));
}

interface VfrCandidate {
	readonly plan: UnifiedExactRenderPlanV12;
	readonly timingSidecars: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly assets: readonly AttemptTimingBody[];
}

function vfrCandidate(count: 1 | 2, pluginSha256 = PLUGIN_SHA): VfrCandidate {
	const primary = unifiedExactVfrPlanFixture(12, SHA('7'));
	const raw = structuredClone(primary.plan);
	raw.output.canvas.width = 2;
	raw.output.canvas.height = 2;
	const sidecars = new Map(primary.timingSidecars);
	const bodies = new Map([[primary.publication.reference.sha256, primary.publication.bytes]]);
	if (count === 2) {
		const publication = createVideoTimingAssetPublication(SHA('6'), {
			timescale: 100, presentationTicks: [0n, 20n, 50n, 90n], finalFrameDurationTicks: 50n,
		});
		const sourceId = 'vfr-source-b';
		const view: VideoSourceTimingView = { kind: 'vfr', reference: publication.reference,
			index: validateVideoTimingAssetBytes(publication.reference, publication.bytes) };
		const source = { id: sourceId, kind: 'video' as const, contentSha256: SHA('6'),
			frameRate: { num: 30_000, den: 1_001 }, sourceFrameCount: 4,
			timingAsset: publication.reference,
			timingDecision: { mode: 'exact' as const, rate: { num: 30_000, den: 1_001 },
				backend: 'demuxer' as const } };
		sidecars.set(sourceId, bindVideoSourceTimingView(new Map([[sourceId, view]]), source));
		const planSource = structuredClone(raw.sources[0]!);
		Object.assign(planSource, { inputIndex: 1, nodeId: 'source-node-b', sourceId,
			storageKey: 'video-original-sha256:b6', contentSha256: SHA('6'),
			timing: { kind: 'vfr', reference: publication.reference } });
		raw.sources.push(planSource);
		bodies.set(publication.reference.sha256, publication.bytes);
	}
	const effect = structuredClone(unifiedExactPlanFixture(12).nodes.find(({ kind }) => kind === 'openfx'));
	if (!effect || !('state' in effect)) throw new Error('The OpenFX fixture is unavailable.');
	Object.assign(effect.state as object, {
		pluginId: 'org.framescaper.conformance', binarySha256: pluginSha256,
		context: 'retimer', attachment: { kind: 'retimer', targetId: 'vfr-clip' },
		inputs: [{ name: 'Source', sourceRef: 'vfr-source' }], frozenFallback: null,
	});
	(raw.nodes as unknown as object[]).push(effect);
	const plan = createUnifiedExactRenderPlanWithTimingSidecars(raw, sidecars);
	if (plan.version !== 12) throw new Error('The VFR fixture did not create V12.');
	const inputs = nativeMediaPlanVideoTimingAssetInputs(plan);
	return { plan: plan as UnifiedExactRenderPlanV12, timingSidecars: sidecars, assets: inputs.map((input) => {
		const bytes = bodies.get(input.sha256);
		if (!bytes) throw new Error('The VFR fixture body is unavailable.');
		return { input, bytes };
	}) };
}

function executionRequest(fixture: VfrCandidate) {
	return {
		pluginHandle: '71'.repeat(20), plan: fixture.plan, instanceId: 'ofx-1',
		requestedBackend: 'cpu' as const, outputOrdinal: 2,
		inputs: [{ name: 'Source', sourceRef: 'vfr-source', width: 2, height: 2, rowBytes: 8,
			rgba: new Uint8Array(16) }],
		retimerSourceTime: createUnifiedExactRenderOfxRetimerSourceTime(
			fixture.plan, 'ofx-1', 2, fixture.timingSidecars,
		),
	};
}

async function prepareAttempt(
	context: test.TestContext,
	fixture: VfrCandidate,
	assets: readonly AttemptTimingBody[],
) {
	const base = await mkdtemp(join(tmpdir(), 'framescaper-ofx-vfr-attempt-'));
	const channels: MessageChannel[] = [];
	context.after(async () => {
		channels.forEach(({ port1, port2 }) => { port1.close(); port2.close(); });
		await rm(base, { recursive: true, force: true });
	});
	return prepareWithTiming({
		request: executionRequest(fixture) as unknown as ReturnType<typeof framescaperOpenFxExecutionRequestV1>,
		pluginBinary: { role: 'ofx-plugin', path: '/fixture/plugin.ofx', bytes: 2_048,
			sha256: openFxNode(fixture.plan).state.binarySha256, identity: { dev: 2, ino: 3 } },
		runtimeHost: { path: '/runtime/ofx-host', byteLength: 4_096,
			sha256: SHA('8'), identity: { dev: 2, ino: 4 } },
		base, videoTimingAssets: assets,
		createMessageChannel: () => {
			const channel = new MessageChannel();
			channels.push(channel);
			return { hostPort: channel.port1 as unknown as HelperDataPlaneIoPort,
				helperPort: channel.port2 };
		},
	});
}

async function expectPrepareRejected(
	context: test.TestContext,
	fixture: VfrCandidate,
	assets: readonly AttemptTimingBody[],
	pattern: RegExp,
	label: string,
): Promise<void> {
	let failure: unknown;
	try {
		const prepared = await prepareAttempt(context, fixture, assets);
		await prepared.finish(null);
	} catch (error) { failure = error; }
	if (failure === undefined) assert.fail(`OpenFX accepted ${label} timing authority.`);
	assert.match(failure instanceof Error ? failure.message : String(failure), pattern);
}

function unrelatedTimingBody(): AttemptTimingBody {
	const publication = createVideoTimingAssetPublication(SHA('9'), {
		timescale: 100, presentationTicks: [0n, 25n], finalFrameDurationTicks: 25n,
	});
	return { input: { inputIndex: 99, sourceId: 'outside-source', ...publication.reference },
		bytes: publication.bytes };
}

function openFxNode(plan: UnifiedExactRenderPlanV12) {
	const node = plan.nodes.find(({ kind }) => kind === 'openfx');
	if (!node || node.kind !== 'openfx') throw new Error('The OpenFX node is unavailable.');
	return node;
}

function dataBinding(
	streamId: string,
	bytes: Uint8Array,
	sha256 = digest(bytes),
): HelperDataPlaneBinding {
	return { dataPlaneVersion: 1, transport: 'message-port', streamId,
		direction: 'host-to-helper', byteLength: bytes.byteLength, sha256,
		maximumChunkBytes: Math.max(1, bytes.byteLength), maximumInFlightChunks: 1 };
}

function outputBinding(streamId: string, byteLength: number): HelperDataPlaneOutputReservation &
	Readonly<{ exactByteLength: number }> {
	return { dataPlaneVersion: 1, transport: 'message-port', streamId,
		direction: 'helper-to-host', exactByteLength: byteLength, maximumByteLength: byteLength,
		maximumChunkBytes: byteLength, maximumInFlightChunks: 1 };
}

async function descriptor(path: string) {
	const [bytes, details] = await Promise.all([readFile(path), stat(path)]);
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes),
		identity: { dev: details.dev, ino: details.ino } };
}

function executable(
	role: 'ofx-host' | 'ofx-plugin',
	value: Awaited<ReturnType<typeof descriptor>>,
) {
	return { role, path: value.path, bytes: value.byteLength,
		sha256: value.sha256, identity: value.identity };
}

function scannerDescriptor(binarySha256: string): string {
	return JSON.stringify({
		pluginId: 'org.framescaper.conformance', vendor: 'Framescaper', version: { major: 1, minor: 0 },
		bundleIdentity: `sha256:${binarySha256}`, binarySha256, architectureDirectory: 'Linux-x86-64',
		supportedContexts: ['retimer'], parameters: [], components: ['RGBA'], pixelDepths: ['byte'],
		threading: 'fully-safe',
		renderBackends: ['cpu'],
		requestedSuites: ['OfxImageEffectSuite', 'OfxPropertySuite', 'OfxParameterSuite'],
	});
}

function processHandle(completion: Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>>) {
	return {
		completion: completion.then((result) => ({ ...result, isolationChecksPassed: true })),
		cancel: async () => undefined,
	};
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
