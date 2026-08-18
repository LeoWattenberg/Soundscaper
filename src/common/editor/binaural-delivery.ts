/* SPDX-License-Identifier: AGPL-3.0-only */

import { admBedSpeakers } from './adm-bed-layout.ts';
import {
	authoredAdmDeliveryChannelCount,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmProjectMetadata,
} from './adm-project-metadata.ts';
import type { BinauralSource } from './binaural-render.ts';

/**
 * Turning an authored ADM programme into the positioned sources a binaural
 * render needs.
 *
 * The positions are the ones already written into the file: bed channels take
 * their speaker coordinates from the same table the AXML declares them with, and
 * objects take the positions they were authored at. There is no second opinion
 * about where anything is, which is what stops a delivery sounding like a
 * different programme than the one it describes.
 */

export interface BinauralDeliveryPlan {
	readonly metadata: AdmAuthoredMetadata;
	/** The delivered width of the programme this render consumes. */
	readonly sourceChannelCount: number;
}

/**
 * Resolve a binaural delivery, or explain in one word why there is none.
 *
 * Every refusal here is a case where a binaural delivery would have to invent
 * something: a programme it cannot place, samples it is not allowed to touch, or
 * a container that would describe channels the file no longer has.
 */
export type BinauralRefusal =
	| 'not-requested'
	| 'no-authored-programme'
	| 'passthrough'
	| 'stems'
	| 'container-declares-a-different-programme';

export function resolveBinauralDelivery(
	adm: AdmProjectMetadata | Readonly<Record<string, unknown>> | null | undefined,
	options: Readonly<{ binaural?: unknown; mode: string; format: string }>,
): Readonly<{ plan: BinauralDeliveryPlan | null; refusal: BinauralRefusal | null }> {
	if (options.binaural !== true) return refused('not-requested');
	if (options.mode !== 'mix') return refused('stems');
	// A binaural render delivers two channels. Writing them into BW64 would leave
	// a CHNA and an AXML describing a bed and objects that are no longer there.
	if (options.format === 'bw64') return refused('container-declares-a-different-programme');
	if (adm == null) return refused('no-authored-programme');
	const metadata = normalizeAdmProjectMetadata(adm as Parameters<typeof normalizeAdmProjectMetadata>[0]);
	// Passthrough is byte preservation or nothing, and rendering is not nothing.
	if (metadata.mode !== 'authored') return refused('passthrough');
	return Object.freeze({
		plan: Object.freeze({
			metadata,
			sourceChannelCount: authoredAdmDeliveryChannelCount(metadata),
		}),
		refusal: null,
	});
}

export function binauralSourcesForAuthoredAdm(
	metadata: AdmAuthoredMetadata,
	channels: readonly Float32Array[],
): readonly BinauralSource[] {
	const speakers = admBedSpeakers(metadata.bed.layout);
	const objects = metadata.objects ?? [];
	const expected = speakers.length + objects.length;
	if (channels.length !== expected) {
		// A mismatch means the render and the programme disagree about what was
		// delivered, and guessing which channel is which would place sources at
		// positions nothing authored.
		throw new RangeError(
			`A binaural render of this programme needs ${expected} channels, not ${channels.length}.`,
		);
	}
	return Object.freeze([
		...speakers.map((speaker, index) => Object.freeze({
			channel: channels[index],
			azimuth: speaker.azimuth,
			elevation: speaker.elevation,
			distance: 1,
			lowFrequencyEffects: speaker.lowFrequencyEffects,
			name: speaker.channel,
		})),
		...objects.map((object, index) => Object.freeze({
			channel: channels[speakers.length + index],
			azimuth: object.position.azimuth,
			elevation: object.position.elevation,
			distance: object.position.distance,
			name: object.name,
		})),
	]);
}

function refused(refusal: BinauralRefusal): Readonly<{ plan: null; refusal: BinauralRefusal }> {
	return Object.freeze({ plan: null, refusal });
}
