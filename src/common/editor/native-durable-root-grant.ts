/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `DurableRootGrantV1` — a destination directory the user authorized, held
 * across restarts.
 *
 * A persistent job cannot use the one-use save token an ordinary export gets:
 * that token expires, and persisting it would either fail silently later or
 * become a stored capability nobody re-authorized. So a durable root is an
 * explicit, revalidated grant instead. The renderer only ever sees the opaque
 * id; the canonical path, volume, and directory identity stay main-private.
 *
 * Revalidation happens at startup and before every dispatch, and it checks
 * identity rather than path text. A directory that was renamed, replaced,
 * remounted, or swapped for a symlink to somewhere else has the same string and
 * a different identity — trusting the string is how a job ends up writing into
 * a folder the user never chose.
 */

import {
	assertNativeMediaRelativeDestination,
} from './native-media-atomic-publication.ts';
import { createNativeValidators } from './native-validation.ts';

export const DURABLE_ROOT_GRANT_VERDICTS = Object.freeze([
	'valid',
	'revoked',
	'missing',
	'moved',
	'identity-changed',
	'not-a-directory',
] as const);

export type DurableRootGrantVerdict = (typeof DURABLE_ROOT_GRANT_VERDICTS)[number];

export interface DurableRootGrantV1 {
	readonly grantId: string;
	/** Main-private. Never crosses the renderer bridge. */
	readonly canonicalPath: string;
	readonly volumeIdentity: string;
	readonly directoryIdentity: string;
	readonly authorizedAtMs: number;
	readonly revokedAtMs: number | null;
}

/** Everything a renderer is allowed to know about a granted root. */
export interface DurableRootGrantProjectionV1 {
	readonly grantId: string;
	readonly displayName: string;
	readonly revoked: boolean;
}

export interface DurableRootGrantObservationV1 {
	readonly exists: boolean;
	readonly isDirectory: boolean;
	readonly canonicalPath: string | null;
	readonly volumeIdentity: string | null;
	readonly directoryIdentity: string | null;
}

export class DurableRootGrantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DurableRootGrantError';
	}
}

const GRANT_ID_PATTERN = /^[a-f0-9]{16,64}$/u;
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:|._-]{0,127}$/u;
const MAXIMUM_PATH_LENGTH = 4_096;

const { nonNegativeInteger, pattern } = createNativeValidators({
	subject: 'A durable root grant',
	raise: (message: string): never => {
		throw new DurableRootGrantError(message);
	},
});

/**
 * Refuse to persist an expiring one-use token as if it were a durable grant.
 * The two are different capabilities and only one of them survives a restart.
 */
export function assertNotOneUseSaveToken(candidate: unknown): void {
	const record = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
		? candidate as Record<string, unknown>
		: null;
	if (!record) return;
	for (const key of ['expiresAtMs', 'oneUse', 'singleUse', 'saveToken', 'expiresAt']) {
		if (Object.hasOwn(record, key)) {
			throw new DurableRootGrantError(
				'An expiring one-use save token is never persisted as a durable root grant.',
			);
		}
	}
}

export function createDurableRootGrantV1(input: Readonly<{
	grantId: string;
	canonicalPath: string;
	volumeIdentity: string;
	directoryIdentity: string;
	authorizedAtMs: number;
}>): DurableRootGrantV1 {
	assertNotOneUseSaveToken(input);
	return Object.freeze({
		grantId: pattern(input.grantId, GRANT_ID_PATTERN, 'grantId'),
		canonicalPath: absolutePath(input.canonicalPath),
		volumeIdentity: pattern(input.volumeIdentity, IDENTITY_PATTERN, 'volumeIdentity'),
		directoryIdentity: pattern(input.directoryIdentity, IDENTITY_PATTERN, 'directoryIdentity'),
		authorizedAtMs: nonNegativeInteger(input.authorizedAtMs, 'authorizedAtMs'),
		revokedAtMs: null,
	});
}

export function revokeDurableRootGrant(
	grant: DurableRootGrantV1,
	atMs: number,
): DurableRootGrantV1 {
	const revokedAtMs = nonNegativeInteger(atMs, 'revokedAtMs');
	if (revokedAtMs < grant.authorizedAtMs) {
		throw new DurableRootGrantError('A durable root grant cannot be revoked before it was authorized.');
	}
	return Object.freeze({ ...grant, revokedAtMs });
}

/** The only shape of a grant a renderer may receive. */
export function projectDurableRootGrant(
	grant: DurableRootGrantV1,
	displayName: string,
): DurableRootGrantProjectionV1 {
	if (typeof displayName !== 'string' || displayName.length === 0 || displayName.length > 256) {
		throw new DurableRootGrantError('A durable root projection needs a bounded display name.');
	}
	if (displayName.includes(grant.canonicalPath)) {
		throw new DurableRootGrantError('A durable root projection must not leak its main-private path.');
	}
	return Object.freeze({
		grantId: grant.grantId,
		displayName,
		revoked: grant.revokedAtMs !== null,
	});
}

/**
 * Revalidate one grant against what the filesystem currently reports.
 *
 * A moved or replaced directory is not silently re-adopted: the caller turns
 * either verdict into a fresh authorization prompt, because the user granted a
 * *place*, not a name.
 */
export function revalidateDurableRootGrant(
	grant: DurableRootGrantV1,
	observation: DurableRootGrantObservationV1,
): DurableRootGrantVerdict {
	if (grant.revokedAtMs !== null) return 'revoked';
	if (!observation.exists) return 'missing';
	if (!observation.isDirectory) return 'not-a-directory';
	if (observation.canonicalPath !== grant.canonicalPath) return 'moved';
	if (observation.volumeIdentity !== grant.volumeIdentity
		|| observation.directoryIdentity !== grant.directoryIdentity) {
		return 'identity-changed';
	}
	return 'valid';
}

/** Only a `valid` grant may be written into; everything else needs the user. */
export function durableRootGrantIsWritable(verdict: DurableRootGrantVerdict): boolean {
	return verdict === 'valid';
}

/**
 * Resolve one relative destination inside a granted root.
 *
 * Containment is proven twice: the relative text is validated on its own, and
 * the resolved canonical path must still sit under the granted root — which is
 * what catches a symlinked subdirectory pointing outside it.
 */
export function resolveDurableRootDestination(
	grant: DurableRootGrantV1,
	relativeDestination: string,
	resolvedCanonicalPath?: string,
): string {
	const relative = assertNativeMediaRelativeDestination(relativeDestination);
	const separator = grant.canonicalPath.includes('\\') ? '\\' : '/';
	const base = grant.canonicalPath.endsWith(separator)
		? grant.canonicalPath.slice(0, -1)
		: grant.canonicalPath;
	const joined = `${base}${separator}${separator === '\\' ? relative.split('/').join('\\') : relative}`;
	if (resolvedCanonicalPath !== undefined && !isContained(base, resolvedCanonicalPath, separator)) {
		throw new DurableRootGrantError('A native media destination resolved outside its granted root.');
	}
	return joined;
}

function isContained(base: string, candidate: string, separator: string): boolean {
	return candidate.startsWith(`${base}${separator}`) && !candidate.includes(`${separator}..${separator}`);
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_PATH_LENGTH
		|| value.includes('\0')
		|| !(value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'))
		|| value.split(/[\\/]/u).includes('..')) {
		throw new DurableRootGrantError('A durable root grant requires one absolute, traversal-free path.');
	}
	return value;
}
