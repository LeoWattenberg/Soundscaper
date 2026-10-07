/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmChna, createRiffAxmlChunk, createRiffChnaChunk } from '../src/common/editor/adm-metadata.ts';
import { createImportedAdmPassthroughMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';
import {
	duplicateProjectWithLinkedOriginals, duplicateProjectWithLinkedVideoOriginals,
	type ProjectDuplicationPort,
} from '../src/common/editor/storage/project-duplication.ts';
import type { ProjectDocument } from '../src/common/editor/storage/project-repository.ts';

const NOW = '2026-10-07T12:00:00.000Z';

for (const duplicate of [duplicateProjectWithLinkedOriginals, duplicateProjectWithLinkedVideoOriginals]) {
	test(`${duplicate.name} retains a pristine imported ADM delivery after copying`, async () => {
		const source = await importedProject();
		const original = createExportPlan(source, { format: 'bw64', bitDepth: 24, dither: 'none' });
		const copy = await duplicate(portFor(source), { sourceProjectId: source.id, copyProjectId: 'copy', timestamp: NOW });
		const delivered = createExportPlan(copy, { format: 'bw64', bitDepth: 24, dither: 'none' });
		assert.equal(copy.revision, 0);
		assert.equal(delivered.adm?.mode, 'passthrough');
		assert.deepEqual(delivered.preDataChunks, original.preDataChunks);
		assert.deepEqual(delivered.trailingChunks, original.trailingChunks);
		assert.strictEqual(copy.sources, source.sources);
		assert.strictEqual(copy.clips, source.clips);
		assert.equal(source.metadata.adm?.mode === 'passthrough' && source.metadata.adm.pristineRevision, 1);
	});

	test(`${duplicate.name} cannot revive previously edited ADM when the copy is edited again`, async () => {
		const pristine = await importedProject();
		const source = { ...pristine, revision: 2, title: 'Edited title' };
		const copy = await duplicate(portFor(source), { sourceProjectId: source.id, copyProjectId: 'copy', timestamp: NOW });
		assert.strictEqual(copy.metadata, source.metadata);
		assert.throws(() => createExportPlan(copy, { format: 'bw64', bitDepth: 24, dither: 'none' }), /project-revision-changed/u);
		assert.throws(() => createExportPlan({ ...copy, revision: Number(copy.revision) + 1 }, {
			format: 'bw64', bitDepth: 24, dither: 'none',
		}), /project-revision-changed/u);
	});
}

function portFor(project: ProjectDocument): ProjectDuplicationPort {
	return {
		aliases: null, loadProject: () => project, listProjects: () => [project], createProjectIfAbsent: copy => copy,
	};
}

async function importedProject() {
	const bytes = encodeWav([Float32Array.of(-0.2, 0, 0.2)], {
		container: 'bw64', sampleRate: 48_000, bitDepth: 24, dither: 'none',
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
	return createCurrentAudioEditorProject({
		id: 'original', now: NOW, revision: 1, masterChannels: 1, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', channelCount: 1, clipIds: [clip.id] })], metadata: { adm },
	});
}
