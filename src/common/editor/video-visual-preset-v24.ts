/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';

export interface VideoVisualPresetV1 {
	readonly schemaVersion: 1;
	readonly kind: 'video-preset';
	readonly id: string;
	readonly name: string;
	readonly modelKind: 'generator' | 'adjustment-layer' | 'mask-matte';
	readonly authoredStateSha256: string;
}

const FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'name', 'modelKind', 'authoredStateSha256',
]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Persist only a digest-bound preset identity; executable state stays in its owning model. */
export function normalizeVideoVisualPresetV1(value: unknown): VideoVisualPresetV1 {
	const record = readClosedDomainRecord(value, 'video visual preset', FIELDS);
	if (field(record, 'schemaVersion') !== 1 || field(record, 'kind') !== 'video-preset') {
		throw new RangeError('A video visual preset requires schemaVersion 1 and kind video-preset.');
	}
	const modelKind = field(record, 'modelKind');
	if (modelKind !== 'generator' && modelKind !== 'adjustment-layer' && modelKind !== 'mask-matte') {
		throw new RangeError('A video visual preset modelKind is unsupported.');
	}
	return Object.freeze({
		schemaVersion: 1 as const,
		kind: 'video-preset' as const,
		id: stableId(field(record, 'id'), 'video visual preset.id'),
		name: safeName(field(record, 'name')),
		modelKind,
		authoredStateSha256: digest(field(record, 'authoredStateSha256')),
	});
}

function field(record: Readonly<Record<string, unknown>>, key: string): unknown {
	return readClosedDomainField(record, key, 'video visual preset');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function safeName(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 512
		|| value.normalize('NFC') !== value || UNSAFE_TEXT.test(value) || /[\r\n]/u.test(value)) {
		throw new TypeError('A video visual preset name must be canonical safe text.');
	}
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('A video visual preset authored state must be a lowercase SHA-256.');
	}
	return value;
}
