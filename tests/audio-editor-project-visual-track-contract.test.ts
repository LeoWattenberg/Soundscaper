/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectVisualService, type ProjectVisualProject } from '../src/common/editor/controller/document/project-visual-service.ts';
import type { AudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const canonicalProjectFitsVisuals: (project: AudioEditorProjectV17) => ProjectVisualProject = project => project;
void canonicalProjectFitsVisuals;

test('visual lookup skips label tracks before the clip-owning track', () => {
	const project = {
		id: 'project', schemaVersion: 17,
		sources: [{ id: 'source', kind: 'audio' }],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio' }],
		tracks: [
			{ id: 'labels', type: 'label' },
			{ id: 'audio', type: 'audio', clipIds: ['clip'] },
		],
	};
	const service = createProjectVisualService({
		getProject: () => project,
		captureProject: id => id, assertProject() {},
		missingSourceIds: new Set(), sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1,
		url: { createObjectURL: () => null, revokeObjectURL() {} },
	});
	assert.equal(service.getClipVisualData('clip')?.track?.id, 'audio');
	assert.equal(service.getClipVisualData('missing'), null);
});
