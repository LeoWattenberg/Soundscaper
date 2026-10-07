/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroScriptHost } from '../src/common/editor/controller/effects/internal/macro/macro-script-host.ts';

for (const explicitTracks of [false, true]) {
	test(`macro frame endpoints retain the spectral axis with ${explicitTracks ? 'explicit' : 'retained'} tracks`, async () => {
		const frequencyRange = { minimumFrequency: 100, maximumFrequency: 1000 };
		const project = {
			id: 'voice', sampleRate: 48_000, clips: [],
			tracks: [{ id: 'voice', type: 'audio', clipIds: [] }],
			selection: { startFrame: 0, endFrame: 38_400, trackIds: ['voice'], frequencyRange },
		};
		const original = structuredClone(project);
		let written: readonly unknown[] = [];
		const host = createMacroScriptHost({
			getProject: () => project, projectSampleRate: () => project.sampleRate,
			runEffectMacro: async () => {}, runMacroCommand: () => {}, listSavedMacros: () => [],
			setExactSelection: (start, end, details) => { written = [start, end, details]; },
			beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback() {} }),
		});
		await host.createDispatch()('select.frames', [4800, 33_600, explicitTracks ? { trackIds: ['voice'] } : null]);
		assert.deepEqual(written, [4800, 33_600, { trackIds: ['voice'], frequencyRange }]);
		assert.deepEqual(project, original, 'the frame verb delegates one selection write without mutating its captured input');
	});
}
