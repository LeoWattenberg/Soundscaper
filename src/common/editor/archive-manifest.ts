/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from './scape-archive-media.ts';

/**
 * Checksum manifests for project archives.
 *
 * An archive is only an archive if you can prove later that it still says what
 * it said. That means the manifest has to be strict about three things:
 *
 * - **It names every member.** Verification reports each mismatch with the
 *   member it belongs to. "The archive is corrupt" is not actionable; "member
 *   media/cam-a.mp4 has the wrong digest" is.
 * - **It does not stop at the first failure.** A partially damaged archive
 *   usually has more than one damaged member, and a caller deciding whether to
 *   re-archive or re-link needs the whole picture.
 * - **It checks size as well as digest.** They fail differently — truncation
 *   changes both, substitution usually only the digest — and reporting which
 *   one moved says something about what happened.
 *
 * Serialization is deterministic: members are sorted by id, keys are written in
 * a fixed order, and the timestamp is supplied by the caller rather than read
 * from the clock, so the same archive always produces the same manifest bytes
 * and a fixture can pin them.
 */

export const ARCHIVE_MANIFEST_VERSION = 1;

export interface ArchiveManifestMember {
	readonly id: string;
	/** Where the member lives inside the archive. */
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	/** What the project refers to this by, when that differs from the path. */
	readonly sourceId?: string | null;
}

export interface ArchiveManifest {
	readonly manifestVersion: typeof ARCHIVE_MANIFEST_VERSION;
	readonly kind: 'archive-manifest';
	readonly generatedAt: string | null;
	readonly projectTitle: string | null;
	readonly members: readonly ArchiveManifestMember[];
	readonly totalByteLength: number;
}

export interface ArchiveManifestContext {
	/** ISO-8601 instant, supplied so the document stays deterministic. */
	readonly generatedAt?: string | null;
	readonly projectTitle?: string | null;
}

export interface ArchiveMemberInput {
	readonly id: string;
	readonly path?: string;
	readonly sourceId?: string | null;
	readonly bytes: Uint8Array;
}

/** Build a manifest by digesting each member. Never trusts a caller-supplied digest. */
export function createArchiveManifest(
	members: readonly ArchiveMemberInput[],
	context: ArchiveManifestContext = {},
): ArchiveManifest {
	const seen = new Set<string>();
	const entries: ArchiveManifestMember[] = [];
	for (const member of members ?? []) {
		const id = nonEmpty(member?.id, 'member id');
		if (seen.has(id)) throw new RangeError(`Archive member ${id} is listed twice.`);
		seen.add(id);
		if (!(member.bytes instanceof Uint8Array)) {
			throw new TypeError(`Archive member ${id} must supply its bytes to be digested.`);
		}
		entries.push(Object.freeze({
			id,
			path: String(member.path ?? id),
			byteLength: member.bytes.byteLength,
			// Digested here rather than accepted from the caller: a manifest that
			// repeats a digest it was handed proves only that it was handed one.
			sha256: digestScapeBytes(member.bytes),
			sourceId: member.sourceId ?? null,
		}));
	}
	entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
	return Object.freeze({
		manifestVersion: ARCHIVE_MANIFEST_VERSION,
		kind: 'archive-manifest' as const,
		generatedAt: nonEmptyOrNull(context.generatedAt),
		projectTitle: nonEmptyOrNull(context.projectTitle),
		members: Object.freeze(entries),
		totalByteLength: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
	});
}

export type ArchiveMismatchKind = 'missing' | 'size' | 'digest' | 'unlisted';

export interface ArchiveMismatch {
	readonly member: string;
	readonly kind: ArchiveMismatchKind;
	readonly expected: string | number | null;
	readonly actual: string | number | null;
	readonly message: string;
}

export interface ArchiveVerification {
	readonly ok: boolean;
	readonly checked: number;
	readonly mismatches: readonly ArchiveMismatch[];
}

/**
 * Read a manifest back against bytes.
 *
 * `read` returns the member's bytes or null when it is gone. Every member is
 * checked even after one fails, and members present in the archive but absent
 * from the manifest are reported too — an unlisted member is not harmless, it
 * means the manifest and the archive disagree about what the archive is.
 */
export function verifyArchiveManifest(
	manifest: ArchiveManifest,
	read: (member: ArchiveManifestMember) => Uint8Array | null | undefined,
	options: { readonly presentIds?: readonly string[] } = {},
): ArchiveVerification {
	if (!manifest || manifest.kind !== 'archive-manifest' || manifest.manifestVersion !== ARCHIVE_MANIFEST_VERSION) {
		throw new TypeError('An archive manifest of a supported version is required.');
	}
	const mismatches: ArchiveMismatch[] = [];
	for (const member of manifest.members) {
		const bytes = read(member);
		if (!bytes) {
			mismatches.push(mismatch(member.id, 'missing', member.sha256, null,
				`Archive member ${member.id} is missing.`));
			continue;
		}
		if (bytes.byteLength !== member.byteLength) {
			mismatches.push(mismatch(member.id, 'size', member.byteLength, bytes.byteLength,
				`Archive member ${member.id} is ${bytes.byteLength} bytes; the manifest recorded ${member.byteLength}.`));
			// Still digest it: size and digest failing together says truncation,
			// digest alone says substitution, and that distinction is the point.
		}
		const digest = digestScapeBytes(bytes);
		if (digest !== member.sha256) {
			mismatches.push(mismatch(member.id, 'digest', member.sha256, digest,
				`Archive member ${member.id} failed SHA-256 verification.`));
		}
	}

	if (options.presentIds) {
		const listed = new Set(manifest.members.map((member) => member.id));
		for (const id of options.presentIds) {
			if (listed.has(String(id))) continue;
			mismatches.push(mismatch(String(id), 'unlisted', null, String(id),
				`Archive member ${String(id)} is present but the manifest does not list it.`));
		}
	}

	return Object.freeze({
		ok: mismatches.length === 0,
		checked: manifest.members.length,
		mismatches: Object.freeze(mismatches),
	});
}

export interface SerializedArchiveManifest {
	readonly text: string;
	readonly fileName: string;
	readonly mimeType: 'application/json';
}

export function serializeArchiveManifest(manifest: ArchiveManifest): SerializedArchiveManifest {
	if (!manifest || manifest.kind !== 'archive-manifest') {
		throw new TypeError('An archive manifest is required.');
	}
	const document = {
		manifestVersion: manifest.manifestVersion,
		kind: manifest.kind,
		generatedAt: manifest.generatedAt,
		projectTitle: manifest.projectTitle,
		totalByteLength: manifest.totalByteLength,
		members: manifest.members.map((member) => ({
			id: member.id,
			path: member.path,
			sourceId: member.sourceId,
			byteLength: member.byteLength,
			sha256: member.sha256,
		})),
	};
	return Object.freeze({
		text: `${JSON.stringify(document, null, '\t')}\n`,
		fileName: manifestFileName(manifest),
		mimeType: 'application/json' as const,
	});
}

export function parseArchiveManifest(text: string): ArchiveManifest {
	const parsed = JSON.parse(String(text)) as Record<string, unknown>;
	if (parsed?.kind !== 'archive-manifest') throw new TypeError('This document is not an archive manifest.');
	if (parsed.manifestVersion !== ARCHIVE_MANIFEST_VERSION) {
		throw new RangeError(`Unsupported archive manifest version: ${String(parsed.manifestVersion)}.`);
	}
	const members = (Array.isArray(parsed.members) ? parsed.members : []).map((entry) => {
		const member = entry as Record<string, unknown>;
		return Object.freeze({
			id: nonEmpty(member.id, 'member id'),
			path: String(member.path ?? member.id),
			byteLength: nonNegativeInteger(member.byteLength, 'member byteLength'),
			sha256: nonEmpty(member.sha256, 'member sha256'),
			sourceId: member.sourceId == null ? null : String(member.sourceId),
		});
	});
	return Object.freeze({
		manifestVersion: ARCHIVE_MANIFEST_VERSION,
		kind: 'archive-manifest' as const,
		generatedAt: nonEmptyOrNull(parsed.generatedAt),
		projectTitle: nonEmptyOrNull(parsed.projectTitle),
		members: Object.freeze(members),
		totalByteLength: nonNegativeInteger(parsed.totalByteLength ?? 0, 'totalByteLength'),
	});
}

/** Save through the reserved `'report'` purpose, as the delivery report does. */
export async function saveArchiveManifest(
	manifest: ArchiveManifest,
	fileService: { saveFile?: (request: Readonly<Record<string, unknown>>) => unknown } | null | undefined,
): Promise<SerializedArchiveManifest> {
	const serialized = serializeArchiveManifest(manifest);
	if (fileService?.saveFile) {
		await fileService.saveFile({
			purpose: 'report',
			suggestedName: serialized.fileName,
			mimeType: serialized.mimeType,
			blob: new Blob([serialized.text], { type: serialized.mimeType }),
		});
	}
	return serialized;
}

function manifestFileName(manifest: ArchiveManifest): string {
	const title = sanitize(manifest.projectTitle) || 'project';
	const stamp = sanitize((manifest.generatedAt ?? '').slice(0, 10));
	return stamp ? `${title}-archive-manifest-${stamp}.json` : `${title}-archive-manifest.json`;
}

function mismatch(
	member: string,
	kind: ArchiveMismatchKind,
	expected: string | number | null,
	actual: string | number | null,
	message: string,
): ArchiveMismatch {
	return Object.freeze({ member, kind, expected, actual, message });
}

function nonEmpty(value: unknown, label: string): string {
	const text = String(value ?? '').trim();
	if (!text) throw new TypeError(`An archive ${label} is required.`);
	return text;
}

function nonEmptyOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return number;
}

function sanitize(value: unknown): string {
	return String(value ?? '')
		.trim()
		.replaceAll(/[^\w.-]+/gu, '-')
		.replaceAll(/[-.]{2,}/gu, '-')
		.replaceAll(/^[-.]+|[-.]+$/gu, '')
		.slice(0, 64);
}
