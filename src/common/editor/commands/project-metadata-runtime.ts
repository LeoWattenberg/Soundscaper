/* SPDX-License-Identifier: AGPL-3.0-only */

import { authoredAdmChannelCount, normalizeAdmProjectMetadata, type AdmProjectMetadataInput } from '../adm-project-metadata.ts';
import { normalizeCartMetadata, type CartMetadataInput } from '../cart-metadata.ts';
import { normalizeIxmlMetadata, type IxmlMetadataInput } from '../ixml.ts';
import { normalizeProjectBextMetadata } from '../project-bext-metadata.ts';
import {
	hasAdmMetadataProjectAuthority, hasBextMetadataProjectAuthority, hasCoreEditingProjectAuthority,
} from '../project-schema-version.ts';

/** Apply both authored fields and the structured namespaces promoted by normal media imports. */
export function updateProjectMetadata(project: unknown, changes: unknown = {}): void {
	if (!hasCoreEditingProjectAuthority(project) || !isRecord(project)) {
		throw new RangeError('Metadata editing requires an active editing project.');
	}
	if (!isRecord(changes)) throw new TypeError('Metadata changes must be an object.');
	const allowed = new Set([
		'title', 'artist', 'album', 'trackNumber', 'year', 'comments', 'tags', 'cart', 'ixml',
		...(hasBextMetadataProjectAuthority(project) ? ['bext'] : []),
		...(hasAdmMetadataProjectAuthority(project) ? ['adm'] : []),
	]);
	for (const key of Object.keys(changes)) {
		if (!allowed.has(key)) throw new RangeError(`Metadata field cannot be updated: ${key}.`);
	}
	const next = { ...(isRecord(project.metadata) ? project.metadata : {}) };
	for (const key of allowed) {
		if (!Object.hasOwn(changes, key)) continue;
		if (key === 'bext') {
			next.bext = changes.bext == null ? null : normalizeProjectBextMetadata(changes.bext);
		} else if (key === 'cart') {
			next.cart = changes.cart == null ? null : normalizeCartMetadata(changes.cart as CartMetadataInput);
		} else if (key === 'ixml') {
			next.ixml = changes.ixml == null ? null : normalizeIxmlMetadata(changes.ixml as IxmlMetadataInput);
		} else if (key === 'adm') {
			const adm = changes.adm == null ? null : normalizeAdmProjectMetadata(changes.adm as AdmProjectMetadataInput);
			next.adm = adm;
			const authoredChannels = authoredAdmChannelCount(adm);
			const passthroughChannels = adm?.mode === 'passthrough' && adm.valid
				&& Number.isSafeInteger(adm.geometry.channelCount)
				&& adm.geometry.channelCount >= 1 && adm.geometry.channelCount <= 32
				? adm.geometry.channelCount : null;
			if (authoredChannels != null || passthroughChannels != null) {
				project.masterChannels = authoredChannels ?? passthroughChannels;
			}
		} else if (key === 'tags') {
			if (!isRecord(changes.tags)) throw new TypeError('metadata.tags must be an object.');
			next.tags = Object.fromEntries(Object.entries(changes.tags).map(([name, value]) => {
				const normalizedName = String(name).trim();
				if (!normalizedName) throw new RangeError('A metadata tag name is required.');
				return [normalizedName, String(value ?? '')];
			}));
		} else next[key] = String(changes[key] ?? '');
	}
	project.metadata = next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
