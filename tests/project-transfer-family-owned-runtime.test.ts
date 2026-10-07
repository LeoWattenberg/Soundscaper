/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readProjectSchemaIdentity } from '../src/common/editor/project-schema-identity.ts';
import {
	createFamilyOwnedTransferArchiveRuntime,
} from '../src/common/transfer/transfer-family-owned-runtime.ts';

test('archive export dispatches to the project family owner', async () => {
	const calls: string[] = [];
	const runtime = createFamilyOwnedTransferArchiveRuntime({
		probeArchiveIdentity: async () => ({ schemaFamily: 'soundscaper', schemaVersion: 1 }),
		runtimes: {
			soundscaper: fakeRuntime('soundscaper', calls),
			framescaper: fakeRuntime('framescaper', calls),
		},
	});
	await runtime.exportProject({ id: 'audio', schemaFamily: 'soundscaper', schemaVersion: 1 }, {}, {
		maximumBlobBytes: 1024,
	});
	await runtime.exportProject({ id: 'video', schemaFamily: 'framescaper', schemaVersion: 1 }, {}, {
		maximumBlobBytes: 1024,
	});
	assert.deepEqual(calls, ['soundscaper:export', 'framescaper:export']);
});

test('archive inspection and import probe the envelope then use the archive family owner', async () => {
	const calls: string[] = [];
	const runtime = createFamilyOwnedTransferArchiveRuntime({
		probeArchiveIdentity: async (input) => ({
			schemaFamily: input === 'frame-archive' ? 'framescaper' : 'soundscaper',
			schemaVersion: 1,
		}),
		runtimes: {
			soundscaper: fakeRuntime('soundscaper', calls),
			framescaper: fakeRuntime('framescaper', calls),
		},
	});
	await runtime.inspectProject('frame-archive', {}, {});
	await runtime.importProject('sound-archive', {}, { collision: 'cancel' });
	assert.deepEqual(calls, ['framescaper:inspect', 'soundscaper:import']);
});

test('family-owned dispatch refuses future and malformed identities before a product runtime runs', async () => {
	const calls: string[] = [];
	const runtime = createFamilyOwnedTransferArchiveRuntime({
		probeArchiveIdentity: async () => ({ schemaFamily: 'soundscaper', schemaVersion: 2 }),
		runtimes: {
			soundscaper: fakeRuntime('soundscaper', calls),
			framescaper: fakeRuntime('framescaper', calls),
		},
	});
	await assert.rejects(
		Promise.resolve(runtime.inspectProject('future', {}, {})),
		/family-v1/iu,
	);
	assert.deepEqual(calls, []);
});

test('timeline archive dispatch refuses Lightscaper before reading its domain or looking up a runtime', async () => {
	const calls: string[] = [];
	let domainReads = 0;
	let runtimeLookups = 0;
	const project = {
		id: 'photo-catalog', schemaFamily: 'lightscaper', schemaVersion: 1,
		get photos(): never { domainReads++; throw new Error('Photo domain must remain unread.'); },
		get tracks(): never { domainReads++; throw new Error('Timeline domain must remain unread.'); },
	};
	const runtimes = {
		get soundscaper() { runtimeLookups++; return fakeRuntime('soundscaper', calls); },
		get framescaper() { runtimeLookups++; return fakeRuntime('framescaper', calls); },
	};
	Object.defineProperty(runtimes, 'lightscaper', {
		get(): never { runtimeLookups++; throw new Error('Lightscaper runtime must not be looked up.'); },
	});
	const runtime = createFamilyOwnedTransferArchiveRuntime({
		probeArchiveIdentity: (input) => readProjectSchemaIdentity(input), runtimes,
	});
	await assert.rejects(async () => {
		await runtime.exportProject(project, {}, { maximumBlobBytes: 1024 });
	}, /timeline.*lightscaper/iu);
	await assert.rejects(Promise.resolve(runtime.inspectProject(project, {}, {})), /timeline.*lightscaper/iu);
	await assert.rejects(Promise.resolve(runtime.importProject(project, {}, { collision: 'cancel' })), /timeline.*lightscaper/iu);
	assert.equal(domainReads, 0);
	assert.equal(runtimeLookups, 0);
	assert.deepEqual(calls, []);
});

function fakeRuntime(name: string, calls: string[]) {
	return Object.freeze({
		exportProject: async () => {
			calls.push(`${name}:export`);
			return { blob: new Blob([name]) };
		},
		inspectProject: async () => {
			calls.push(`${name}:inspect`);
			return { id: name, schemaFamily: name, schemaVersion: 1 };
		},
		importProject: async () => {
			calls.push(`${name}:import`);
			return { project: { id: name }, readOnly: false };
		},
	});
}
