/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import { assertOfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';
import { createOpenFxHelperJobRunner } from '../desktop/openfx-helper-job.ts';
import { receiveHelperDataPlaneReservedFile } from '../desktop/helper-data-plane-io.ts';
import {
	buildOpenFxNativeContractFixture as buildContractFixture,
	cleanupOpenFxNativeContractFixture,
	expectedOpenFxNativeScannerDescriptor,
} from './helpers/openfx-native-scanner-fixture.js';
import {
	createV12PlanVariant,
	createV12VfrRetimerWireFixture,
	createV12WireFixture,
	invokeV12Grant,
	invokeV12PlanVariant,
	sha256,
} from './helpers/openfx-native-v12-fixture.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const hostRoot = join(repositoryRoot, 'native/framescaper-openfx-host');
const sources = join(hostRoot, 'src');

test.after(cleanupOpenFxNativeContractFixture);

test('the conformance scanner authenticates one binary before enumerating its entry points', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const scanned = run(build.scanner, [
			'--scan', build.plugin, '--sha256', build.sha256,
		]);
		assert.equal(scanned.status, 0, scanned.stderr);
		const result = JSON.parse(scanned.stdout);
		assert.doesNotThrow(() => assertOfxPluginDescriptorV1(result));
		assert.deepEqual(result, expectedOpenFxNativeScannerDescriptor(build.sha256));

		const wrongDigest = run(build.scanner, [
			'--scan', build.plugin, '--sha256', '00'.repeat(32),
		]);
			assert.notEqual(wrongDigest.status, 0);
			assert.match(wrongDigest.stderr, /digest|authenticate/iu);
			const mismatched = run(build.scanner, [
				'--scan', build.mismatchPlugin, '--sha256', build.mismatchSha256,
			]);
			assert.notEqual(mismatched.status, 0);
			assert.match(mismatched.stderr, /closed description/iu);
	} finally {
		build.cleanup();
	}
});

test('the conformance scanner rejects malformed or unusable media declarations', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		for (const fixture of build.mediaDeclarationPlugins) {
			const scanned = run(build.scanner, [
				'--scan', fixture.path, '--sha256', fixture.sha256,
			]);
			assert.notEqual(scanned.status, 0, fixture.name);
			assert.match(scanned.stderr, /closed description/iu, fixture.name);
		}
	} finally {
		build.cleanup();
	}
});

test('the helper runner carries the actual native scanner descriptor over its reserved data plane', async (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	const scratchRoot = join(build.directory, 'adapter-scratch');
	mkdirSync(scratchRoot);
	const scratch = statSync(scratchRoot);
	const channel = new MessageChannel();
	context.after(() => { channel.port1.close(); channel.port2.close(); });
	const reservation = {
		dataPlaneVersion: 1, transport: 'message-port', streamId: 'de'.repeat(20),
		direction: 'helper-to-host', exactByteLength: null, maximumByteLength: 4 * 1024 * 1024,
		maximumChunkBytes: 16 * 1024 * 1024, maximumInFlightChunks: 1,
	};
	const outputPath = join(build.directory, 'adapter-descriptor.json');
	const receiving = receiveHelperDataPlaneReservedFile({
		reservation, port: channel.port2, path: outputPath,
	});
	const runner = createOpenFxHelperJobRunner({
		descriptor: {
			target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
			openfxVersion: '1.5.1', openfxCommit: 'ab77951',
			scanner: nativeExecutable(build.scanner), runtimeHost: nativeExecutable(build.runtime),
		},
		mode: 'scanner', pluginFingerprint: null,
	});
	const job = runner.run({ kind: 'ofx-scan', grant: {
		executable: nativeExecutableGrant('ofx-scanner', build.scanner),
		pluginBinary: nativeExecutableGrant('ofx-plugin', build.plugin),
		descriptor: reservation,
		scratch: { rootPath: scratchRoot, rootIdentity: { dev: scratch.dev, ino: scratch.ino },
			reservationId: 'df'.repeat(20), maximumBytes: 8 * 1024 * 1024 },
	}, ports: [channel.port1] });
	await Promise.all([job.completion, receiving]);
	assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')),
		expectedOpenFxNativeScannerDescriptor(build.sha256));
});

test('production entry points refuse third-party loading without OS isolation attestation', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const refused = run(build.blockedScanner, [
			'--scan', build.plugin, '--sha256', build.sha256,
		]);
		assert.equal(refused.status, 78);
		assert.deepEqual(JSON.parse(refused.stderr), {
			error: 'isolation-unavailable',
			message: 'isolation-unavailable: no reviewed OS isolation launcher attestation is implemented; third-party OpenFX loading is disabled.',
		});
	} finally {
		build.cleanup();
	}
});

test('the native runtime exposes the closed OFX 1.5.1 suite surface and six contexts', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		for (const ofxContext of [
			'generator', 'filter', 'transition', 'paint', 'retimer', 'general',
		]) {
			const invoked = run(build.runtime, [
				'--invoke', build.plugin, '--sha256', build.sha256,
				'--plugin', '0', '--context', ofxContext,
				'--action', 'render', '--backend', 'cpu',
			]);
			assert.equal(invoked.status, 0, invoked.stderr);
			const result = JSON.parse(invoked.stdout);
			assert.equal(result.context, ofxContext);
			assert.equal(result.action, 'render');
			assert.equal(result.backend, 'cpu');
			assert.equal(result.suitesDispatched, true);
			assert.equal(result.cpuRendered, true);
			assert.equal(result.offscreenUiAvailable, true);
			assert.equal(
				result.offscreenUiStatus,
				'overlay-interact-v2-draw-suite-v1-cpu',
			);
			assert.equal(result.overlayInteractVersion, 2);
			assert.equal(result.offscreenDrawCalls, 2);
			assert.equal(result.offscreenPixelsTouched, 5);
			assert.equal(result.oneFingerprintPerProcess, true);
		}

		const gpu = run(build.runtime, [
			'--invoke', build.plugin, '--sha256', build.sha256,
			'--plugin', '0', '--context', 'filter',
			'--action', 'render', '--backend', 'cuda',
		]);
		assert.equal(gpu.status, 0, gpu.stderr);
		assert.deepEqual(
			(({ backend, requestedBackend, retriedOnCpu, reportsDegradation }) => (
				{ backend, requestedBackend, retriedOnCpu, reportsDegradation }
			))(JSON.parse(gpu.stdout)),
			{
				backend: 'cpu', requestedBackend: 'cuda',
				retriedOnCpu: true, reportsDegradation: true,
			},
		);
	} finally {
		build.cleanup();
	}
});

test('native runtime cancellation and grant admission fail closed', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const base = [
			'--invoke', build.plugin, '--sha256', build.sha256,
			'--plugin', '0', '--context', 'filter', '--action', 'render',
			'--backend', 'cpu',
		];
		const cancelled = run(build.runtime, [...base, '--cancelled']);
		assert.equal(cancelled.status, 75, cancelled.stderr);
		assert.deepEqual(JSON.parse(cancelled.stdout), {
			accepted: false, cancellationObserved: true,
		});
		assert.notEqual(run(build.runtime, [
			...base.slice(0, 6), '--context', 'writer', ...base.slice(8),
		]).status, 0);
		assert.notEqual(run(build.runtime, [...base, '--socket', '127.0.0.1']).status, 0);
	} finally {
		build.cleanup();
	}
});

test('the native V12 seam reparses and correlates the exact invocation, graph, named frame, and output', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const wire = createV12WireFixture(build, 'filter');
		const invoked = run(build.runtime, [
			'--invoke-v12-grant', wire.grantPath, '--grant-sha256', wire.grantSha256,
		]);
		assert.equal(invoked.status, 0, invoked.stderr);
		const result = JSON.parse(invoked.stdout);
		assert.deepEqual({
			accepted: result.accepted,
			planVersion: result.planVersion,
			nodeId: result.nodeId,
			instanceId: result.instanceId,
			pluginId: result.pluginId,
			inputNames: result.inputNames,
			outputStreamId: result.outputStreamId,
			outputByteLength: result.outputByteLength,
			outputSha256: result.outputSha256,
			outputWidth: result.outputWidth,
			outputHeight: result.outputHeight,
			outputRowBytes: result.outputRowBytes,
		}, {
			accepted: true,
			planVersion: 12,
			nodeId: 'openfx-node',
			instanceId: 'ofx-1',
			pluginId: 'org.framescaper.conformance',
			inputNames: ['Source'],
			outputStreamId: '30'.repeat(20),
			outputByteLength: wire.outputBytes.byteLength,
			outputSha256: sha256(wire.outputBytes),
			outputWidth: 2,
			outputHeight: 2,
			outputRowBytes: 12,
		});
		assert.equal(Object.hasOwn(result, 'outputRgbaHex'), false);
		assert.deepEqual(readFileSync(wire.outputPath), wire.outputBytes);
		assert.equal(result.sourceTimeVerified, false); assert.equal(result.outputOrdinal, 4);
		assert.equal(result.hydratedParameterCount, 1);
		assert.equal(result.hydratedKeyframeCount, 2);
		assert.equal(result.offscreenUiRendered, true);
		assert.equal(result.overlayInteractVersion, 2);
		assert.equal(result.offscreenDrawCalls, 2);
		assert.equal(result.offscreenPixelsTouched, 5);
		const gpu = structuredClone(wire.grant);
		gpu.invocation.requestedBackend = 'cuda';
		const gpuRejected = invokeV12Grant(build.runtime, wire.directory, gpu);
		assert.notEqual(gpuRejected.status, 0);
		assert.match(gpuRejected.stderr, /"error":"unsupported-backend"/u);
		for (const mutate of [
			(grant) => { grant.invocation.nodeId = 'different-node'; },
			(grant) => { grant.invocation.instanceId = 'different-instance'; },
			(grant) => { grant.invocation.stateSha256 = '11'.repeat(32); },
			(grant) => { grant.invocation.outputOrdinal = 10; },
			(grant) => {
				grant.invocation.pluginId = 'net.example.Different';
				grant.invocation.pluginFingerprint = `net.example.Different@${grant.invocation.pluginBinarySha256}`;
			},
			(grant) => { grant.inputs[0].sourceRef = 'different-source'; },
			(grant) => { grant.output.sha256 = '00'.repeat(32); },
		]) {
			const candidate = structuredClone(wire.grant);
			mutate(candidate);
			const rejected = invokeV12Grant(build.runtime, wire.directory, candidate);
			assert.notEqual(rejected.status, 0);
			assert.match(rejected.stderr, /"error":"(?:admission|identity-mismatch)"/u);
		}
		const noncanonical = structuredClone(wire.grant);
		const changedPlan = Buffer.concat([readFileSync(wire.grant.plan.path), Buffer.from('\n')]);
		const changedPlanPath = join(wire.directory, 'plan-noncanonical.json');
		writeFileSync(changedPlanPath, changedPlan, { flag: 'wx' });
		noncanonical.plan.path = changedPlanPath;
		noncanonical.plan.byteLength = changedPlan.byteLength;
		noncanonical.plan.sha256 = sha256(changedPlan);
		noncanonical.invocation.unifiedPlanSha256 = noncanonical.plan.sha256;
		const rejectedPlan = invokeV12Grant(build.runtime, wire.directory, noncanonical);
		assert.notEqual(rejectedPlan.status, 0);
		assert.match(rejectedPlan.stderr, /"error":"authentication"/u);

		const fractionalInteger = invokeV12PlanVariant(build.runtime, wire, (state) => {
			state.parameters[0] = {
				name: 'speed', type: 'integer2d', value: [1.5, 2], keyframes: [],
			};
		});
		assert.notEqual(fractionalInteger.status, 0);
		assert.match(fractionalInteger.stderr, /"error":"admission".*integer component/iu);

		const ambiguousKeyframe = invokeV12PlanVariant(build.runtime, wire, (state) => {
			state.parameters[0] = {
				name: 'speed', type: 'integer2d', value: [1, 2],
				keyframes: [{ frame: 3, value: 1 }],
			};
		});
		assert.notEqual(ambiguousKeyframe.status, 0);
		assert.match(ambiguousKeyframe.stderr, /"error":"admission".*keyframe.*scalar/iu);

		for (const mutate of [
			(grant) => { grant.inputs[0].width = 0; },
			(grant) => { grant.inputs[0].rowBytes = 4; },
			(grant) => { grant.inputs[0].height = 3; },
			(grant) => { grant.inputs[0].pixelFormat = 'bgra8'; },
			(grant) => { grant.output.rowBytes = 16; },
			(grant) => { grant.output.path = grant.inputs[0].path; },
		]) {
			const candidate = structuredClone(wire.grant);
			mutate(candidate);
			const rejected = invokeV12Grant(build.runtime, wire.directory, candidate);
			assert.notEqual(rejected.status, 0);
			assert.match(rejected.stderr, /"error":"(?:admission|identity-mismatch|authentication)"/u);
		}
	} finally {
		build.cleanup();
	}
});

test('V12 binds genuine context topology and host-owned standard parameters', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const topology = new Map([
			['generator', []], ['filter', ['Source']],
			['transition', ['SourceFrom', 'SourceTo']], ['paint', ['Source', 'Mask']],
			['retimer', ['Source']], ['general', ['InputA', 'InputB']],
		]);
		for (const [ofxContext, inputNames] of topology) {
			const wire = createV12WireFixture(build, ofxContext);
			const invoked = run(build.runtime, [
				'--invoke-v12-grant', wire.grantPath, '--grant-sha256', wire.grantSha256,
			]);
			if (invoked.status !== 0 && /exact-(?:retime|transition)-oracle-unavailable/u.test(invoked.stderr)) {
				assert.equal(['retimer', 'transition'].includes(ofxContext), true);
				continue;
			}
			assert.equal(invoked.status, 0, invoked.stderr);
			const result = JSON.parse(invoked.stdout);
			assert.deepEqual(result.inputNames, inputNames);
			assert.equal(result.hostStandardParameter,
				ofxContext === 'retimer' ? 'SourceTime'
					: ofxContext === 'transition' ? 'Transition' : null);
			assert.equal(result.sourceTimeVerified, ofxContext === 'retimer');
			assert.equal(result.transitionValueVerified, ofxContext === 'transition');
			assert.deepEqual(readFileSync(wire.outputPath), wire.outputBytes);
			if (ofxContext !== 'retimer' && ofxContext !== 'transition') continue;
			const standard = ofxContext === 'retimer' ? 'SourceTime' : 'Transition';
			const persisted = invokeV12PlanVariant(build.runtime, wire, (state) => {
				state.parameters.push({ name: standard, type: 'double', value: [0.25], keyframes: [] });
			});
			assert.notEqual(persisted.status, 0);
			assert.match(persisted.stderr, /Persisted state cannot override.*standard parameter/iu);
		}
		for (const ofxContext of ['retimer', 'transition']) {
			const spoof = createV12WireFixture({
				...build, plugin: build.spoofPlugin, sha256: build.spoofSha256,
			}, ofxContext);
			const rejected = run(build.runtime, [
				'--invoke-v12-grant', spoof.grantPath, '--grant-sha256', spoof.grantSha256,
			]);
			assert.notEqual(rejected.status, 0);
			assert.match(rejected.stderr, /action lifecycle|exact-(?:retime|transition)-oracle/iu);
		}
	} finally {
		build.cleanup();
	}
});

test('the native V12 render cooperatively observes its exact cancellation marker', async (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const wire = createV12WireFixture(build, 'filter');
		const cancelled = createV12PlanVariant(wire, (state) => {
			state.parameters.push({
				name: 'cancelIterations', type: 'integer', value: 1_000_000_000, keyframes: [],
			});
		});
		const running = runAsync(build.runtime, [
			'--invoke-v12-grant', cancelled.grantPath,
			'--grant-sha256', cancelled.grantSha256,
		]);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
		running.stdin.end(cancelled.cancellationFrame);
		const result = await running.completion;
		assert.equal(result.status, 75, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), {
			accepted: false,
			cancellationObserved: true,
			cooperative: true,
			abortSignalId: cancelled.grant.invocation.abortSignalId,
		});
		for (const hostileFrame of [
			cancelled.cancellationFrame.replace(
				cancelled.grant.invocation.abortSignalId, 'abort-wrong-identity',
			),
			cancelled.cancellationFrame.slice(0, -3),
		]) {
			const hostile = runAsync(build.runtime, [
				'--invoke-v12-grant', cancelled.grantPath,
				'--grant-sha256', cancelled.grantSha256,
			]);
			hostile.stdin.end(hostileFrame);
			const refused = await hostile.completion;
			assert.equal(refused.status, 65, refused.stderr);
			assert.equal(refused.stdout, '');
			assert.match(refused.stderr, /"error":"cancellation-protocol"/u);
		}
	} finally {
		build.cleanup();
	}
});

test('the native V12 Retimer accepts only the exact ordinal oracle SourceTime or fails closed when Boost is absent', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const wire = createV12WireFixture(build, 'retimer');
		const exact = run(build.runtime, [
			'--invoke-v12-grant', wire.grantPath, '--grant-sha256', wire.grantSha256,
		]);
		if (exact.status === 76) {
			assert.match(exact.stderr, /"error":"exact-retime-oracle-unavailable"/u);
		} else {
			assert.equal(exact.status, 0, exact.stderr);
			assert.equal(JSON.parse(exact.stdout).sourceTimeVerified, true);
		}
		const forged = structuredClone(wire.grant); forged.invocation.retimerSourceTime.outputOrdinal = 3;
		let rejected = invokeV12Grant(build.runtime, wire.directory, forged);
		assert.match(rejected.stderr, /SourceTime does not bind the invocation output ordinal/u);
		forged.invocation.retimerSourceTime.outputOrdinal = 4; forged.invocation.retimerSourceTime.numerator = '90071992547409909';
		rejected = invokeV12Grant(build.runtime, wire.directory, forged);
		assert.match(rejected.stderr, /"error":"(?:source-time-mismatch|exact-retime-oracle-unavailable)"/u);
	} finally {
		build.cleanup();
	}
});

test('the native V12 Retimer authenticates VFR timing bytes before accepting exact SourceTime', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const wire = createV12VfrRetimerWireFixture(build);
		const exact = run(build.runtime, [
			'--invoke-v12-grant', wire.grantPath, '--grant-sha256', wire.grantSha256,
		]);
		if (!build.exactRetimeAvailable) {
			assert.equal(exact.status, 65, exact.stderr);
			assert.match(exact.stderr, /pinned exact arithmetic closure/iu);
			return;
		}
		assert.equal(exact.status, 0, exact.stderr);
		assert.equal(JSON.parse(exact.stdout).sourceTimeVerified, true);

		const missing = structuredClone(wire.grant);
		delete missing.videoTimingAssets;
		let rejected = invokeV12Grant(build.runtime, wire.directory, missing);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /timing asset|timing bytes/iu);

		const extraBytes = Buffer.from(readFileSync(wire.timingPath));
		extraBytes.writeBigInt64LE(20n, 40);
		const extraPath = join(wire.directory, 'timing-extra.scti');
		writeFileSync(extraPath, extraBytes, { flag: 'wx' });
		const extra = structuredClone(wire.grant);
		extra.videoTimingAssets.push({
			path: extraPath, byteLength: extraBytes.byteLength, sha256: sha256(extraBytes),
		});
		rejected = invokeV12Grant(build.runtime, wire.directory, extra);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /not owned|timing asset/iu);

		const replayed = structuredClone(wire.grant);
		replayed.videoTimingAssets.push(structuredClone(replayed.videoTimingAssets[0]));
		rejected = invokeV12Grant(build.runtime, wire.directory, replayed);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /duplicated|replay/iu);

		const swapped = structuredClone(wire.grant);
		swapped.videoTimingAssets[0] = {
			path: extraPath, byteLength: extraBytes.byteLength, sha256: sha256(extraBytes),
		};
		rejected = invokeV12Grant(build.runtime, wire.directory, swapped);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /requires verified timing asset bytes|timing asset/iu);

		const forged = structuredClone(wire.grant);
		forged.invocation.retimerSourceTime.numerator = String(
			BigInt(forged.invocation.retimerSourceTime.numerator) + 1n,
		);
		rejected = invokeV12Grant(build.runtime, wire.directory, forged);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /source-time-mismatch|SourceTime differs/iu);

		const original = readFileSync(wire.timingPath);
		const tampered = Buffer.from(original);
		tampered[tampered.byteLength - 1] ^= 1;
		writeFileSync(wire.timingPath, tampered);
		rejected = invokeV12Grant(build.runtime, wire.directory, wire.grant);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /digest|authenticate|timing/iu);
		writeFileSync(wire.timingPath, original);
	} finally {
		build.cleanup();
	}
});

test('production sources bind to the pinned SDK ABI and contain no ambient authority APIs', () => {
	const abi = readFileSync(join(sources, 'openfx_abi.hpp'), 'utf8');
	for (const header of [
		'ofxCore.h', 'ofxImageEffect.h', 'ofxProperty.h', 'ofxParam.h',
		'ofxMemory.h', 'ofxMultiThread.h', 'ofxMessage.h', 'ofxProgress.h',
		'ofxTimeLine.h', 'ofxInteract.h', 'ofxDrawSuite.h',
	]) assert.match(abi, new RegExp(`#include <${header.replace('.', '\\.')}>`, 'u'));

	const allSources = [
		'isolation_contract.hpp', 'openfx_abi.hpp', 'sha256.cpp', 'sha256.hpp',
		'dynamic_library.cpp', 'dynamic_library.hpp', 'host_runtime.cpp',
		'host_runtime.hpp', 'host_parameter_hydration.hpp', 'host_scan_inspection.inc',
		'host_standard_parameters.inc',
		'loaded_plugin_binary.cpp', 'ofx_scanner.cpp', 'ofx_runtime_host.cpp',
		'rgba_frame.hpp',
		'v12_cancellation_channel.cpp', 'v12_cancellation_channel.hpp',
		'v12_host_invocation.cpp', 'v12_host_invocation.hpp',
		'v12_output_file.cpp', 'v12_output_file.hpp',
		'v12_retime_authority.cpp', 'v12_retime_authority.hpp',
		'v12_transition_authority.cpp', 'v12_transition_authority.hpp',
	].map((file) => readFileSync(join(sources, file), 'utf8')).join('\n');
	assert.doesNotMatch(allSources, /\b(?:socket|connect|listen|accept|popen|system|ShellExecute)\s*\(/u);
	assert.doesNotMatch(allSources, /CreateWindow|NSWindow|XCreateWindow/u);
	assert.match(allSources, /kOfxImageEffectActionRender/u);
	assert.match(allSources, /kOfxImageEffectActionGetFramesNeeded/u);
	assert.match(allSources, /kOfxInteractSuite/u);
	assert.match(allSources, /kOfxImageEffectPluginPropOverlayInteractV2/u);
	assert.match(allSources, /kOfxInteractActionDraw/u);
	assert.match(allSources, /kOfxDrawSuite/u);
	assert.match(allSources, /exact_retime_ordinal\.hpp/u);
	assert.match(allSources, /SourceTime differs from the exact ordinal oracle/u);
	assert.match(allSources, /output ordinal is outside its attached transition overlap/u);
	const retimeAuthority = readFileSync(join(sources, 'v12_retime_authority.cpp'), 'utf8');
	assert.ok(
		retimeAuthority.indexOf('SourceTime differs from the exact ordinal oracle')
		< retimeAuthority.indexOf('return ofx_time(expected)'),
		'OFX conversion must occur only after exact SourceTime equality succeeds',
	);
	const cmake = readFileSync(join(hostRoot, 'CMakeLists.txt'), 'utf8');
	assert.match(cmake, /find_package\(Boost 1\.92\.0 EXACT REQUIRED\)/u);
	assert.match(cmake, /media_plan\.cpp/u);
});

function nativeExecutable(path) {
	const bytes = readFileSync(path); const identity = statSync(path);
	return { path, byteLength: bytes.byteLength,
		sha256: sha256(bytes), identity: { dev: identity.dev, ino: identity.ino } };
}

function nativeExecutableGrant(role, path) {
	const value = nativeExecutable(path);
	return { role, path, bytes: value.byteLength, sha256: value.sha256, identity: value.identity };
}

function run(executable, args) {
	return spawnSync(executable, args, { encoding: 'utf8' });
}

function runAsync(executable, args) {
	const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
	const completion = new Promise((resolveRun, rejectRun) => {
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => resolveRun({
			status: code, signal, stdout, stderr,
		}));
	});
	return { completion, stdin: child.stdin };
}
