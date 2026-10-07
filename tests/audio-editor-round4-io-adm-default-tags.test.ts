/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmChna, createRiffAxmlChunk, createRiffChnaChunk } from '../src/common/editor/adm-metadata.ts';
import { createImportedAdmPassthroughMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { compactFields } from '../src/common/editor/ui/inspector/inspector-helpers.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';

const NOW = '2026-10-07T12:00:00.000Z';

test('the ordinary ADM dialog default can preserve existing INFO without inserting a replacement title', async () => {
	const bytes = encodeWav([Float32Array.of(-0.2, 0, 0.2)], {
		container: 'bw64', sampleRate: 48_000, bitDepth: 24, dither: 'none', metadata: { title: 'Original programme' },
		preDataChunks: createRiffChnaChunk(createAdmChna({ layout: 'mono' })),
		trailingChunks: createRiffAxmlChunk({ programmeName: 'Pristine programme', layout: 'mono' }),
	});
	const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
	assert.equal(descriptor.adm?.valid, true);
	const source = createAudioSource({
		id: 'source', storageKey: 'pcm/source', mimeType: 'audio/wav', sampleRate: 48_000,
		frameCount: 3, channelCount: 1, sampleFormat: 'int24',
	});
	const adm = createImportedAdmPassthroughMetadata({ candidate: descriptor.adm, descriptor, source, project: { revision: 0 } });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 3, sourceDurationFrames: 3 });
	const project = createCurrentAudioEditorProject({
		id: 'original', title: 'Untitled project', now: NOW, revision: 1, masterChannels: 1, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', channelCount: 1, clipIds: [clip.id] })], metadata: { adm },
	});
	const settings = createExportDialogInitialSettings(project);
	const plan = createExportPlan(project, {
		format: 'bw64', bitDepth: 24, dither: 'none', metadata: compactFields({ title: settings.metadataTitle }),
	});
	assert.equal(plan.adm?.mode, 'passthrough');
	assert.equal(createExportDialogInitialSettings({ ...project, revision: 2,
		metadata: { ...project.metadata, title: 'Explicit replacement' },
	}).metadataTitle, 'Explicit replacement');
	assert.deepEqual(plan.preDataChunks, createExportPlan(project, { format: 'bw64', bitDepth: 24, dither: 'none' }).preDataChunks);
	assert.throws(() => createExportPlan(project, {
		format: 'bw64', bitDepth: 24, dither: 'none', metadata: { title: 'Explicit replacement' },
	}), /preserved RIFF (?:INFO|ID3).*replacement/u);
});

test('ADM defaults preserve explicit empty and named metadata titles; ordinary projects keep the title fallback', () => {
	for (const title of ['', 'Authored title']) {
		assert.equal(createExportDialogInitialSettings({ title: 'Project name', metadata: { title, adm: null } }).metadataTitle, title);
	}
	assert.equal(createExportDialogInitialSettings({ title: 'Project name', metadata: {} }).metadataTitle, 'Project name');
});
