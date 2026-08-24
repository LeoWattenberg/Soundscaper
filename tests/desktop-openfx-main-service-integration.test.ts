/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import {
	HelperSupervisionError,
	type HelperJobRequest,
	type HelperSupervisorSnapshot,
} from '../desktop/helper-supervisor.ts';
import {
	OfxIsolatedHostManager,
	type OfxIsolatedWorkerPort,
} from '../desktop/openfx-isolated-host-manager.ts';
import {
	FramescaperOpenFxMainService,
	type FramescaperOpenFxMainServiceMessageChannel,
} from '../desktop/openfx-main-service.ts';
import {
	receiveHelperDataPlaneFile,
	sendHelperDataPlaneReservedFile,
} from '../desktop/helper-data-plane-io.ts';
import type {
	HelperOfxHostJobGrant,
	HelperOfxScanJobGrant,
} from '../desktop/helper-contract.ts';
import { isHelperOfxInteractJobGrantV1 } from '../desktop/helper-native-ofx-interact-grant.ts';
import { openFxProductionReadinessFixture } from './helpers/openfx-production-readiness-fixture.ts';
import {
	assertUnifiedExactRenderPlanV12,
	createUnifiedExactRenderPlan,
	createUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV12,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../src/common/editor/native-media-plan-video-timing.ts';
import {
	framescaperOpenFxInteractEffectStateSha256V1,
} from '../src/common/editor/native-ofx-interact-contract.ts';
import type { OfxEffectStateV26 } from '../src/common/editor/native-ofx-state-v26.ts';
import { createUnifiedExactRenderOfxRetimerSourceTime } from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import type { NativePlanVideoTimingAssetBytes } from '../desktop/native-services-video-timing-staging.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';
import { unifiedExactVfrPlanFixture } from './helpers/unified-exact-vfr-plan-fixture.ts';

const PLUGIN_SHA = '16b3c51f93a8ee62dda14918f2089518fe054144d2016b177c57c7bc66d07af7';
const INPUT_BYTES = new Uint8Array([
	1, 2, 3, 4, 5, 6, 7, 8,
	9, 10, 11, 12, 13, 14, 15, 16,
]);
const OUTPUT_BYTES = new Uint8Array([
	9, 8, 7, 6, 5, 4, 3, 2,
	1, 0, 1, 2, 3, 4, 5, 6,
]);

test('main owns an actual one-shot scan and exact V12 per-fingerprint execution path', async (context) => {
	const fixture = await createFixture(context);
	fixture.preferences.nativeMediaEnabled = true;
	fixture.preferences.ofxConsentEnabled = true;
	const scanned = await fixture.service.scan();
	assert.ok(scanned);
	assert.equal(JSON.stringify(scanned).includes(fixture.pluginPath), false);
	assert.deepEqual(scanned, {
		pluginHandle: '11'.repeat(20), pluginId: 'org.framescaper.conformance', vendor: 'Framescaper',
		version: { major: 1, minor: 0 }, binarySha256: PLUGIN_SHA,
		supportedContexts: ['filter'],
		parameters: [{ name: 'radius', type: 'double', animates: true }],
		components: ['RGBA'], pixelDepths: ['byte'], threading: 'fully-safe',
		state: 'consented', quarantined: false,
	});
	await fixture.service.control({ pluginHandle: scanned.pluginHandle, action: 'enable' });
	const rescanned = await fixture.service.scan();
	assert.equal(rescanned?.pluginHandle, scanned.pluginHandle);
	assert.equal(rescanned?.state, 'enabled');
	const result = await fixture.service.execute({
		pluginHandle: scanned.pluginHandle,
		plan: fixture.plan,
		instanceId: 'ofx-1',
		requestedBackend: 'cpu',
		outputOrdinal: 3,
		inputs: [{
			name: 'Source', sourceRef: 'source-1', width: 2, height: 2, rowBytes: 8,
			rgba: new Uint8Array(INPUT_BYTES),
		}],
	});
	assert.equal(result.mode, 'render');
	if (result.mode !== 'render') throw new Error('expected render');
	assert.deepEqual(result.rgba, OUTPUT_BYTES);
	assert.equal(fixture.scanJobs, 2);
	assert.equal(fixture.hostJobs, 1);
	assert.equal(fixture.currentProjectChecks, 5);
	assert.equal(JSON.stringify(fixture.service.inventory()).includes(fixture.pluginPath), false);
});

test('main carries one pathless offscreen Interact replay through the isolated host', async (context) => {
	const fixture = await createFixture(context);
	fixture.preferences.nativeMediaEnabled = true;
	fixture.preferences.ofxConsentEnabled = true;
	const scanned = await fixture.service.scan();
	assert.ok(scanned);
	await fixture.service.control({ pluginHandle: scanned.pluginHandle, action: 'enable' });
	const events = [
		{ kind: 'focus' as const, sequence: 0, focused: true },
		{ kind: 'pointer' as const, phase: 'down' as const, sequence: 1,
			x: 0.25, y: 0.75, button: 1, modifiers: ['shift' as const] },
		{ kind: 'pointer' as const, phase: 'motion' as const, sequence: 2,
			x: 0.5, y: 0.5, button: 1, modifiers: [] },
		{ kind: 'pointer' as const, phase: 'up' as const, sequence: 3,
			x: 0.5, y: 0.5, button: 1, modifiers: [] },
		{ kind: 'keyboard' as const, phase: 'down' as const, sequence: 4,
			key: 'Enter', code: 'Enter', modifiers: [] },
	];
	const effect = interactEffect(fixture.plan);
	const result = await fixture.service.interact({
		protocolVersion: 1, project: fixture.plan.project, pluginHandle: scanned.pluginHandle,
		effect, effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(effect),
		context: 'filter',
		target: 'overlay', parameterName: null, events,
	});
	assert.deepEqual(result.acceptedSequences, [0, 1, 2, 3, 4]);
	assert.equal(result.rgba.byteLength, 64 * 64 * 4);
	assert.equal(result.instanceId, effect.instanceId);
	assert.equal(result.effectStateSha256, framescaperOpenFxInteractEffectStateSha256V1(effect));
	assert.equal(fixture.hostJobs, 1);
	assert.equal(JSON.stringify(result).includes(fixture.pluginPath), false);
	assert.deepEqual(await readdir(fixture.scratchRoot), []);

	const stale = structuredClone({
		...effect,
		parameters: effect.parameters.map((parameter, index) => (
			index === 0 ? { ...parameter, value: [2] } : parameter
		)),
	});
	await assert.rejects(() => fixture.service.interact({
		protocolVersion: 1, project: fixture.plan.project, pluginHandle: scanned.pluginHandle,
		effect: stale, effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(stale),
		context: 'filter', target: 'overlay', parameterName: null, events: [],
	}), /current project|authority|stale/iu);
	assert.equal(fixture.hostJobs, 1);
});

test('main resolves VFR timing authority before staging a dormant Retimer attempt', async (context) => {
	const candidate = retimerVfrCandidate();
	const fixture = await createFixture(context, {
		plan: candidate.plan, videoTimingAssets: candidate.assets, descriptorContext: 'retimer',
	});
	fixture.preferences.nativeMediaEnabled = true;
	fixture.preferences.ofxConsentEnabled = true;
	const scanned = await fixture.service.scan();
	assert.ok(scanned);
	await fixture.service.control({ pluginHandle: scanned.pluginHandle, action: 'enable' });
	const result = await fixture.service.execute({
		pluginHandle: scanned.pluginHandle, plan: candidate.plan, instanceId: 'ofx-1',
		requestedBackend: 'cpu', outputOrdinal: 2,
		inputs: [{ name: 'Source', sourceRef: 'vfr-source', width: 2, height: 2, rowBytes: 8,
			rgba: new Uint8Array(INPUT_BYTES) }],
		retimerSourceTime: candidate.sourceTime,
	});
	assert.equal(result.mode, 'render');
	assert.equal(fixture.videoTimingAuthorityChecks, 1);
	assert.equal(fixture.videoTimingStreams, 1);
});

test('default-off, policy, and missing-payload states fail before selection or helper execution', async (context) => {
	const fixture = await createFixture(context);
	await assert.rejects(() => fixture.service.scan(), /native media.*off/iu);
	fixture.preferences.nativeMediaEnabled = true;
	await assert.rejects(() => fixture.service.scan(), /OpenFX consent.*off/iu);
	fixture.preferences.ofxConsentEnabled = true;
	fixture.policy.cleared = false;
	await assert.rejects(() => fixture.service.scan(), /policy/iu);
	fixture.policy.cleared = true;
	fixture.payloadAvailable.value = false;
	await assert.rejects(() => fixture.service.scan(), /payload/iu);
	fixture.payloadAvailable.value = true;
	fixture.runtimeAvailable.available = false;
	await assert.rejects(() => fixture.service.scan(), /payload|runtime/iu);
	assert.equal(fixture.selections, 0);
	assert.equal(fixture.scanJobs, 0);
});

test('revocation closes execution while immutable custody survives later source replacement', async (context) => {
	const revokedFixture = await createFixture(context);
	revokedFixture.preferences.nativeMediaEnabled = true;
	revokedFixture.preferences.ofxConsentEnabled = true;
	const revokedScan = await revokedFixture.service.scan();
	assert.ok(revokedScan);
	await revokedFixture.service.control({ pluginHandle: revokedScan.pluginHandle, action: 'enable' });
	await revokedFixture.service.control({ pluginHandle: revokedScan.pluginHandle, action: 'revoke' });
	const revoked = await revokedFixture.service.execute({
		pluginHandle: revokedScan.pluginHandle, plan: revokedFixture.plan, instanceId: 'ofx-1',
		requestedBackend: 'cpu', outputOrdinal: 3,
		inputs: [{ name: 'Source', sourceRef: 'source-1', width: 2, height: 2, rowBytes: 8,
			rgba: new Uint8Array(INPUT_BYTES) }],
	});
	assert.notEqual(revoked.mode, 'render');
	assert.equal(revoked.availability, 'revoked');
	await assert.rejects(() => revokedFixture.service.control({
		pluginHandle: revokedScan.pluginHandle, action: 'enable',
	}), /revoked|changed/iu);
	assert.equal(revokedFixture.hostJobs, 0);

	const fixture = await createFixture(context);
	fixture.preferences.nativeMediaEnabled = true;
	fixture.preferences.ofxConsentEnabled = true;
	const scanned = await fixture.service.scan();
	assert.ok(scanned);
	await fixture.service.control({ pluginHandle: scanned.pluginHandle, action: 'enable' });
	await writeFile(fixture.pluginPath, Buffer.from('changed plug-in bytes'));
	const retained = await fixture.service.execute({
		pluginHandle: scanned.pluginHandle, plan: fixture.plan, instanceId: 'ofx-1',
		requestedBackend: 'cpu', outputOrdinal: 3,
		inputs: [{ name: 'Source', sourceRef: 'source-1', width: 2, height: 2, rowBytes: 8,
			rgba: new Uint8Array(INPUT_BYTES) }],
	});
	assert.equal(retained.mode, 'render');
	assert.equal(fixture.hostJobs, 1);
	assert.equal(fixture.service.inventory()[0]?.state, 'enabled');
});

test('runtime quarantine becomes consent authority and clearing requires a fresh scan and enable', async (context) => {
	const fixture = await createFixture(context);
	fixture.preferences.nativeMediaEnabled = true;
	fixture.preferences.ofxConsentEnabled = true;
	const scanned = await fixture.service.scan();
	assert.ok(scanned);
	await fixture.service.control({ pluginHandle: scanned.pluginHandle, action: 'enable' });
	await fixture.service.execute({
		pluginHandle: scanned.pluginHandle, plan: fixture.plan, instanceId: 'ofx-1',
		requestedBackend: 'cpu', outputOrdinal: 3,
		inputs: [{ name: 'Source', sourceRef: 'source-1', width: 2, height: 2, rowBytes: 8,
			rgba: new Uint8Array(INPUT_BYTES) }],
	});
	fixture.runtimeState.quarantined = true;
	assert.deepEqual(fixture.service.inventory().map(({ state, quarantined }) => ({ state, quarantined })), [
		{ state: 'quarantined', quarantined: true },
	]);
	const cleared = await fixture.service.control({
		pluginHandle: scanned.pluginHandle, action: 'clear-quarantine',
	});
	assert.equal(cleared.state, 'discovered');
	assert.equal(cleared.quarantined, false);
	await assert.rejects(() => fixture.service.control({
		pluginHandle: scanned.pluginHandle, action: 'enable',
	}), /scan consent/iu);
	const rescanned = await fixture.service.scan();
	assert.equal(rescanned?.pluginHandle, scanned.pluginHandle);
	assert.equal(rescanned?.state, 'consented');
	const reenabled = await fixture.service.control({
		pluginHandle: scanned.pluginHandle, action: 'enable',
	});
	assert.equal(reenabled.state, 'enabled');
});

test('main-owned failure ledger quarantines repeated renders and immediate resource violations', async (context) => {
	for (const failures of [
		[new Error('render failed'), new Error('render failed'), new Error('render failed')],
		[new HelperSupervisionError('resource-violation', 'host escaped its RSS grant')],
	]) {
		const fixture = await createFixture(context);
		fixture.preferences.nativeMediaEnabled = true;
		fixture.preferences.ofxConsentEnabled = true;
		const scanned = await fixture.service.scan();
		assert.ok(scanned);
		await fixture.service.control({ pluginHandle: scanned.pluginHandle, action: 'enable' });
		fixture.runtimeState.failures.push(...failures);
		for (const _failure of failures) {
			const result = await fixture.service.execute(executionRequest(fixture, scanned.pluginHandle));
			assert.notEqual(result.mode, 'render');
		}
		assert.deepEqual(
			(({ state, quarantined }) => ({ state, quarantined }))(fixture.service.inventory()[0]!),
			{ state: 'quarantined', quarantined: true },
		);
		const priorJobs = fixture.hostJobs;
		const blocked = await fixture.service.execute(executionRequest(fixture, scanned.pluginHandle));
		assert.notEqual(blocked.mode, 'render');
		assert.equal(blocked.availability, 'quarantined');
		assert.equal(fixture.hostJobs, priorJobs);
	}
});

test('scan cancellation and malformed descriptors leave no registration or scratch authority', async (context) => {
	let releaseScan!: () => void;
	let scanStarted!: () => void;
	const started = new Promise<void>((resolve) => { scanStarted = resolve; });
	const gate = new Promise<void>((resolve) => { releaseScan = resolve; });
	const cancelled = await createFixture(context, {
		beforeScanResult: async () => { scanStarted(); await gate; },
	});
	cancelled.preferences.nativeMediaEnabled = true;
	cancelled.preferences.ofxConsentEnabled = true;
	const pending = cancelled.service.scan();
	await started;
	cancelled.service.disable();
	releaseScan();
	await assert.rejects(pending, /abort|authority/iu);
	assert.deepEqual(cancelled.service.inventory(), []);
	assert.deepEqual(await readdir(cancelled.scratchRoot), []);

	const malformed = await createFixture(context, { scanDescriptor: { pluginId: 'forged' } });
	malformed.preferences.nativeMediaEnabled = true;
	malformed.preferences.ofxConsentEnabled = true;
	await assert.rejects(() => malformed.service.scan(), /descriptor|version|vendor|missing/iu);
	await assert.rejects(() => malformed.service.scan(), /quarantined/iu);
	assert.equal(malformed.scanJobs, 1);
	assert.deepEqual(await readdir(malformed.scratchRoot), []);
});

test('pre-aborted execution and staged transfer failure clean every attempt', async (context) => {
	const fixture = await createFixture(context);
	fixture.preferences.nativeMediaEnabled = true;
	fixture.preferences.ofxConsentEnabled = true;
	const scanned = await fixture.service.scan();
	assert.ok(scanned);
	await fixture.service.control({ pluginHandle: scanned.pluginHandle, action: 'enable' });
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(() => fixture.service.execute({
		...executionRequest(fixture, scanned.pluginHandle), signal: aborted.signal,
	}), /abort/iu);
	assert.equal(fixture.hostJobs, 0);
	assert.deepEqual(await readdir(fixture.scratchRoot), []);

	fixture.channelState.failAt = fixture.channelState.calls + 2;
	await assert.rejects(
		() => fixture.service.execute(executionRequest(fixture, scanned.pluginHandle)),
		/injected channel failure/iu,
	);
	assert.equal(fixture.hostJobs, 0);
	assert.deepEqual(await readdir(fixture.scratchRoot), []);
});

interface FixtureOptions {
	readonly beforeScanResult?: () => Promise<void>;
	readonly scanDescriptor?: unknown;
	readonly descriptorContext?: 'filter' | 'retimer';
	readonly plan?: UnifiedExactRenderPlanV12;
	readonly videoTimingAssets?: readonly NativePlanVideoTimingAssetBytes[];
}

async function createFixture(context: TestContext, options: FixtureOptions = {}) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-ofx-main-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const pluginPath = join(root, 'conformance.ofx');
	const scannerPath = join(root, 'scanner');
	const runtimePath = join(root, 'runtime');
	await Promise.all([
		writeFile(pluginPath, Buffer.from('framescaper conformance plug-in')),
		writeFile(scannerPath, Buffer.from('scanner')),
		writeFile(runtimePath, Buffer.from('runtime')),
		mkdir(join(root, 'scratch')),
	]);
	const pluginBytes = await readFile(pluginPath);
	assert.equal(digest(pluginBytes), PLUGIN_SHA);
	let scanJobs = 0;
	let hostJobs = 0;
	let videoTimingStreams = 0;
	const runtimeState = { quarantined: false, failures: [] as Error[] };
	const manager = new OfxIsolatedHostManager({
		createScanner: () => worker(async (request) => {
			scanJobs += 1;
			const grant = request.grant as HelperOfxScanJobGrant;
			await options.beforeScanResult?.();
			const descriptor = Buffer.from(JSON.stringify(options.scanDescriptor ?? {
				pluginId: 'org.framescaper.conformance', vendor: 'Framescaper',
				version: { major: 1, minor: 0 }, bundleIdentity: 'bundle:conformance',
				binarySha256: PLUGIN_SHA, architectureDirectory: 'Linux-x86-64',
				supportedContexts: [options.descriptorContext ?? 'filter'],
				parameters: options.descriptorContext === 'retimer' ? []
					: [{ name: 'radius', type: 'double', animates: true }],
				components: ['RGBA'], pixelDepths: ['byte'], threading: 'fully-safe',
				renderBackends: ['cpu'],
				requestedSuites: ['OfxImageEffectSuite', 'OfxPropertySuite', 'OfxParameterSuite',
					'OfxInteractSuite', 'OfxDrawSuite'],
			}));
			const path = join(root, `scan-${String(scanJobs)}.json`);
			await writeFile(path, descriptor);
			const completion = { streamId: grant.descriptor.streamId,
				byteLength: descriptor.byteLength, sha256: digest(descriptor) };
			await sendHelperDataPlaneReservedFile({ reservation: grant.descriptor, completion,
				port: request.dataPlaneTransfers![0]!.port as never, path });
			return { descriptor: completion };
		}),
		createRuntime: () => worker(async (request) => {
			hostJobs += 1;
			const failure = runtimeState.failures.shift();
			if (failure) throw failure;
			if (isHelperOfxInteractJobGrantV1(request.grant)) {
				assert.deepEqual(request.dataPlaneTransfers, []);
				return { interact: { protocolVersion: 1,
					project: request.grant.interact.project,
					instanceId: request.grant.interact.effect.instanceId,
					effectStateSha256: request.grant.interact.effectStateSha256,
					width: 64, height: 64, rowBytes: 256,
					target: request.grant.interact.target,
					parameterName: request.grant.interact.parameterName,
					acceptedSequences: request.grant.interact.events.map(({ sequence }) => sequence),
					redrawRequested: true, surfaceDisposition: 'drawn', parameterMutations: [],
					rgba: new Uint8Array(64 * 64 * 4) } };
			}
			const grant = request.grant as HelperOfxHostJobGrant;
			const transfers = request.dataPlaneTransfers!;
			await receiveHelperDataPlaneFile({ binding: grant.plan,
				port: transfers[0]!.port as never, path: join(root, `plan-${String(hostJobs)}.json`) });
			let portIndex = 1;
			for (const [index, timing] of (grant.videoTimingAssets ?? []).entries()) {
				videoTimingStreams += 1;
				await receiveHelperDataPlaneFile({ binding: timing.binding,
					port: transfers[portIndex++]!.port as never,
					path: join(root, `timing-${String(hostJobs)}-${String(index)}.scti`) });
			}
			for (const [index, input] of grant.inputs.entries()) {
				await receiveHelperDataPlaneFile({ binding: input.frame,
					port: transfers[portIndex + index]!.port as never,
					path: join(root, `input-${String(hostJobs)}-${String(index)}.rgba`) });
			}
			const outputPath = join(root, `output-${String(hostJobs)}.rgba`);
			await writeFile(outputPath, OUTPUT_BYTES);
			const completion = { streamId: grant.output.frame.streamId,
				byteLength: OUTPUT_BYTES.byteLength, sha256: digest(OUTPUT_BYTES) };
			await sendHelperDataPlaneReservedFile({ reservation: grant.output.frame, completion,
				port: transfers.at(-1)!.port as never, path: outputPath });
			return { output: completion };
		}, runtimeState),
	});
	const scanner = await executable(scannerPath);
	const runtimeHost = await executable(runtimePath);
	const preferences = { nativeMediaEnabled: false, ofxConsentEnabled: false };
	const policy = { cleared: true };
	const runtimeAvailable = { available: true };
	const payloadAvailable = { value: true };
	let selections = 0;
	let currentProjectChecks = 0;
	let videoTimingAuthorityChecks = 0;
	const channelState: { calls: number; failAt: number | null } = { calls: 0, failAt: null };
	const plan = options.plan ?? candidatePlan();
	const service = new FramescaperOpenFxMainService({
		runtime: {
			get payloadAvailability() { return payloadAvailable.value
				? { status: 'available' as const, descriptor: {
					target: 'linux-x64' as const, runtime: 'linux-x64' as const, hostVersion: '1.0.0',
					openfxVersion: '1.5.1' as const, openfxCommit: 'ab77951' as const, scanner, runtimeHost,
					isolation: {
						launcher: scanner, sandboxProfile: scanner, brokerPolicy: scanner, runtimeLibraries: [],
					},
					productionReadiness: openFxProductionReadinessFixture(scanner.sha256, runtimeHost.sha256),
				} }
				: { status: 'unavailable' as const, reason: 'payload-pending-external' as const,
					detail: 'No authenticated OpenFX payload.' }; },
			reason: null, manager,
			available: () => runtimeAvailable.available,
			selfTestPassed: () => true, dispose: () => true,
		},
		scratchRoot: join(root, 'scratch'),
		preferences: () => preferences,
		policyCleared: () => policy.cleared,
		selectPluginBinary: async () => { selections += 1; return pluginPath; },
		createMessageChannel: () => {
			channelState.calls += 1;
			if (channelState.calls === channelState.failAt) throw new Error('Injected channel failure.');
			const channel = new MessageChannel();
			return { hostPort: channel.port1, helperPort: channel.port2 } as unknown as
				FramescaperOpenFxMainServiceMessageChannel;
		},
		currentProject: ({ id, revision }, effect) => {
			currentProjectChecks += 1;
			return id === plan.project.id && revision === plan.project.revision
				&& effect !== undefined
				&& JSON.stringify(effect) === JSON.stringify(interactEffect(plan));
		},
		videoTimingAssets: async (timingPlan) => {
			videoTimingAuthorityChecks += 1;
			assert.equal(timingPlan, plan);
			return options.videoTimingAssets ?? [];
		},
		mintOpaqueId: () => '11'.repeat(20),
	});
	return {
		service, pluginPath, preferences, policy, runtimeAvailable, payloadAvailable, plan,
		runtimeState, channelState, scratchRoot: join(root, 'scratch'),
		get selections() { return selections; },
		get scanJobs() { return scanJobs; },
		get hostJobs() { return hostJobs; },
		get videoTimingStreams() { return videoTimingStreams; },
		get videoTimingAuthorityChecks() { return videoTimingAuthorityChecks; },
		get currentProjectChecks() { return currentProjectChecks; },
	};
}

function retimerVfrCandidate() {
	const fixture = unifiedExactVfrPlanFixture(12, '77'.repeat(32));
	const raw = structuredClone(fixture.plan);
	raw.output.canvas.width = 2;
	raw.output.canvas.height = 2;
	const effect = structuredClone(unifiedExactPlanFixture(12).nodes.find(({ kind }) => kind === 'openfx'));
	if (!effect || !('state' in effect)) throw new Error('The OpenFX fixture is unavailable.');
	Object.assign(effect.state as object, {
		pluginId: 'org.framescaper.conformance', binarySha256: PLUGIN_SHA,
		context: 'retimer', attachment: { kind: 'retimer', targetId: 'vfr-clip' },
		inputs: [{ name: 'Source', sourceRef: 'vfr-source' }], parameters: [],
		frozenFallback: null,
	});
	(raw.nodes as unknown as object[]).push(effect);
	const plan = createUnifiedExactRenderPlanWithTimingSidecars(
		raw, fixture.timingSidecars,
	) as UnifiedExactRenderPlanV12;
	if (plan.version !== 12) throw new Error('The VFR OpenFX fixture did not create V12.');
	const input = nativeMediaPlanVideoTimingAssetInputs(plan)[0];
	if (!input) throw new Error('The VFR OpenFX fixture has no timing reference.');
	return Object.freeze({
		plan,
		assets: Object.freeze([{ input, bytes: fixture.publication.bytes }]),
		sourceTime: createUnifiedExactRenderOfxRetimerSourceTime(
			plan, 'ofx-1', 2, fixture.timingSidecars,
		),
	});
}

function candidatePlan(): UnifiedExactRenderPlanV12 {
	const raw = structuredClone(unifiedExactPlanFixture(12));
	raw.output.canvas.width = 2;
	raw.output.canvas.height = 2;
	const effect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!effect || !('state' in effect)) throw new Error('fixture effect is unavailable');
	Object.assign(effect.state as object, {
		pluginId: 'org.framescaper.conformance', binarySha256: PLUGIN_SHA,
		context: 'filter', attachment: { kind: 'filter', targetId: 'clip-out' },
		parameters: [{ name: 'radius', type: 'double', value: [1],
			keyframes: [{ frame: 3, value: 0.5 }] }],
	});
	const plan = createUnifiedExactRenderPlan(raw);
	assertUnifiedExactRenderPlanV12(plan);
	return plan;
}

function interactEffect(plan: UnifiedExactRenderPlanV12): OfxEffectStateV26 {
	const node = plan.nodes.find((candidate) => candidate.kind === 'openfx');
	if (!node || node.kind !== 'openfx') throw new Error('The OpenFX fixture effect is unavailable.');
	return structuredClone(node.state);
}

function executionRequest(
	fixture: Awaited<ReturnType<typeof createFixture>>,
	pluginHandle: string,
) {
	return {
		pluginHandle, plan: fixture.plan, instanceId: 'ofx-1',
		requestedBackend: 'cpu' as const, outputOrdinal: 3,
		inputs: [{ name: 'Source', sourceRef: 'source-1', width: 2, height: 2, rowBytes: 8,
			rgba: new Uint8Array(INPUT_BYTES) }],
	};
}

function worker(
	run: (request: HelperJobRequest<'ofx-scan' | 'ofx-host'>) => Promise<unknown>,
	state: { quarantined: boolean } = { quarantined: false },
): OfxIsolatedWorkerPort {
	return {
		runJob: (request) => run(request as HelperJobRequest<'ofx-scan' | 'ofx-host'>),
		snapshot: (): HelperSupervisorSnapshot => ({ state: state.quarantined ? 'quarantined' : 'ready',
			recentCrashes: state.quarantined ? 3 : 0, quarantined: state.quarantined }),
		clearQuarantine: () => { state.quarantined = false; }, dispose: () => undefined,
	};
}

async function executable(path: string) {
	const [bytes, details] = await Promise.all([readFile(path), stat(path)]);
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes),
		identity: { dev: details.dev, ino: details.ino } };
}

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
