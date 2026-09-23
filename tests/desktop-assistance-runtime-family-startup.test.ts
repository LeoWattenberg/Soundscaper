/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createAssistanceRuntimeFamilyDesktopStartup,
} from '../desktop/assistance-runtime-family-startup.ts';
import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	ASSISTANCE_RUNTIME_FAMILY_TARGETS,
	type AssistanceRuntimeFamilyId,
} from '../desktop/assistance-runtime-family-manifest.ts';

const GIB = 1024 ** 3;

function packageGeneratedManifest(familyId: AssistanceRuntimeFamilyId) {
	const definition = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[familyId];
	return {
		schemaVersion: 1,
		familyId,
		runtimeVersion: definition.runtimeVersion,
		source: { url: definition.sourceUrl, revision: definition.sourceRevision },
		executionProvider: 'cpu',
		runtimePrefix: `assistance/${familyId}/${definition.runtimeVersion}`,
		targets: ASSISTANCE_RUNTIME_FAMILY_TARGETS.map((id) => ({
			id, status: 'package-generated',
			packageBehavior: 'The target package build generates and verifies this runtime payload.',
		})),
	};
}

function startup(manifests?: Readonly<Partial<Record<AssistanceRuntimeFamilyId, unknown>>>) {
	let forks = 0;
	const runtime = createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot: resolve('fixture-runtime'),
		helperPath: resolve('fixture-runtime-family-helper.js'),
		...(manifests === undefined ? {} : { manifests }),
		platform: 'linux', architecture: 'x64',
		fork: () => { forks += 1; throw new Error('No unpackaged runtime may fork.'); },
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
	});
	return { runtime, forkCount: () => forks };
}

test('desktop startup reports every absent runtime manifest as typed unavailable without spawning', async () => {
	const { runtime, forkCount } = startup();
	for (const familyId of Object.keys(
		ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	) as AssistanceRuntimeFamilyId[]) {
		assert.deepEqual(await runtime.availability(familyId), {
			status: 'unavailable',
			reason: 'manifest-missing',
			detail: `The ${familyId} runtime has no admitted payload manifest.`,
		});
		assert.deepEqual(runtime.snapshot(familyId), {
			familyId, state: 'idle', processSpawned: false,
			recentCrashes: 0, quarantined: false,
		});
	}
	assert.equal(typeof runtime.operations.run, 'function');
	assert.equal(forkCount(), 0);
	await runtime.shutdown();
	assert.equal(runtime.snapshot('onnxruntime-node').state, 'disposed');
});

test('package-generated runtime templates cannot spawn before packaging supplies their bytes', async () => {
	const manifests = Object.freeze({
		'onnxruntime-node': packageGeneratedManifest('onnxruntime-node'),
		'whisper-cpp': packageGeneratedManifest('whisper-cpp'),
		'llama-cpp': packageGeneratedManifest('llama-cpp'),
	});
	const { runtime, forkCount } = startup(manifests);
	for (const familyId of Object.keys(manifests) as AssistanceRuntimeFamilyId[]) {
		const status = await runtime.availability(familyId);
		assert.equal(status.status, 'unavailable');
		if (status.status === 'unavailable') {
			assert.equal(status.reason, 'payload-not-packaged');
			assert.match(status.detail, /package build/iu);
		}
	}
	assert.equal(forkCount(), 0);
	runtime.dispose();
});

test('first-use family availability forwards job cancellation into runtime preparation', async () => {
	const controller = new AbortController();
	let observed: AbortSignal | undefined;
	const onnx = packageGeneratedManifest('onnxruntime-node');
	const manifest = { ...onnx, targets: onnx.targets.map((target) => target.id === 'linux-x64'
		? { id: target.id, status: 'authenticated', entrypoint: 'runtime',
			files: [{ path: 'runtime', byteLength: 1, sha256: 'a'.repeat(64), executable: false }] }
		: target) };
	const runtime = createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot: resolve('fixture-runtime'),
		helperPath: resolve('fixture-runtime-family-helper.js'),
		manifests: { 'onnxruntime-node': manifest },
		platform: 'linux', architecture: 'x64',
		fork: () => { throw new Error('No runtime should spawn.'); },
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
		ensureRuntime: async (_familyId, signal) => { observed = signal; signal?.throwIfAborted(); },
	});
	await runtime.availability('onnxruntime-node', controller.signal);
	assert.equal(observed, controller.signal);
	controller.abort();
	await assert.rejects(runtime.availability('onnxruntime-node', controller.signal), /abort/iu);
	runtime.dispose();
});

test('startup refuses foreign manifest keys before exposing operation routing', () => {
	assert.throws(() => startup({ shell: packageGeneratedManifest('onnxruntime-node') } as never),
		/manifest.*family|key|inventory/iu);
});

test('startup refuses a background-priority hook that cannot be called', () => {
	assert.throws(() => createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot: resolve('fixture-runtime'),
		helperPath: resolve('fixture-runtime-family-helper.js'),
		platform: 'linux', architecture: 'x64',
		fork: () => { throw new Error('no fork is expected'); },
		applyBackgroundPriority: 'low' as unknown as (pid: number) => void,
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
	}), TypeError);
});

test('startup carries the power etiquette port into the router rather than dropping it', () => {
	// The router validates the port when it is constructed, so a port it would
	// refuse proves the option reached it instead of being quietly discarded.
	assert.throws(() => createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot: resolve('fixture-runtime'),
		helperPath: resolve('fixture-runtime-family-helper.js'),
		platform: 'linux', architecture: 'x64',
		fork: () => { throw new Error('no fork is expected'); },
		powerEtiquette: Object.freeze({
			observe: () => Object.freeze({ onBatteryPower: false, thermalState: 'nominal' as const }),
		}) as never,
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
	}), TypeError);
});
