/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import { assertOfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';
import {
	createOpenFxHelperJobRunner,
	selfTestFramescaperOpenFxHelper,
} from '../desktop/openfx-helper-job.ts';
import { receiveHelperDataPlaneReservedFile } from '../desktop/helper-data-plane-io.ts';
import { requireExactRetimeClosure } from './helpers/framescaper-boost-closure.js';
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
import { nativeProcessInvoker } from './helpers/openfx-native-process-invoker.js';
import {
	nativeExecutable,
	nativeExecutableGrant,
	runNativeExecutable as run,
	runNativeExecutableAsync as runAsync,
} from './helpers/openfx-native-runtime-process.js';
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
			mode: 'scanner', pluginFingerprint: null, invokeHost: nativeProcessInvoker,
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

test('production entry points attest no OS isolation and are refused third-party loading', async (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const declared = run(build.blockedScanner, ['--self-test']);
		assert.equal(declared.status, 0, declared.stderr);
		assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(declared.stdout)).filter(
			([key]) => key === 'contractFixture' || key.endsWith('Exposed')
				|| key === 'osIsolationAttested' || key === 'thirdPartyExecutionEnabled',
		)), {
			contractFixture: false, osIsolationAttested: false, thirdPartyExecutionEnabled: false,
			networkSuiteExposed: false, arbitraryFilesystemSuiteExposed: false,
			vendorTopLevelWindowsExposed: false,
		});
		await assert.rejects(
			() => selfTestFramescaperOpenFxHelper(
				{ scanner: nativeExecutable(build.blockedScanner) }, 'scanner', nativeProcessInvoker,
			),
			/lacks production isolation and real third-party execution readiness/u,
		);
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
			assert.equal(result.gpuContextSetup, false);
			assert.equal(result.gpuContextReleased, false);
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

		for (const backend of ['opengl', 'opencl', 'cuda', 'metal']) {
			const gpu = run(build.runtime, [
				'--invoke', build.plugin, '--sha256', build.sha256, '--plugin', '0',
				'--context', 'filter', '--action', 'render', '--backend', backend,
			]);
			assert.equal(gpu.status, 0, gpu.stderr);
			const result = JSON.parse(gpu.stdout);
			assert.deepEqual({
				backend: result.backend, requestedBackend: result.requestedBackend,
				retriedOnCpu: result.retriedOnCpu, reportsDegradation: result.reportsDegradation,
				gpuContextSetup: result.gpuContextSetup, gpuContextReleased: result.gpuContextReleased,
			}, { backend, requestedBackend: backend, retriedOnCpu: false,
				reportsDegradation: false, gpuContextSetup: true, gpuContextReleased: true });
		}
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
	if (!requireExactRetimeClosure(context, build.exactRetimeAvailable)) return;
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
			const gpuInvoked = invokeV12Grant(build.runtime, wire.directory, gpu);
			assert.equal(gpuInvoked.status, 0, gpuInvoked.stderr);
			assert.equal(JSON.parse(gpuInvoked.stdout).backend, 'cuda');
			const unsupported = structuredClone(wire.grant);
			unsupported.invocation.requestedBackend = 'metal';
			const gpuRejected = invokeV12Grant(build.runtime, wire.directory, unsupported);
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
	if (!requireExactRetimeClosure(context, build.exactRetimeAvailable)) return;
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
			assert.equal(result.sourceTimeImageEnforced, ofxContext === 'retimer');
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
	if (!requireExactRetimeClosure(context, build.exactRetimeAvailable)) return;
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
		if (!build.exactRetimeAvailable) {
			assert.equal(exact.status, 65, exact.stderr);
			assert.match(exact.stderr, /pinned exact arithmetic closure/iu);
			return;
		}
		if (exact.status === 76) {
			assert.match(exact.stderr, /"error":"exact-retime-oracle-unavailable"/u);
		} else {
			assert.equal(exact.status, 0, exact.stderr);
				const result = JSON.parse(exact.stdout);
				assert.equal(result.sourceTimeVerified, true);
				assert.equal(result.sourceTimeImageEnforced, true);
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
			const result = JSON.parse(exact.stdout);
			assert.equal(result.sourceTimeVerified, true);
			assert.equal(result.sourceTimeImageEnforced, true);

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
