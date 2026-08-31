/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoCaptionTrackV1 } from './video-caption-track-v27.ts';
import {
	captionLoss,
	type VideoCaptionInterchangeLossCodeV1,
	type VideoCaptionInterchangeLossV1,
} from './video-caption-interchange-contract-v27.ts';

export const IMSC_XML_ID_V1 = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;

export interface ImscXmlIdentitiesV1 {
	readonly trackId: string;
	readonly styles: ReadonlyMap<string, string>;
	readonly regions: ReadonlyMap<string, string>;
	readonly speakers: ReadonlyMap<string, string>;
	readonly cues: ReadonlyMap<string, string>;
}

type IdentityKind = 'track' | 'style' | 'region' | 'speaker' | 'cue';

const LOSS_CODES: Readonly<Record<IdentityKind, VideoCaptionInterchangeLossCodeV1>> = Object.freeze({
	track: 'track-identity-normalized',
	style: 'style-identity-normalized',
	region: 'region-identity-normalized',
	speaker: 'speaker-identity-normalized',
	cue: 'cue-identity-normalized',
});

export function createImscXmlIdentitiesV1(
	track: VideoCaptionTrackV1,
	losses: VideoCaptionInterchangeLossV1[],
): ImscXmlIdentitiesV1 {
	const used = new Set<string>();
	const counts = new Map<IdentityKind, number>();
	const reserve = (kind: IdentityKind, source: string, path: string): string => {
		if (IMSC_XML_ID_V1.test(source) && !used.has(source)) {
			used.add(source);
			return source;
		}
		let count = (counts.get(kind) ?? 0) + 1;
		let candidate = `soundscaper-${kind}-${count}`;
		while (used.has(candidate)) {
			count += 1;
			candidate = `soundscaper-${kind}-${count}`;
		}
		counts.set(kind, count);
		used.add(candidate);
		losses.push(captionLoss(
			LOSS_CODES[kind],
			path,
			`IMSC requires a document-global XML identity; ${kind} identity was normalized.`,
			{ source, id: candidate },
		));
		return candidate;
	};
	const collection = (
		kind: Exclude<IdentityKind, 'track'>,
		values: readonly { readonly id: string }[],
	): ReadonlyMap<string, string> => new Map(values.map((value) => [
		value.id,
		reserve(kind, value.id, `${kind}s.${value.id}.id`),
	]));
	return Object.freeze({
		trackId: reserve('track', track.id, 'track.id'),
		styles: collection('style', track.styles),
		regions: collection('region', track.regions),
		speakers: collection('speaker', track.speakers),
		cues: collection('cue', track.cues),
	});
}
