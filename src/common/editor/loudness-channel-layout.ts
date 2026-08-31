/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	authoredAdmDeliveryChannels,
	normalizeAdmProjectMetadata,
	type AdmProjectMetadataInput,
} from './adm-project-metadata.ts';

const CANONICAL_7_1_WEIGHTS = Object.freeze([
	1, 1, 1, 0, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2,
]);

/**
 * Resolve a loudness override only when ADM proves every delivered channel's role.
 *
 * A bare eight-channel master is not enough: it may be 7.1, 5.1.2, or an
 * application-defined discrete layout. A bed-only authored ADM 7.1 programme is
 * narrower: its render order is L/R/C/LFE/Lss/Rss/Lrs/Rrs, so BS.1770's zero
 * LFE contribution and +1.5 dB surround contribution are unambiguous.
 */
export function resolveAdmEbuChannelWeights(
	metadataValue: unknown,
	channelCount: number,
): readonly number[] | null {
	if (channelCount !== 8 || !metadataValue || typeof metadataValue !== 'object'
		|| Array.isArray(metadataValue) || !('mode' in metadataValue)
		|| metadataValue.mode !== 'authored') return null;
	try {
		const metadata = normalizeAdmProjectMetadata(metadataValue as AdmProjectMetadataInput);
		if (metadata.mode !== 'authored' || metadata.bed.layout !== '7.1') return null;
		const delivery = authoredAdmDeliveryChannels(metadata);
		if (delivery.length !== channelCount || delivery.some(({ kind }) => kind !== 'bed')) return null;
		return CANONICAL_7_1_WEIGHTS;
	} catch {
		return null;
	}
}
