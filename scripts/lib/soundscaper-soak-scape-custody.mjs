/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	BlobReader,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';
import { FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectAssistance } from '../../src/framescaper/editor-project-assistance.ts';

/** Turn a real Soundscaper export into a foreign-family archive with valid bindings. */
export async function createForeignScapeCustodyFixture(sourceBytes, variant) {
	if (!(sourceBytes instanceof Uint8Array) || sourceBytes.byteLength < 1) {
		throw new TypeError('Foreign-project custody requires exported Scape bytes.');
	}
	const reader = new ZipReader(new BlobReader(new Blob([sourceBytes])), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const payloads = new Map();
	try {
		for (const entry of entries) {
			if (entry.directory || payloads.has(entry.filename)) {
				throw new Error('The custody fixture requires a closed flat Scape archive.');
			}
			payloads.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
		}
	} finally {
		await reader.close();
	}
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const projectBytes = payloads.get('project.json');
	const manifestBytes = payloads.get('manifest.json');
	if (!projectBytes || !manifestBytes) throw new Error('The Scape archive omitted bound project metadata.');
	const sourceProject = JSON.parse(decoder.decode(projectBytes));
	const manifest = JSON.parse(decoder.decode(manifestBytes));
	const projectId = `soak-foreign-${String(variant >>> 0)}`;
	const project = createFramescaperProjectAssistance(
		FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE,
		{ ...sourceProject, id: projectId, title: `Foreign custody ${String(variant >>> 0)}` },
	);
	const foreignProjectBytes = encoder.encode(JSON.stringify(project));
	manifest.project.schemaFamily = 'framescaper';
	manifest.project.schemaVersion = project.schemaVersion;
	manifest.project.size = foreignProjectBytes.byteLength;
	manifest.project.sha256 = createHash('sha256').update(foreignProjectBytes).digest('hex');
	payloads.set('project.json', foreignProjectBytes);
	payloads.set('manifest.json', encoder.encode(JSON.stringify(manifest)));

	const writer = new ZipWriter(new Uint8ArrayWriter(), {
		level: 0, useWebWorkers: false, zip64: true,
	});
	for (const entry of entries) {
		await writer.add(entry.filename, new Uint8ArrayReader(payloads.get(entry.filename)), {
			level: 0, zip64: true, lastModDate: new Date('2026-08-31T00:00:00.000Z'),
		});
	}
	return Object.freeze({
		projectId,
		archive: Buffer.from(await writer.close(undefined, { zip64: true })),
	});
}
