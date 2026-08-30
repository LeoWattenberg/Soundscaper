/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createSoundscaperDesktopProjectLibraryHandshake } from '../desktop/soundscaper-project-library-contract.ts';
import {
	SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING,
	SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE,
} from '../desktop/soundscaper-project-library-media-binding.ts';
import { SoundscaperDesktopProjectLibraryTransferService } from '../desktop/soundscaper-project-library-transfer-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('a Soundscaper transfer session validates one project bundle for all of its body chunks', async () => {
	const project = createSoundscaperProject({ id: 'transfer-cache-project', title: 'Transfer cache project' });
	const document = JSON.stringify(project);
	const bytes = new TextEncoder().encode(document);
	const projectSha256 = createHash('sha256').update(bytes).digest('hex');
	const projectRow = {
		id: 'transfercache',
		projectId: project.id,
		name: project.title,
		metadataFile: `transfercache/${String(project.revision)}-${projectSha256}.json`,
		preferredProduct: 'soundscaper',
		updatedAtMs: 0,
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		projectRevision: project.revision,
		byteLength: bytes.byteLength,
		sha256: projectSha256,
	} as const;
	let bundleReads = 0;
	const service = SoundscaperDesktopProjectLibraryTransferService.create({
		host: {
			async readProjectBundle() {
				bundleReads += 1;
				return {
					metadata: { schemaVersion: 1, revision: 1, projects: [projectRow], media: [] },
					document,
					bodies: [],
				};
			},
			async readBodyChunk() {
				throw new Error('A missing body must not reach the data plane');
			},
		},
	});
	const session = service.openSession(createSoundscaperDesktopProjectLibraryHandshake());
	const bundle = await session.readProjectBundle(project.id);
	assert.ok(bundle);
	const request = {
		projectId: project.id,
		metadataRevision: bundle.metadataRevision,
		projectRevision: bundle.project.projectRevision,
		projectSha256: bundle.project.sha256,
		body: {
			kind: 'audio-freeze',
			encoding: SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING,
			bindingId: `f${'a'.repeat(64)}`,
			sourceId: 'missing-source',
			storageKey: 'missing-storage',
			mimeType: SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE,
			byteLength: 4,
			sha256: 'b'.repeat(64),
		},
		offset: 0,
		length: 4,
	};

	await assert.rejects(session.readBodyChunk(request), /body descriptor changed/iu);
	await assert.rejects(session.readBodyChunk(request), /body descriptor changed/iu);
	assert.equal(bundleReads, 1);
});
