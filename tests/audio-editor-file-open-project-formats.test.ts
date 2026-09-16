/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from '../src/common/project-file-extensions.ts';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import {
	partitionWorkspaceFiles,
	WORKSPACE_PROJECT_FILE_ACCEPT,
} from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { deferred } from './helpers/async-test-control.ts';

test('the ordinary project picker advertises legacy and current Audacity projects alongside Scape and DAWproject', () => {
	const accepted = new Set(WORKSPACE_PROJECT_FILE_ACCEPT.split(','));
	for (const extension of [...ACCEPTED_PROJECT_FILE_EXTENSIONS, '.aup', '.aup3', '.aup4', '.dawproject']) {
		assert.ok(accepted.has(extension), `File > Open must allow ${extension} files`);
	}
});

test('legacy dropped AUP projects stay grouped with AU and AUF blocks for batch import', () => {
	const media = [
		new File([], 'session.aup'),
		new File([], 'SESSION.AUP'),
		new File([], 'e0000.au'),
		new File([], 'e0001.AUF'),
		new File([], 'session.aup.backup'),
	];
	assert.deepEqual(partitionWorkspaceFiles(media), {
		projects: [],
		media,
		labels: [],
		cues: [],
	});
});

for (const name of ['session.aup', 'SESSION.AUP']) {
	test(`File > Open waits for readiness before requesting companion data for ${name}`, async () => {
		const ready = deferred<void>();
		const file = new File(['project XML'], name);
		const requested: File[] = [];
		const unexpected = () => assert.fail('legacy projects must request their companion data');
		const opening = openWorkspaceProjectFile({
			ready: ready.promise,
			actions: { project: { openAudacityProject: unexpected, openDawproject: unexpected } },
		}, file, unexpected, (input) => {
			requested.push(input);
			return 'choose-companion-directory';
		});
		await Promise.resolve();
		assert.deepEqual(requested, [], 'the data picker must wait for controller initialization');
		ready.resolve();
		assert.equal(await opening, 'choose-companion-directory');
		assert.deepEqual(requested, [file]);
	});
}

for (const [name, route] of [
	['session.AUP3', 'audacity'],
	['session.aup4', 'audacity'],
	['session.DAWPROJECT', 'dawproject'],
	...ACCEPTED_PROJECT_FILE_EXTENSIONS.map((extension) => [`session${extension}`, 'scape'] as const),
] as const) {
	test(`File > Open dispatches ${name} without requesting legacy companion data`, async () => {
		const file = new File(['project'], name);
		const called: string[] = [];
		const open = (kind: string, input: File) => {
			assert.equal(input, file);
			called.push(kind);
			return `opened-${kind}`;
		};
		const result = await openWorkspaceProjectFile({
			ready: Promise.resolve(),
			actions: { project: {
				openAudacityProject: (input: File) => open('audacity', input),
				openDawproject: (input: File) => open('dawproject', input),
			} },
		}, file, (input) => open('scape', input), () => assert.fail('only AUP XML needs companion data'));
		assert.equal(result, `opened-${route}`);
		assert.deepEqual(called, [route]);
	});
}

test('a startup failure prevents the legacy companion picker from opening', async () => {
	const failure = new Error('Storage initialization failed');
	const unexpected = () => assert.fail('must not open a project picker after startup fails');
	await assert.rejects(openWorkspaceProjectFile({
		ready: Promise.reject(failure),
		actions: { project: { openAudacityProject: unexpected, openDawproject: unexpected } },
	}, new File([], 'session.aup'), unexpected, unexpected), failure);
});

test('errors requesting legacy companion data reach the normal open-command error handler', async () => {
	const failure = new Error('Companion directory picker failed');
	const unexpected = () => assert.fail('legacy projects must request their companion data');
	await assert.rejects(openWorkspaceProjectFile({
		ready: Promise.resolve(),
		actions: { project: { openAudacityProject: unexpected, openDawproject: unexpected } },
	}, new File([], 'session.aup'), unexpected, () => { throw failure; }), failure);
});
