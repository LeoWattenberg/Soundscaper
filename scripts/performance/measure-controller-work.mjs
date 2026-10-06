/* SPDX-License-Identifier: AGPL-3.0-only */
// Operation-count probes with synthetic inputs; no wall-clock UI claims.
import { publishProjectView } from '../../src/common/editor/controller/document/document-snapshot.ts';
import { createAudioEditorEffectPresets, listAudioEditorEffectPresets } from '../../src/common/editor/effect-presets.js';

let leafReads = 0;
const clipCount = 10_000;
const clips = Array.from({ length: clipCount }, (_, index) => ({
	id: `clip-${index}`,
	get timelineStartFrame() { leafReads += 1; return index * 100; },
	sourceDurationFrames: 100,
}));
const project = { id: 'snapshot-probe', clips };
const first = publishProjectView(project);
const firstReads = leafReads;
leafReads = 0;
const second = publishProjectView(project);
const stableReads = leafReads;
leafReads = 0;
const replacement = publishProjectView({ ...project, selection: { startFrame: 0, endFrame: 100 } });
const replacementReads = leafReads;

const presetCount = 1_000;
const state = createAudioEditorEffectPresets({
	presets: Array.from({ length: presetCount }, (_, index) => ({
		id: `preset-${index}`, effectType: 'audacity-amplify', name: `Preset ${index}`,
		params: { gainDb: 3, allowClipping: false },
		createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z',
	})),
});
const a = listAudioEditorEffectPresets(state, 'audacity-amplify');
const b = listAudioEditorEffectPresets(state, 'audacity-amplify');
process.stdout.write(JSON.stringify({
	node: process.version,
	snapshot: { clipCount, firstReads, stableReads, replacementReads,
		stableProjectIdentity: first === second, reusesDetachedUnchangedClipArray: first.clips === replacement.clips },
	presets: { presetCount,
		unchangedSavedPresetCopies: a.filter((preset, index) => preset !== state.presets[index]).length,
		repeatedSavedPresetCopies: b.filter((preset, index) => preset !== a[index]).length,
		stableListIdentity: a === b },
}, null, '\t') + '\n');
