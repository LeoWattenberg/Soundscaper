/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfScapeAborted } from './scape-abort.ts';
import {
	assertScapeArchiveByteSource,
	createBlobScapeArchiveByteSource,
	type ScapeArchiveByteSource,
} from './scape-archive-byte-source.ts';
import {
	readScapeArchiveEnvelope,
	type ScapeArchiveLimits,
} from './scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from './scape-archive-media.ts';
import {
	classifyProjectSchemaIdentity,
	type ProjectSchemaFamily,
	type ProjectSchemaIdentity,
} from './project-schema-identity.ts';
import { parseOpaqueScapeProjectDocument } from './scape-project-document.ts';
import { withScapeProjectInput, type ScapeProjectInput } from './scape-project-input.ts';

const TEXT_ENCODER = new TextEncoder();

export interface ScapeArchiveCopyOptions {
	readonly archiveLimits?: Partial<ScapeArchiveLimits>;
	readonly currentProjectSchemaFamily: ProjectSchemaFamily;
	readonly signal?: AbortSignal;
}

export interface ScapeArchiveCopyResult {
	readonly byteLength: number;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: number;
}

/**
 * Stream a format-1 archive carrying a foreign-family or future project byte-for-byte to
 * the sink. Admission validates only the archive envelope and the digest-bound
 * project document's schema version scalar; the project and asset graph are
 * never traversed, rewritten, or repacked, so the copy is the exact original
 * bytes. Current-schema archives are refused — they save through the normal
 * export path.
 */
export async function copyFutureScapeArchive(
	input: ScapeProjectInput,
	write: (bytes: Uint8Array) => void | PromiseLike<void>,
	options: ScapeArchiveCopyOptions,
): Promise<ScapeArchiveCopyResult> {
	if (typeof write !== 'function') throw new TypeError('A Scape archive copy sink is required.');
	if (!options || typeof options !== 'object') {
		throw new TypeError('Scape archive copy options are required.');
	}
	const signal = options.signal;
	const identity = await withScapeProjectInput(input, signal, async (entries) => {
		const { manifest, projectText } = await readScapeArchiveEnvelope(
			entries,
			options.archiveLimits || {},
			signal,
		);
		verifyScapeAssetBytes(TEXT_ENCODER.encode(projectText), manifest.project, 'project document');
		return opaqueProjectIdentity(manifest.project, projectText, options.currentProjectSchemaFamily);
	});
	throwIfScapeAborted(signal);
	const source = archiveByteSource(input);
	let offset = 0;
	while (offset < source.size) {
		throwIfScapeAborted(signal);
		const chunk = await source.read({
			offset,
			length: Math.min(source.maximumReadBytes, source.size - offset),
			...(signal ? { signal } : {}),
		});
		await write(chunk);
		offset += chunk.byteLength;
	}
	throwIfScapeAborted(signal);
	return Object.freeze({
		byteLength: offset,
		schemaFamily: identity.schemaFamily,
		schemaVersion: identity.schemaVersion,
	});
}

function archiveByteSource(input: ScapeProjectInput): ScapeArchiveByteSource {
	if (input instanceof Blob) return createBlobScapeArchiveByteSource(input);
	assertScapeArchiveByteSource(input);
	return input;
}

function opaqueProjectIdentity(
	declared: ProjectSchemaIdentity,
	projectText: string,
	currentFamily: ProjectSchemaFamily,
): Readonly<ProjectSchemaIdentity> {
	const document = parseOpaqueScapeProjectDocument(projectText, {
		currentProjectSchemaFamily: currentFamily,
	});
	const classification = classifyProjectSchemaIdentity(document, currentFamily);
	if (declared.schemaFamily !== classification.identity.schemaFamily
		|| declared.schemaVersion !== classification.identity.schemaVersion) {
		throw new Error('The Scape manifest project identity does not match its project document.');
	}
	if (classification.disposition === 'current') {
		throw new Error('Only an opaque foreign-family or future-schema Scape archive can be saved as an unchanged copy.');
	}
	return classification.identity;
}
