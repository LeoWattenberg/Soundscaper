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
import { AUDIO_EDITOR_PROJECT_SCHEMA_VERSION } from './project-schema-version.ts';
import { withScapeProjectInput, type ScapeProjectInput } from './scape-project-input.ts';

const TEXT_ENCODER = new TextEncoder();

export interface ScapeArchiveCopyOptions {
	readonly archiveLimits?: Partial<ScapeArchiveLimits>;
	readonly signal?: AbortSignal;
}

export interface ScapeArchiveCopyResult {
	readonly byteLength: number;
	readonly schemaVersion: number;
}

/**
 * Stream a format-1 archive carrying a future project schema byte-for-byte to
 * the sink. Admission validates only the archive envelope and the digest-bound
 * project document's schema version scalar; the project and asset graph are
 * never traversed, rewritten, or repacked, so the copy is the exact original
 * bytes. Current-schema archives are refused — they save through the normal
 * export path.
 */
export async function copyFutureScapeArchive(
	input: ScapeProjectInput,
	write: (bytes: Uint8Array) => void | PromiseLike<void>,
	options: ScapeArchiveCopyOptions = {},
): Promise<ScapeArchiveCopyResult> {
	if (typeof write !== 'function') throw new TypeError('A Scape archive copy sink is required.');
	const signal = options.signal;
	const schemaVersion = await withScapeProjectInput(input, signal, async (entries) => {
		const { manifest, projectText } = await readScapeArchiveEnvelope(
			entries,
			options.archiveLimits || {},
			signal,
		);
		verifyScapeAssetBytes(TEXT_ENCODER.encode(projectText), manifest.project, 'project document');
		return futureSchemaVersion(manifest.project.schemaVersion, projectText);
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
	return Object.freeze({ byteLength: offset, schemaVersion });
}

function archiveByteSource(input: ScapeProjectInput): ScapeArchiveByteSource {
	if (input instanceof Blob) return createBlobScapeArchiveByteSource(input);
	assertScapeArchiveByteSource(input);
	return input;
}

function futureSchemaVersion(declared: number | undefined, projectText: string): number {
	let document: unknown;
	try {
		document = JSON.parse(projectText);
	} catch {
		throw new Error('The Scape archive project document is not JSON.');
	}
	const schemaVersion = document && typeof document === 'object'
		? (document as Readonly<{ schemaVersion?: unknown }>).schemaVersion
		: undefined;
	if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) <= AUDIO_EDITOR_PROJECT_SCHEMA_VERSION) {
		throw new Error('Only a future-schema Scape archive can be saved as an unchanged copy.');
	}
	if (declared !== undefined && declared !== schemaVersion) {
		throw new Error('The Scape manifest schema version does not match its project document.');
	}
	return schemaVersion as number;
}
