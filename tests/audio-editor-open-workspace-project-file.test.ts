/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { WebFileLoadLimitError } from '../src/common/editor/web-file-limit-failure.ts';
import { deferred } from './helpers/async-test-control.ts';

for (const [name, route] of [
	['test.AUP3', 'audacity'], ['test.aup4', 'audacity'],
	['test.dawproject', 'dawproject'], ['test.sscape', 'scape'],
] as const) {
	test(`opening ${name} waits for the initial project before importing`, async () => {
		const ready = deferred<void>();
		const calls: string[] = [];
		const file = new File(['fixture'], name);
		const open = (kind: string, input: File) => {
			assert.equal(input, file);
			calls.push(kind);
			return 'opened';
		};
		const controller = {
			ready: ready.promise,
			actions: { project: {
				openAudacityProject: (input: File) => open('audacity', input),
				openDawproject: (input: File) => open('dawproject', input),
			} },
		};
		const opening = openWorkspaceProjectFile(controller, file, (input) => open('scape', input));
		await Promise.resolve();
		assert.deepEqual(calls, []);
		ready.resolve();
		assert.equal(await opening, 'opened');
		assert.deepEqual(calls, [route]);
	});
}

test('a startup failure is reported without attempting to import a project', async () => {
	const failure = new Error('Storage initialization failed');
	const unexpected = () => assert.fail('must not import before successful initialization');
	await assert.rejects(openWorkspaceProjectFile({
		ready: Promise.reject(failure),
		actions: { project: { openAudacityProject: unexpected, openDawproject: unexpected } },
	}, new File([], 'test.aup3'), unexpected), failure);
});

test('a project-open quota refusal retains its cause and marks only the load for desktop guidance', async () => {
	const quota = new DOMException('Disk full', 'QuotaExceededError');
	await assert.rejects(openWorkspaceProjectFile({
		ready: Promise.resolve(),
		actions: { project: {
			openAudacityProject: () => { throw quota; },
			openDawproject: () => undefined,
		} },
	}, new File([], 'project.aup4'), () => undefined),
		(error: unknown) => error instanceof WebFileLoadLimitError && error.cause === quota);
});

for (const [name, type] of [['recording.wav', 'audio/wav'], ['movie.mp4', 'video/mp4']] as const) {
	test(`File Open creates a new project before importing ${name} on its timeline`, async () => {
		const created = deferred<void>();
		const calls: string[] = [];
		const file = new File(['media'], name, { type });
		const unexpected = () => assert.fail('media must not reach a project importer');
		const opening = openWorkspaceProjectFile({
			ready: Promise.resolve(),
			actions: { project: {
				openAudacityProject: unexpected,
				openDawproject: unexpected,
				create: (options: { title: string }) => {
					calls.push(`create:${options.title}`);
					return created.promise;
				},
				importFiles: (files: readonly File[], options: { destination: string }) => {
					assert.deepEqual(files, [file]);
					calls.push(`import:${options.destination}`);
				},
			} },
		}, file, unexpected);
		await Promise.resolve();
		assert.deepEqual(calls, [`create:${name.replace(/\.[^.]+$/u, '')}`]);
		created.resolve();
		await opening;
		assert.deepEqual(calls, [`create:${name.replace(/\.[^.]+$/u, '')}`, 'import:timeline']);
	});
}

test('File Open creates a new project before opening labels or CUE sheets', async () => {
	for (const [name, expected] of [['markers.vtt', 'labels'], ['album.cue', 'cue']] as const) {
		const calls: string[] = [];
		const file = new File(['data'], name);
		const unexpected = () => assert.fail('the wrong importer ran');
		await openWorkspaceProjectFile({
			ready: Promise.resolve(),
			actions: {
				project: {
					openAudacityProject: unexpected,
					openDawproject: unexpected,
					create: () => { calls.push('create'); },
					importFiles: unexpected,
				},
				labels: { importFile: (input: File) => { assert.equal(input, file); calls.push('labels'); } },
			},
		}, file, unexpected, undefined, false, (input) => { assert.equal(input, file); calls.push('cue'); });
		assert.deepEqual(calls, ['create', expected]);
	}
});

test('File Open rejects unsupported files without creating a project', async () => {
	const unexpected = () => assert.fail('an unsupported file must not reach any importer');
	await assert.rejects(openWorkspaceProjectFile({
		ready: Promise.resolve(),
		actions: { project: {
			openAudacityProject: unexpected,
			openDawproject: unexpected,
			create: unexpected,
			importFiles: unexpected,
		} },
	}, new File(['archive'], 'unknown.zip'), unexpected), /supported.*file/iu);
});
