/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';

test('source effect controls read the selected media clock and release it with the source selection', () => {
	let project: EffectSelectionProject = {
		id: 'recording', schemaVersion: 1, sampleRate: 48_000,
		sources: [{ id: 'telephone', frameCount: 11_025, channelCount: 1, sampleRate: 11_025 }],
		tracks: [{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['phrase'] }],
		clips: [{ id: 'phrase', kind: 'audio', sourceId: 'telephone', sourceStartFrame: 0,
			sourceDurationFrames: 11_025, durationFrames: 48_000, timelineStartFrame: 0 }],
	};
	const service = createSourceEditorEffects({
		getProject: () => project,
		loadSourceBuffer: async () => null,
		publishDocumentSnapshot: () => undefined,
	});
	assert.equal(service.readSourceSelectionSampleRate(), null);
	service.setSourceSelection({ clipId: 'phrase', startFrame: 0, endFrame: 11_025 });
	assert.equal(service.readSourceSelectionSampleRate(), 11_025);
	service.setSourceSelection(null);
	assert.equal(service.readSourceSelectionSampleRate(), null);
	service.setSourceSelection({ clipId: 'phrase', startFrame: 0, endFrame: 11_025 });
	project = { ...project, id: 'other-project' };
	assert.equal(service.readSourceSelectionSampleRate(), null, 'a previous project cannot supply a source clock');
});
