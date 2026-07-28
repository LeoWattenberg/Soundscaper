import assert from 'node:assert/strict';
import test from 'node:test';

import { partitionWorkspaceFiles } from '../src/common/editor/ui/workspace/workspace-file-routing.js';

test('workspace drops route AUP3 and AUP4 as projects instead of media', () => {
	const aup3 = { name: 'old.AUP3' };
	const aup4 = { name: 'new.aup4' };
	const audio = { name: 'take.wav' };
	const labels = { name: 'markers.vtt' };
	assert.deepEqual(partitionWorkspaceFiles([aup3, audio, aup4, labels]), {
		projects: [aup3, aup4],
		media: [audio],
		labels: [labels],
	});
});
