/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';

/** Rewrite the archive's project document (and its manifest digest binding) in place. */
export async function rewriteScapeProjectDocument(blob, mutate) {
	const contents = await readArchiveContents(blob);
	const projectContent = contents.find(({ filename }) => filename === 'project.json');
	const manifestContent = contents.find(({ filename }) => filename === 'manifest.json');
	if (!projectContent || !manifestContent) throw new Error('The archive is missing project metadata.');
	const document = JSON.parse(projectContent.value);
	mutate(document);
	projectContent.value = JSON.stringify(document);
	const projectBytes = new TextEncoder().encode(projectContent.value);
	const manifest = JSON.parse(manifestContent.value);
	manifest.project.size = projectBytes.byteLength;
	manifest.project.sha256 = digestScapeBytes(projectBytes);
	manifest.project.schemaVersion = document.schemaVersion;
	manifestContent.value = JSON.stringify(manifest);
	return writeArchiveContents(contents);
}

/** Rewrite only the archive manifest, leaving every other entry byte-identical. */
export async function rewriteScapeManifest(blob, mutate) {
	const contents = await readArchiveContents(blob);
	const manifestContent = contents.find(({ filename }) => filename === 'manifest.json');
	if (!manifestContent) throw new Error('The archive is missing its manifest.');
	const manifest = JSON.parse(manifestContent.value);
	mutate(manifest);
	manifestContent.value = JSON.stringify(manifest);
	return writeArchiveContents(contents);
}

async function readArchiveContents(blob) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const contents = [];
	for (const entry of entries) {
		contents.push({
			filename: entry.filename,
			value: entry.filename === 'project.json' || entry.filename === 'manifest.json'
				? await entry.getData(new TextWriter())
				: await entry.getData(new BlobWriter()),
		});
	}
	await reader.close();
	return contents;
}

async function writeArchiveContents(contents) {
	const output = new BlobWriter('application/vnd.soundscaper.scape+zip');
	const writer = new ZipWriter(output, { zip64: true, useWebWorkers: false, level: 0 });
	for (const content of contents) {
		await writer.add(
			content.filename,
			typeof content.value === 'string' ? new TextReader(content.value) : content.value.stream(),
			{ zip64: true, level: 0 },
		);
	}
	return writer.close(undefined, { zip64: true });
}
