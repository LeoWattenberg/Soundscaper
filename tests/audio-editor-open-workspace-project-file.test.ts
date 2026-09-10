/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
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
