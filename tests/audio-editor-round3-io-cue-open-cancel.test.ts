/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';

function controller(calls: string[]) {
	return { ready: Promise.resolve(), actions: { project: {
		openAudacityProject: () => assert.fail('CUE is not an Audacity project'),
		openDawproject: () => assert.fail('CUE is not a DAWproject'),
		create: (options: Readonly<{ title: string }>) => { calls.push(`create:${options.title}`); },
	} } };
}

test('canceling the CUE destination does not create or activate another project', async () => {
	const calls: string[] = [];
	const file = new File(['FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n'], 'album.cue');
	const result = await openWorkspaceProjectFile(controller(calls), file,
		() => assert.fail('CUE is not a Scape archive'), undefined, false,
		(input) => { assert.equal(input, file); calls.push('cancel'); return null; });
	assert.equal(result, null);
	assert.deepEqual(calls, ['cancel']);
});

test('an accepted CUE open creates its named project before importing its annotations', async () => {
	const calls: string[] = [];
	const file = new File(['FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n'], 'album.cue');
	await openWorkspaceProjectFile(controller(calls), file,
		() => assert.fail('CUE is not a Scape archive'), undefined, false,
		async (input, prepare) => {
			assert.equal(input, file);
			assert.equal(calls.length, 0, 'the destination choice precedes project creation');
			await prepare();
			calls.push('import:markers');
		});
	assert.deepEqual(calls, ['create:album', 'import:markers']);
});
