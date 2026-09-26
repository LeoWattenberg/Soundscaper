/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectSourceIds } from '../common/editor/retention.js';
import type { FramescaperProjectSequence } from './editor-project-sequence.ts';

/** Collect only body roles owned by the exact sequence generation. */
export function collectFramescaperProjectStorageKeysSequence(
	project: FramescaperProjectSequence,
	target: Set<string> = new Set(),
): Set<string> {
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	for (const sourceId of collectProjectSourceIds(project)) {
		const source = sourceById.get(sourceId) as Readonly<Record<string, unknown>> | undefined;
		const storageKey = source?.storageKey;
		target.add(typeof storageKey === 'string' && storageKey ? storageKey : sourceId);
		const timingStorageKey = (source?.timingAsset as Readonly<Record<string, unknown>> | undefined)?.storageKey;
		if (typeof timingStorageKey === 'string' && timingStorageKey) target.add(timingStorageKey);
		if (source?.kind !== 'video') continue;
		const attachment = source.proxyAttachment as Readonly<Record<string, unknown>> | null;
		const proxyStorageKey = attachment?.storageKey;
		if (typeof proxyStorageKey === 'string' && proxyStorageKey) target.add(proxyStorageKey);
		const proxyTimingStorageKey = (
			attachment?.timingAsset as Readonly<Record<string, unknown>> | undefined
		)?.storageKey;
		if (typeof proxyTimingStorageKey === 'string' && proxyTimingStorageKey) {
			target.add(proxyTimingStorageKey);
		}
	}
	for (const asset of arrayRecords(project.assistanceAssets)) {
		const storageKey = (asset.body as Readonly<Record<string, unknown>> | undefined)?.storageKey;
		if (typeof storageKey === 'string' && storageKey) target.add(storageKey);
	}
	return target;
}

function arrayRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is Readonly<Record<string, unknown>> => (
		entry !== null && typeof entry === 'object' && !Array.isArray(entry)
	));
}
