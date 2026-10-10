/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { createDesktopOriginalImportRecorder, desktopOriginalForProject, resetDesktopOriginal } from '../src/common/editor/desktop-overwrite-original.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { normalizeIxmlMetadata } from '../src/common/editor/ixml.ts';

const source = { id: 'source', kind: 'audio', originalSampleRate: 48_000, sampleRate: 48_000,
	channelCount: 1, frameCount: 2400 };

async function importOriginal(file: File) {
	const state = {};
	let project: { id: string; sources: readonly object[]; clips: readonly object[] } = { id: 'project', sources: [], clips: [] };
	registerDesktopOriginalFile(file, { id: 'c'.repeat(48), name: file.name });
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = { ...project, sources: [source], clips: [{ id: 'clip' }] };
	})(file);
	const original = desktopOriginalForProject(state, project.id);
	resetDesktopOriginal(state);
	return original;
}

test('File Import then Overwrite retains Broadcast WAVE metadata in an ordinary .wav original', async () => {
	const bytes = encodeWav([new Float32Array(2400)], { sampleRate: 48_000, bitDepth: 24,
		bext: { description: 'Location dialogue', timeReference: '172800000' } });
	const original = await importOriginal(new File([new Uint8Array(bytes).buffer], 'Dialogue.wav'));
	assert.equal(original?.settings.format, 'bwf');
	const project = createCurrentAudioEditorProject({ id: 'project', title: 'Dialogue', sampleRate: 48_000,
		metadata: { bext: { description: 'Location dialogue', timeReference: '172800000' } } });
	const plan = createExportPlan(project, { ...original?.settings, range: { startFrame: 0, endFrame: 2400 } });
	assert.equal(plan.bext?.description, 'Location dialogue');
	assert.equal(plan.bext?.timeReference, '172800000');
});

test('an ordinary floating-point WAV with iXML retains its supported WAV delivery', async () => {
	const bytes = encodeWav([new Float32Array(2400)], { sampleRate: 48_000, bitDepth: 32, float: true,
		ixml: normalizeIxmlMetadata({ project: 'Location interview' }) });
	const original = await importOriginal(new File([new Uint8Array(bytes).buffer], 'Float.wav'));
	assert.equal(original?.settings.format, 'wav');
	assert.equal(original?.settings.sampleFormat, 'float32');
});
