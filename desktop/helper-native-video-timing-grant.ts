/* SPDX-License-Identifier: AGPL-3.0-only */

/** Dedicated file authority for digest-bound SCTI inputs; never a media source. */

import { VIDEO_TIMING_ASSET_MAXIMUM_BYTES } from '../src/common/editor/video-timing-asset-reference.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';

export const HELPER_VIDEO_TIMING_ASSET_MAXIMUM_GRANTS = 4_096;

export interface HelperVideoTimingAssetGrant {
	readonly role: 'video-timing';
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly identity: Readonly<{ readonly dev: number; readonly ino: number }>;
}

const KEYS = Object.freeze(['role', 'path', 'bytes', 'sha256', 'identity']);
const IDENTITY_KEYS = Object.freeze(['dev', 'ino']);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_PATH_BYTES = 4_096;

export function validateHelperVideoTimingAssetGrants(
	value: unknown,
): readonly HelperVideoTimingAssetGrant[] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > HELPER_VIDEO_TIMING_ASSET_MAXIMUM_GRANTS) {
		return unsafe('A helper timing authority requires 1 through 4,096 exact file grants.');
	}
	const digests = new Set<string>();
	const paths = new Set<string>();
	const identities = new Set<string>();
	const grants = value.map((candidate) => {
		const record = exactRecord(candidate, KEYS, 'timing asset');
		const identity = exactRecord(record.identity, IDENTITY_KEYS, 'timing asset identity');
		if (record.role !== 'video-timing') unsafe('A timing asset helper grant requires its exact file role.');
		if (typeof record.path !== 'string' || !absolutePath(record.path)) {
			unsafe('A timing asset helper grant requires one absolute traversal-free path.');
		}
		if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 1
			|| Number(record.bytes) > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
			unsafe('A timing asset helper grant requires its bounded positive byte length.');
		}
		if (typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
			unsafe('A timing asset helper grant requires lowercase SHA-256.');
		}
		if (!Number.isSafeInteger(identity.dev) || Number(identity.dev) < 0
			|| !Number.isSafeInteger(identity.ino) || Number(identity.ino) < 0) {
			unsafe('A timing asset helper grant requires its captured non-negative file identity.');
		}
		const identityKey = `${String(identity.dev)}:${String(identity.ino)}`;
		if (digests.has(record.sha256) || paths.has(record.path) || identities.has(identityKey)) {
			unsafe('A timing asset helper grant cannot replay a digest, path, or file identity.');
		}
		digests.add(record.sha256);
		paths.add(record.path);
		identities.add(identityKey);
		return Object.freeze({
			role: 'video-timing' as const,
			path: record.path,
			bytes: Number(record.bytes),
			sha256: record.sha256,
			identity: Object.freeze({ dev: Number(identity.dev), ino: Number(identity.ino) }),
		});
	});
	return Object.freeze(grants);
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		return unsafe(`A helper ${label} grant must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		return unsafe(`A helper ${label} grant must carry exactly its schema keys.`);
	}
	return record;
}

function absolutePath(value: string): boolean {
	return value.length > 0 && new TextEncoder().encode(value).byteLength <= MAXIMUM_PATH_BYTES
		&& !value.includes('\0') && !value.split(/[\\/]/u).includes('..')
		&& (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'));
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}
