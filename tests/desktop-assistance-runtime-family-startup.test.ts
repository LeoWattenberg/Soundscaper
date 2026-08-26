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

function pendingManifest(familyId: AssistanceRuntimeFamilyId) {
	const definition = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[familyId];
	return {
		schemaVersion: 1,
		familyId,
		runtimeVersion: definition.runtimeVersion,
		source: { url: definition.sourceUrl, revision: definition.sourceRevision },
		executionProvider: 'cpu',
		runtimePrefix: `assistance/${familyId}/${definition.runtimeVersion}`,
		targets: ASSISTANCE_RUNTIME_FAMILY_TARGETS.map((id) => ({
			id, status: 'pending-external',
			blockedBy: 'Awaiting authenticated external payload publication and readback.',
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
		fork: () => { forks += 1; throw new Error('No pending runtime may fork.'); },
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
	runtime.dispose();
	assert.equal(runtime.snapshot('onnxruntime-node').state, 'disposed');
});

test('pending runtime manifests retain their external blocker and cannot become spawn authority', async () => {
	const manifests = Object.freeze({
		'onnxruntime-node': pendingManifest('onnxruntime-node'),
		'whisper-cpp': pendingManifest('whisper-cpp'),
		'llama-cpp': pendingManifest('llama-cpp'),
	});
	const { runtime, forkCount } = startup(manifests);
	for (const familyId of Object.keys(manifests) as AssistanceRuntimeFamilyId[]) {
		const status = await runtime.availability(familyId);
		assert.equal(status.status, 'unavailable');
		if (status.status === 'unavailable') {
			assert.equal(status.reason, 'payload-pending-external');
			assert.match(status.detail, /external payload publication/iu);
		}
	}
	assert.equal(forkCount(), 0);
	runtime.dispose();
});

test('startup refuses foreign manifest keys before exposing operation routing', () => {
	assert.throws(() => startup({ shell: pendingManifest('onnxruntime-node') } as never),
		/manifest.*family|key|inventory/iu);
});
