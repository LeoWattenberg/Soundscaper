/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { prepareImportedWavMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { createCurrentAudioEditorProject, validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { freezeProjectImportOptions, normalizeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';

test('ordinary CART and iXML import promotion is admitted and preserves structured namespaces', async () => {
	const project = createCurrentAudioEditorProject({ id: 'broadcast-session', sampleRate: 48_000 });
	const bytes = encodeWav([new Float32Array(48_000)], {
		sampleRate: 48_000, bext: { description: 'Radio continuity take' },
		cart: { title: 'Radio continuity take', postTimers: [{ usage: 'SEC1', value: 24_000 }] },
		ixml: { project: 'Radio series', scene: 'Studio A', take: '12', note: 'Keep the complete take.' },
	});
	const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
	assert.ok(descriptor);
	const promoted = prepareImportedWavMetadata({
		descriptor, importOptions: normalizeProjectImportOptions({ destination: 'timeline' }, 'Timeline frames must be finite.'),
		project, projectSampleRate: project.sampleRate, copy: {}, freezeImportOptions: freezeProjectImportOptions,
	});
	const edited = applyEditorCommand(project, { type: 'metadata/update', changes: {
		bext: promoted.projectBext, cart: promoted.projectCart, ixml: promoted.projectIxml,
	} });
	assert.deepEqual(edited.metadata.cart, descriptor.cart);
	assert.deepEqual(edited.metadata.ixml, descriptor.ixml);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.equal(project.metadata.cart, undefined, 'import metadata promotion remains an immutable transaction');
});
