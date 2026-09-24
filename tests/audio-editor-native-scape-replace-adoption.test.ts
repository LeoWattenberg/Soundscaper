/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture, nativeFile, project } from './helpers/native-project-service-fixture.ts';

test('native Scape replace flushes before publication and adopts the committed same-ID document', async () => {
	const events: string[] = [];
	const replacement = { ...project('project-a'), title: 'Imported document' };
	const acquireReplaceProjectWriteAuthority = async () => ({
		writeFence: 'controller-token', assertCurrent() {}, release() {},
	});
	const fixture = createFixture({
		acquireReplaceProjectWriteAuthority,
		flushProject: async () => { events.push('flush'); },
		importScapeProject: async (_file, _store, options) => {
			events.push('import');
			assert.equal(options.collision, 'replace');
			assert.equal(options.acquireReplaceProjectWriteAuthority, acquireReplaceProjectWriteAuthority);
			return { project: replacement, readOnly: false, manifest: {}, collision: 'replace' };
		},
		switchProject: async (value, options) => {
			events.push('activate');
			assert.equal(value, replacement);
			assert.equal(options.skipFlush, true);
			assert.equal(options.adoptSessionRevision, true);
			assert.equal(options.replaceSessionHistory, true);
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	await service.openScape(nativeFile('replacement.scape'), { collision: 'replace' });
	assert.deepEqual(events, ['flush', 'import', 'activate']);
});
