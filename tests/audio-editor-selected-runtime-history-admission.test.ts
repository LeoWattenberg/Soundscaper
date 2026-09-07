/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

for (const [name, runtime] of [
	['Framescaper', createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE)],
	['Soundscaper', createSoundscaperProjectRuntimeSelection()],
] as const) {
	test(`${name} rejects accessor history before invoking its present getter`, () => {
		let reads = 0;
		const history = Object.defineProperty({}, 'present', {
			enumerable: true,
			get() { reads += 1; throw new Error('Getter must not execute'); },
		});
		assert.throws(() => runtime.executeCommand(history, { type: 'project/rename', title: 'Rejected' }), /history must contain an own present data property/);
		assert.equal(reads, 0);
	});
}
