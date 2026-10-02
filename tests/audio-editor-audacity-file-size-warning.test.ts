/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { Aup4PortableOptions, NativeAup4Client } from '../src/common/editor/controller/document/native-project-types.ts';
import { portableLimit } from '../src/common/editor/aup4-worker-values.js';
import { withAudacityWorkerSizeAdmission } from '../src/common/editor/controller/document/internal/native-project/audacity-worker-size-admission.ts';
import { createFixture, nativeFile, project } from './helpers/native-project-service-fixture.ts';

const threshold = 64 * 1024 * 1024;
const oversized = threshold + 1;

function audacityFixture(accept: boolean) {
	const warnings: number[] = [];
	const opened: Aup4PortableOptions[] = [];
	const written: Aup4PortableOptions[] = [];
	let creates = 0;
	const document = { ...project(), sources: [{ id: 'source', name: 'Source', mimeType: 'audio/wav',
		frameCount: 1, channelCount: 1, sampleRate: 48_000 }], clips: [{ id: 'clip', sourceId: 'source' }] };
	const fixture = createFixture({ getProject: () => document, sourcePcmBytes: () => oversized,
		confirmFileSizeWarning: async (warning) => { warnings.push(warning.byteLength); return accept; } });
	const base = fixture.runtime.createAup4Client({});
	const client: NativeAup4Client = { ...base,
		create: async () => { creates += 1; },
		openFile: async (_id, _file, options) => { opened.push(options); return { readOnly: false }; },
		writeSnapshot: async (_id, _project, _sources, options) => { written.push(options); return {}; },
	};
	return { ...fixture, service: createNativeProjectService({ ...fixture.runtime, initialAup4Client: client }),
		warnings, opened, written, creates: () => creates };
}

function oversizedFile() {
	const file = nativeFile('large.aup4');
	Object.defineProperty(file, 'size', { value: oversized });
	return file;
}

test('declining an Audacity file-size warning stops before opening its native database', async () => {
	const fixture = audacityFixture(false);
	await assert.rejects(fixture.service.openAudacityProject(oversizedFile()), { name: 'AbortError' });
	assert.deepEqual(fixture.warnings, [oversized]);
	assert.equal(fixture.opened.length, 0);
	assert.equal(fixture.switched.length, 0);
	assert.equal(fixture.state.importing, false);
});

test('accepting an Audacity import passes its operation-specific bound to the worker', async () => {
	const fixture = audacityFixture(true);
	await fixture.service.openAudacityProject(oversizedFile());
	assert.deepEqual(fixture.warnings, [oversized]);
	assert.equal(fixture.opened[0]?.maxBytes, oversized);
	assert.equal(fixture.opened[0]?.fileSizeWarningApproved, true);
});

test('declining a large Audacity save stops before creating or writing a native database', async () => {
	const fixture = audacityFixture(false);
	await assert.rejects(fixture.service.saveAup4({ useFileSystemAccess: false }), { name: 'AbortError' });
	assert.equal(fixture.warnings.length, 1);
	assert.equal(fixture.creates(), 0);
	assert.equal(fixture.written.length, 0);
});

test('accepting a large Audacity save admits its estimated snapshot bytes', async () => {
	const fixture = audacityFixture(true);
	await fixture.service.saveAup3({ useFileSystemAccess: false });
	assert.equal(fixture.warnings.length, 1);
	assert.equal(fixture.creates(), 1);
	assert.equal(fixture.written[0]?.maxBytes, fixture.warnings[0]);
	assert.equal(fixture.written[0]?.fileSizeWarningApproved, true);
});

test('worker size overrides require explicit approval and preserve actual storage availability', () => {
	assert.equal(portableLimit({ maxBytes: oversized }, false), threshold);
	assert.equal(portableLimit({ maxBytes: oversized, fileSizeWarningApproved: true }, false), oversized);
	assert.equal(portableLimit({ maxBytes: oversized, fileSizeWarningApproved: true, quota: 100, usage: 25 }, false), 75);
	assert.equal(portableLimit({ maxBytes: Infinity, fileSizeWarningApproved: true }, false), threshold);
});

test('Audacity retry admission is limited to size preflight and read-only export', async () => {
	const options: Aup4PortableOptions = { mobile: false, workingBytes: 0, onProgress: () => undefined };
	const failure = Object.assign(new Error('size policy'), { code: 'PROJECT_TOO_LARGE',
		details: { size: oversized, limit: threshold, phase: 'preflight' } });
	let attempts = 0, prompts = 0;
	const confirmation = { confirmFileSizeWarning: async () => { prompts += 1; return true; } };
	assert.equal(await withAudacityWorkerSizeAdmission(async (admitted) => {
		attempts += 1;
		if (!admitted.fileSizeWarningApproved) throw failure;
		assert.equal(admitted.maxBytes, oversized); return 'saved';
	}, options, 'Audacity project', confirmation, 'preflight'), 'saved');
	assert.equal(attempts, 2);
	assert.equal(prompts, 1);
	const destructiveFailure = Object.assign(new Error('post-write failure'), { code: 'PROJECT_TOO_LARGE',
		details: { size: oversized, limit: threshold, phase: 'writing' } });
	await assert.rejects(withAudacityWorkerSizeAdmission(async () => { throw destructiveFailure; }, options,
		'Audacity project', confirmation, 'preflight'), (error: unknown) => error === destructiveFailure);
	assert.equal(prompts, 1);
	await assert.rejects(withAudacityWorkerSizeAdmission(async () => { throw failure; }, { ...options, quota: 100, usage: 0 },
		'Audacity project', confirmation, 'export'), (error: unknown) => error === failure);
	assert.equal(prompts, 1);
});

test('late Audacity size-warning approval cannot open over a newer project', async () => {
	let approve!: (value: boolean) => void;
	const pending = new Promise<boolean>((resolve) => { approve = resolve; });
	let opens = 0;
	const fixture = createFixture({ confirmFileSizeWarning: () => pending });
	const base = fixture.runtime.createAup4Client({});
	const service = createNativeProjectService({ ...fixture.runtime, initialAup4Client: { ...base,
		openFile: async () => { opens += 1; return { readOnly: false }; } } });
	const opening = service.openAudacityProject(oversizedFile());
	await new Promise<void>((resolve) => setImmediate(resolve));
	fixture.replaceProject('new-project'); approve(true);
	await assert.rejects(opening, { name: 'AbortError' });
	assert.equal(opens, 0);
	assert.equal(fixture.switched.length, 0);
});
