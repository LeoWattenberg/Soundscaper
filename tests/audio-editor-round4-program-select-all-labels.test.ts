/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroScriptHost } from '../src/common/editor/controller/effects/internal/macro/macro-script-host.ts';

for (const hasAudio of [true, false]) {
	test(`macro Select all includes later labels in ${hasAudio ? 'mixed' : 'label-only'} content`, async () => {
		const project = {
			id: 'session', sampleRate: 48_000,
			tracks: [
				{ id: 'voice', type: 'audio', clipIds: hasAudio ? ['recording'] : [] },
				{ id: 'cues', type: 'label', clipIds: [], labels: [{ id: 'outro', startFrame: 96_000, endFrame: 144_000 }] },
			],
			clips: hasAudio ? [{ id: 'recording', kind: 'audio', timelineStartFrame: 0, durationFrames: 38_400 }] : [],
			selection: { startFrame: 0, endFrame: 0, trackIds: [] as readonly string[] },
		};
		const selectionWrites: Array<readonly [number, number]> = [];
		const host = createMacroScriptHost({
			getProject: () => project, projectSampleRate: () => project.sampleRate,
			runEffectMacro: async () => {}, runMacroCommand: () => {}, listSavedMacros: () => [],
			setExactSelection: (startFrame, endFrame, details) => {
				selectionWrites.push([startFrame, endFrame]);
				project.selection = { startFrame, endFrame, trackIds: details?.trackIds as readonly string[] };
			},
			beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback() {} }),
		});
		assert.deepEqual(await host.createDispatch()('select.all', []),
			{ startFrame: 0, endFrame: 144_000, trackIds: ['voice', 'cues'] });
		assert.deepEqual(selectionWrites, [[0, 144_000]], 'the complete range is selected in one write');
	});
}
