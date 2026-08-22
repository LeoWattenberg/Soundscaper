/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	createNativeMediaPlanEnvelopeV1,
} from '../src/common/editor/native-media-plan-envelope.ts';
import {
	createOfxHostInvocationV1,
} from '../src/common/editor/native-ofx-host-contract.ts';
import {
	createUnifiedExactRenderOfxRetimerSourceTime,
} from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import {
	createUnifiedExactRenderPlan,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	unifiedExactPlanFixture,
	unifiedExactTimingFixture,
} from './helpers/unified-exact-render-plan-fixture.ts';

const repositoryRoot = resolve(import.meta.dirname, '..');
const hostRoot = join(repositoryRoot, 'native/framescaper-openfx-host');
const sources = join(hostRoot, 'src');
const fixture = join(hostRoot, 'fixtures', 'conformance_plugin.cpp');
let retainedBuild;
let retainedCleanup = () => undefined;
let wireSequence = 0;

test.after(() => retainedCleanup());

test('the conformance scanner authenticates one binary before enumerating its entry points', (context) => {
	const build = buildContractFixture(context);
	if (build === null) return;
	try {
		const scanned = run(build.scanner, [
			'--scan', build.plugin, '--sha256', build.sha256,
		]);
		assert.equal(scanned.status, 0, scanned.stderr);
		const result = JSON.parse(scanned.stdout);
		assert.equal(result.mode, 'short-lived-scanner');
		assert.equal(result.authenticatedBeforeLoad, true);
		assert.equal(result.loadsOneBinary, true);
		assert.equal(result.exitsAfterScan, true);
		assert.equal(result.contractFixture, true);
		assert.equal(result.osIsolationAttested, false);
		assert.equal(result.binarySha256, build.sha256);
		assert.deepEqual(result.plugins, [{
			api: 'OfxImageEffectPluginAPI',
			apiVersion: 1,
			id: 'org.framescaper.conformance',
			major: 1,
			minor: 5,
		}]);

		const wrongDigest = run(build.scanner, [
			'--scan', build.plugin, '--sha256', '00'.repeat(32),
		]);
		assert.notEqual(wrongDigest.status, 0);
		assert.match(wrongDigest.stderr, /digest|authenticate/iu);
	} finally {
		build.cleanup();
	}
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
			outputWidth: 3,
			outputHeight: 2,
			outputRowBytes: 16,
		});
		assert.equal(Object.hasOwn(result, 'outputRgbaHex'), false);
		assert.deepEqual(readFileSync(wire.outputPath), wire.outputBytes);
		assert.equal(result.sourceTimeVerified, false);
		assert.equal(result.hydratedParameterCount, 1);
		assert.equal(result.hydratedKeyframeCount, 1);
		assert.equal(result.offscreenUiRendered, true);
		assert.equal(result.overlayInteractVersion, 2);
		assert.equal(result.offscreenDrawCalls, 2);
		assert.equal(result.offscreenPixelsTouched, 5);

		for (const mutate of [
			(grant) => { grant.invocation.nodeId = 'different-node'; },
			(grant) => { grant.invocation.instanceId = 'different-instance'; },
			(grant) => { grant.invocation.stateSha256 = '11'.repeat(32); },
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
			(grant) => { grant.inputs[0].rowBytes = 8; },
			(grant) => { grant.inputs[0].height = 3; },
			(grant) => { grant.inputs[0].pixelFormat = 'bgra8'; },
			(grant) => { grant.output.rowBytes = 12; },
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

		const forged = structuredClone(wire.grant);
		forged.invocation.retimerSourceTime.numerator = '90071992547409909';
		const rejected = invokeV12Grant(build.runtime, wire.directory, forged);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /"error":"(?:source-time-mismatch|exact-retime-oracle-unavailable)"/u);
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
		'host_runtime.hpp', 'host_parameter_hydration.hpp', 'ofx_scanner.cpp', 'ofx_runtime_host.cpp',
		'rgba_frame.hpp',
		'v12_cancellation_channel.cpp', 'v12_cancellation_channel.hpp',
		'v12_host_invocation.cpp', 'v12_host_invocation.hpp',
		'v12_output_file.cpp', 'v12_output_file.hpp',
		'v12_retime_authority.cpp', 'v12_retime_authority.hpp',
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
	assert.doesNotMatch(
		readFileSync(join(sources, 'v12_retime_authority.cpp'), 'utf8'),
		/\b(?:double|float)\b/u,
	);
	const cmake = readFileSync(join(hostRoot, 'CMakeLists.txt'), 'utf8');
	assert.match(cmake, /find_package\(Boost 1\.92\.0 EXACT REQUIRED\)/u);
	assert.match(cmake, /media_plan\.cpp/u);
});

function buildContractFixture(context) {
	if (retainedBuild !== undefined) {
		if (retainedBuild === null) context.skip('A C++ compiler is not installed on this source-audit host.');
		return retainedBuild;
	}
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		retainedBuild = null;
		return null;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-openfx-runtime-'));
	const extension = process.platform === 'darwin' ? '.dylib'
		: process.platform === 'win32' ? '.dll' : '.so';
	const plugin = join(directory, `conformance${extension}`);
	const scanner = join(directory, executableName('scanner'));
	const runtime = join(directory, executableName('runtime'));
	const blockedScanner = join(directory, executableName('blocked-scanner'));
	const abiCommon = [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		'-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1', '-I', sources,
	];
	const common = [...abiCommon, '-DFRAMESCAPER_OPENFX_CONFORMANCE_FIXTURE=1'];
	const shared = process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC'];
	const pluginBuild = spawnSync('c++', [...common, ...shared, fixture, '-o', plugin], {
		encoding: 'utf8',
	});
	assert.equal(pluginBuild.status, 0, pluginBuild.stderr);
	const hostSources = [
		join(sources, 'sha256.cpp'), join(sources, 'dynamic_library.cpp'),
		join(sources, 'host_runtime.cpp'), join(sources, 'parameter_values.cpp'),
		join(sources, 'v12_cancellation_channel.cpp'),
		join(sources, 'v12_host_invocation.cpp'), join(sources, 'v12_retime_authority.cpp'),
		join(sources, 'v12_output_file.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/strict_json.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/sha256.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/media_file_grants.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/media_plan.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/legacy_plan_semantics.cpp'),
		join(repositoryRoot, 'native/framescaper-media-host/src/legacy_plan_v8_filter_semantics.cpp'),
	];
	for (const [entry, output] of [
		['ofx_scanner.cpp', scanner], ['ofx_runtime_host.cpp', runtime],
	]) {
		const link = process.platform === 'linux' ? ['-ldl', '-pthread'] : ['-pthread'];
		const built = spawnSync('c++', [
			...common, '-I', join(repositoryRoot, 'native/framescaper-media-host/src'),
			...hostSources, join(sources, entry), ...link, '-o', output,
		], { encoding: 'utf8' });
		assert.equal(built.status, 0, built.stderr);
	}
	const blocked = spawnSync('c++', [
		...abiCommon, '-I', join(repositoryRoot, 'native/framescaper-media-host/src'),
		...hostSources, join(sources, 'ofx_scanner.cpp'),
		...(process.platform === 'linux' ? ['-ldl', '-pthread'] : ['-pthread']),
		'-o', blockedScanner,
	], { encoding: 'utf8' });
	assert.equal(blocked.status, 0, blocked.stderr);
	const bytes = readFileSync(plugin);
	retainedCleanup = () => rmSync(directory, { recursive: true, force: true });
	retainedBuild = {
		directory, plugin, scanner, runtime, blockedScanner,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		cleanup: () => undefined,
	};
	return retainedBuild;
}

function createV12WireFixture(build, context) {
	wireSequence += 1;
	const suffix = `${context}-${String(wireSequence)}`;
	const raw = structuredClone(unifiedExactPlanFixture(12));
	const effect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!effect) throw new Error('OpenFX fixture node is unavailable.');
	effect.state.pluginId = 'org.framescaper.conformance';
	effect.state.binarySha256 = build.sha256;
	effect.state.context = context;
	effect.state.attachment.kind = context;
	const plan = createUnifiedExactRenderPlan(raw);
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	const planFingerprint = fingerprintNativeMediaPlan(plan);
	const inputBytes = Buffer.from([
		9, 8, 7, 6, 20, 30, 40, 50, 255, 0, 1, 2, 170, 170, 170, 170,
		3, 4, 5, 6, 60, 70, 80, 90, 100, 110, 120, 130, 187, 187, 187, 187,
	]);
	const outputBytes = Buffer.from([
		9, 8, 7, 128, 20, 30, 40, 128, 255, 0, 1, 128, 0, 0, 0, 0,
		3, 4, 5, 128, 60, 70, 80, 128, 100, 110, 120, 128, 0, 0, 0, 0,
	]);
	const planPath = join(build.directory, `plan-${suffix}.json`);
	const inputPath = join(build.directory, `input-${suffix}.rgba`);
	const outputPath = join(build.directory, `output-${suffix}.rgba`);
	writeFileSync(planPath, planFingerprint.canonical, { flag: 'wx' });
	writeFileSync(inputPath, inputBytes, { flag: 'wx' });
	const sourceTime = context === 'retimer'
		? createUnifiedExactRenderOfxRetimerSourceTime(
			plan, 'ofx-1', 3, unifiedExactTimingFixture(),
		)
		: null;
	const invocation = createOfxHostInvocationV1({
		invocationId: `native-${suffix}`,
		unifiedPlanVersion: 12,
		unifiedPlanSha256: envelope.fingerprint,
		nodeId: 'openfx-node',
		instanceId: 'ofx-1',
		pluginId: 'org.framescaper.conformance',
		pluginBinarySha256: build.sha256,
		context,
		action: 'render',
		stateSha256: fingerprintNativeMediaPlan(effect.state).sha256,
		inputFrameStreamIds: ['20'.repeat(20)],
		outputFrameStreamId: '30'.repeat(20),
		requestedBackend: 'cpu',
		abortSignalId: `abort-${suffix}`,
		retimerSourceTime: sourceTime,
	});
	const cancellationFrame = `${JSON.stringify({
		schemaVersion: 1, type: 'cancel', invocationId: invocation.invocationId,
		abortSignalId: invocation.abortSignalId,
	})}\n`;
	const grant = {
		schemaVersion: 1,
		pluginBinary: { path: build.plugin, sha256: build.sha256, pluginIndex: 0 },
		invocation,
		plan: {
			path: planPath, byteLength: envelope.canonicalByteLength, sha256: envelope.fingerprint,
		},
		inputs: [{
			name: 'Source', sourceRef: 'source-1', streamId: '20'.repeat(20),
			path: inputPath, pixelFormat: 'rgba8', width: 3, height: 2, rowBytes: 16,
			byteLength: inputBytes.byteLength, sha256: sha256(inputBytes),
		}],
		output: {
			streamId: '30'.repeat(20), path: outputPath, pixelFormat: 'rgba8',
			width: 3, height: 2, rowBytes: 16,
			byteLength: outputBytes.byteLength,
		},
	};
	const admitted = writeGrant(build.directory, grant, `grant-${suffix}`);
	return {
		...admitted, directory: build.directory, cancellationFrame,
		outputPath, outputBytes,
	};
}

function createV12PlanVariant(wire, mutateState) {
	const grant = structuredClone(wire.grant);
	const plan = JSON.parse(readFileSync(grant.plan.path, 'utf8'));
	const effect = plan.nodes.find((node) => node.kind === 'openfx');
	if (!effect) throw new Error('OpenFX fixture node is unavailable.');
	mutateState(effect.state);
	const planFingerprint = fingerprintNativeMediaPlan(plan);
	const token = Math.random().toString(16).slice(2);
	const planPath = join(wire.directory, `plan-variant-${token}.json`);
	writeFileSync(planPath, planFingerprint.canonical, { flag: 'wx' });
	grant.plan = {
		path: planPath,
		byteLength: planFingerprint.byteLength,
		sha256: planFingerprint.sha256,
	};
	grant.invocation.unifiedPlanSha256 = planFingerprint.sha256;
	grant.invocation.stateSha256 = fingerprintNativeMediaPlan(effect.state).sha256;
	const admitted = writeGrant(wire.directory, grant, `grant-variant-${token}`);
	return {
		...admitted,
		directory: wire.directory,
		cancellationFrame: wire.cancellationFrame,
	};
}

function invokeV12PlanVariant(runtime, wire, mutateState) {
	const variant = createV12PlanVariant(wire, mutateState);
	return run(runtime, [
		'--invoke-v12-grant', variant.grantPath, '--grant-sha256', variant.grantSha256,
	]);
}

function invokeV12Grant(runtime, directory, grant) {
	const wire = writeGrant(directory, grant, `candidate-${Math.random().toString(16).slice(2)}`);
	return run(runtime, [
		'--invoke-v12-grant', wire.grantPath, '--grant-sha256', wire.grantSha256,
	]);
}

function writeGrant(directory, grant, name) {
	const bytes = Buffer.from(JSON.stringify(grant));
	const grantPath = join(directory, `${name}.json`);
	writeFileSync(grantPath, bytes, { flag: 'wx' });
	return { grant, grantPath, grantSha256: sha256(bytes) };
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function executableName(name) {
	return process.platform === 'win32' && extname(name) !== '.exe' ? `${name}.exe` : name;
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
