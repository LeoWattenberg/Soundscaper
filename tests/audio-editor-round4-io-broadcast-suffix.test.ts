/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { isWorkspaceImportFile, WORKSPACE_OPEN_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';

for (const type of ['', 'application/octet-stream']) {
	test(`a normal BWF opens through its maintained decoder when its MIME type is ${type || 'unassigned'}`, async () => {
		const file = new File([Uint8Array.from(encodeWav([Float32Array.of(-0.2, 0, 0.2)], {
			sampleRate: 48_000, bitDepth: 16, bext: { description: 'Location take', timeReference: '0' },
		}))], 'location-take.BWF', { type });
		const calls: string[] = [];
		const unexpected = () => assert.fail('ordinary broadcast audio must reach the media importer');
		await openWorkspaceProjectFile({ ready: Promise.resolve(), actions: { project: {
			openAudacityProject: unexpected, openDawproject: unexpected,
			create: ({ title }: Readonly<{ title: string }>) => { calls.push(`create:${title}`); },
			importFiles: async (files: readonly File[], options: Readonly<{ destination: string }>) => {
				assert.equal(files[0], file);
				assert.equal(options.destination, 'timeline');
				const descriptor = await inspectWavBlobPcm(file);
				assert.equal(descriptor?.frameCount, 3);
				assert.equal(descriptor?.bext?.description, 'Location take');
				calls.push('import');
			},
		} } }, file, unexpected);
		assert.deepEqual(calls, ['create:location-take', 'import']);
	});
}

test('the BWF suffix is offered in the native picker and unrelated binary files remain inadmissible', () => {
	assert.ok(WORKSPACE_OPEN_FILE_ACCEPT.split(',').includes('.bwf'));
	assert.equal(isWorkspaceImportFile({ name: 'location-take.bwf', type: '' }), true);
	assert.equal(isWorkspaceImportFile({ name: 'unknown.bin', type: 'application/octet-stream' }), false);
});
