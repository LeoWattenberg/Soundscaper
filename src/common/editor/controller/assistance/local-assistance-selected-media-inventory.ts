/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical selected-media inventory validation shared by controller and UI routing. */

import {
	ASSISTANCE_OPERATIONS,
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../../assistance/operation.ts';
import { enumValue, exactRecord, id, text } from './local-assistance-prepared-media.ts';

const MEDIA_KINDS = Object.freeze([
	'audio', 'video', 'frame-pack', 'transcript', 'text', 'editorial-context',
] as const);

export type LocalAssistanceSelectedMediaKind = typeof MEDIA_KINDS[number];

export interface NormalizedLocalAssistanceSelectedMediaSource {
	readonly sourceId: string;
	readonly label: string;
	readonly mediaKind: LocalAssistanceSelectedMediaKind;
	readonly operations: readonly AssistanceOperation[];
}

export interface NormalizedLocalAssistanceSelectedMediaInventory {
	readonly sources: readonly NormalizedLocalAssistanceSelectedMediaSource[];
}

export function normalizeLocalAssistanceSelectedMediaInventory(
	value: unknown,
): NormalizedLocalAssistanceSelectedMediaInventory {
	const record = exactRecord(value, ['sources'], 'selected-media inventory');
	if (!Array.isArray(record.sources) || record.sources.length > 128) {
		throw new TypeError('The selected-media source inventory is invalid.');
	}
	const seen = new Set<string>();
	const sources = record.sources.map((candidate) => {
		const source = exactRecord(
			candidate,
			['sourceId', 'label', 'mediaKind', 'operations'],
			'selected-media source',
		);
		const sourceId = id(source.sourceId);
		if (seen.has(sourceId)) throw new TypeError('A selected-media source identity is repeated.');
		seen.add(sourceId);
		if (!Array.isArray(source.operations) || source.operations.length < 1
			|| source.operations.length > ASSISTANCE_OPERATIONS.length) {
			throw new TypeError('A selected-media source operation inventory is invalid.');
		}
		const operations = Object.freeze(source.operations.map(normalizeAssistanceOperation));
		if (new Set(operations).size !== operations.length) {
			throw new TypeError('A selected-media source repeats an operation.');
		}
		return Object.freeze({
			sourceId,
			label: text(source.label, 160, 'source label'),
			mediaKind: enumValue(source.mediaKind, MEDIA_KINDS, 'media kind'),
			operations,
		});
	});
	return Object.freeze({ sources: Object.freeze(sources) });
}
