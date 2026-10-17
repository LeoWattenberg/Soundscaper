/* SPDX-License-Identifier: AGPL-3.0-only */
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
import type { ProjectSchemaFamily } from '../../src/common/editor/project-schema-identity.ts';

export async function createMotionscaperOpaqueArchive(schemaFamily: ProjectSchemaFamily, schemaVersion: number, id = 'opaque-original', assetKind = 'future-unrecognized-asset') {
	const project = { schemaFamily, schemaVersion, id, title: 'Opaque original', sources: { unrecognized: true }, clips: 'not a timeline', tracks: null, unknown: { nested: ['preserve', 3] } };
	const text = JSON.stringify(project); const bytes = new TextEncoder().encode(text);
	const manifest = { format: 'scape-project', formatVersion: 1, project: { entry: 'project.json', schemaFamily, schemaVersion, size: bytes.length, sha256: digestScapeBytes(bytes) },
		assets: [{ entry: 'future.bin', sourceId: 'future', kind: assetKind, encoding: 'future-unrecognized-encoding', size: 3, sha256: '0'.repeat(64) }] };
	const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
	await writer.add('project.json', new TextReader(text)); await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)));
	await writer.add('future.bin', new Blob([new Uint8Array([9, 7, 3])]).stream());
	return writer.close();
}
