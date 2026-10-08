/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop createDownload keeps the sanitized suggested name when the picker is dismissed', async () => {
	const names: unknown[] = [];
	const files = createAudioEditorFileService({ bridge: { chooseSaveTarget(request: { suggestedName: string }) {
		names.push(request.suggestedName); throw new DOMException('Dismissed', 'AbortError');
	} } });
	assert.deepEqual(await files.createDownload({ purpose: 'project', fileName: '  Bad:/name.liscape. ', text: 'abc' }),
		{ cancelled: true, fileName: 'Bad-name.liscape', size: 3 });
	assert.deepEqual(await files.createDownload({ purpose: 'report', text: 'xyz' }),
		{ cancelled: true, fileName: 'soundscaper-export', size: 3 });
	assert.deepEqual(names, ['Bad-name.liscape', 'soundscaper-export']);
});
