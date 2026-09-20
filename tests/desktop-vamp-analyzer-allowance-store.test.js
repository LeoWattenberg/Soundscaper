/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const prefix = './project-library-runtime/desktop/';
		if (specifier.startsWith(prefix)) {
			return nextResolve(`./${specifier.slice(prefix.length).replace(/\.js$/u, '.ts')}`, context);
		}
		return nextResolve(specifier, context);
	},
});

const { createVampAnalyzerAllowanceStore } = await import('../desktop/vamp-analyzer-allowance-store.mjs');
const { DesktopVampAnalyzerRegistry } = await import('../desktop/vamp-analyzer-registry.ts');

const DIGEST = 'd'.repeat(64);

function observation() {
	return {
		kind: 'analyzer-library', format: 'vamp', libraryPath: '/usr/lib/vamp/markers.so',
		libraryBytes: 4096, librarySha256: DIGEST, identity: { dev: 1, ino: 2 },
		platform: 'linux', architecture: 'x64', compatibility: 'compatible', descriptors: [{
			kind: 'analyzer', format: 'vamp', identifier: 'org.example.markers', name: 'Markers',
			description: '', maker: 'Example', copyright: '', pluginVersion: 1, vampApiVersion: 2,
			inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
			preferredStepSize: 512, preferredBlockSize: 1024, parameters: [], programs: [], outputs: [{
				identifier: 'markers', name: 'Markers', description: '', unit: '', binCount: 1,
				binNames: [], extents: null, quantizeStep: null, sampleType: 'variable-sample-rate',
				sampleRate: null, hasDuration: false,
			}],
		}],
	};
}

function memoryFile(initial = null) {
	let contents = initial;
	return {
		fileSystem: {
			readFileSync: () => {
				if (contents === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
				return contents;
			},
			statSync: () => ({ size: contents?.length ?? 0 }),
			writeFile: async (_path, value) => { contents = value; },
		},
		read: () => contents,
	};
}

test('Vamp analyzer allowance decisions persist without exposing them to another installation', async () => {
	const memory = memoryFile();
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const admission = registry.recordLibrary(observation());
	assert.equal(admission.status, 'recorded');
	if (admission.status !== 'recorded') return;
	const installationId = admission.analyzers[0].installationId;
	const store = createVampAnalyzerAllowanceStore({
		filePath: '/state/vamp.json', fileSystem: memory.fileSystem,
		authenticateLibrary: async () => ({ dev: 1, ino: 2 }),
	});
	store.observe(observation(), admission);
	registry.allow(installationId);
	registry.select(installationId);
	await store.capture(registry);
	assert.match(memory.read(), /"allowed":true/u);

	const restored = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const second = createVampAnalyzerAllowanceStore({
		filePath: '/state/vamp.json', fileSystem: memory.fileSystem,
		authenticateLibrary: async (path, expected) => {
			assert.equal(path, '/usr/lib/vamp/markers.so');
			assert.deepEqual(expected, { byteLength: 4096, sha256: DIGEST });
			return { dev: 7, ino: 8 };
		},
	});
	assert.equal(await second.rebind(restored, installationId), true);
	const projection = restored.describe().entries[0];
	assert.equal(projection?.eligible, true);
	assert.equal(projection?.installations[0]?.selected, true);
});

test('Vamp analyzer allowance state refuses malformed data and changed binary bytes', async () => {
	const malformed = memoryFile(JSON.stringify({ schemaVersion: 1, records: [{ surprise: true }] }));
	const errors = [];
	const store = createVampAnalyzerAllowanceStore({
		filePath: '/state/vamp.json', fileSystem: malformed.fileSystem,
		authenticateLibrary: async () => null,
		logError: (...args) => errors.push(args),
	});
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	assert.equal(await store.rebind(registry, 'vi' + '1'.repeat(30)), false);
	assert.equal(errors.length, 1);
});
