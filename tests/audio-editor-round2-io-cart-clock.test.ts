/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { prepareImportedWavMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { freezeProjectImportOptions, normalizeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

test('CART post timers retain their physical time across import and output sample clocks', async () => {
	for (const sourceRate of [32_000, 44_100, 48_000]) {
		const sourceCart = { title: 'Radio continuity take', postTimers: [{ usage: 'SEC1', value: sourceRate / 2 }] };
		const bytes = encodeWav([new Float32Array(sourceRate)], { sampleRate: sourceRate, cart: sourceCart });
		const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
		assert.ok(descriptor);
		const project = createCurrentAudioEditorProject({ id: 'broadcast-session', sampleRate: 48_000 });
		const promoted = prepareImportedWavMetadata({
			descriptor, importOptions: normalizeProjectImportOptions({ destination: 'timeline' }, 'Frames must be finite.'),
			project, projectSampleRate: project.sampleRate, copy: {}, freezeImportOptions: freezeProjectImportOptions,
		});
		assert.equal((promoted.projectCart as { postTimers: readonly { value: number }[] }).postTimers[0]?.value, 24_000);
		assert.deepEqual(promoted.sourceCart, descriptor.cart, 'the imported source keeps its original source-clock metadata');
		const deliveredProject = createCurrentAudioEditorProject({
			id: 'broadcast-session', sampleRate: 48_000, metadata: { cart: promoted.projectCart },
		});
		const plan = createExportPlan(deliveredProject, { format: 'bwf', sampleRate: 96_000, range: { startFrame: 0, endFrame: 48_000 } });
		assert.equal(plan.cart?.postTimers[0]?.value, 48_000);
		assert.equal(deliveredProject.metadata.cart?.postTimers[0]?.value, 24_000);
	}
});
