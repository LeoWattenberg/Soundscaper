/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The loudspeaker layouts an authored ADM bed can carry.
 *
 * One table, consumed by everything: the CHNA writer, the AXML writer, the
 * project-metadata validator, the editor model, and the binaural renderer. They
 * used to hold three separate copies of "which channels does 5.1 have", which
 * only stayed consistent because nothing had ever been added.
 *
 * **Two kinds of layout live here.** `mono`, `stereo` and `5.1` name pack and
 * channel formats from the ITU-R BS.2094 common definitions, which a reader is
 * expected to already know; those references are what shipped and their bytes do
 * not change. The immersive layouts reference the common definitions only for
 * the channels that provably have one — the 5.1 base — and **define their own**
 * pack and channel formats, in the custom identifier range, for every speaker
 * above or beside it. A file that defines its speakers says where it thinks they
 * are; a file that cites an identifier is trusting a table it cannot show. Only
 * the first of those can be checked by the reader holding it.
 *
 * The positions follow the BS.2051 loudspeaker systems these layouts correspond
 * to — B (0+5+0), C (2+5+0), D (4+5+0), I (0+7+0) and J (4+7+0) — but the
 * emitted XML claims no system name. It declares speaker labels and coordinates,
 * which are exactly the values in this table, so the file and this module cannot
 * drift apart into two different opinions about where a speaker sits.
 */

export const ADM_BED_LAYOUTS = Object.freeze([
	'mono', 'stereo', '5.1', '5.1.2', '5.1.4', '7.1', '7.1.4',
] as const);
export type AdmBedLayout = typeof ADM_BED_LAYOUTS[number];

export const ADM_BED_CHANNELS = Object.freeze([
	'M', 'L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lss', 'Rss', 'Lrs', 'Rrs',
	'Ltf', 'Rtf', 'Ltr', 'Rtr',
] as const);
export type AdmBedChannel = typeof ADM_BED_CHANNELS[number];

export interface AdmBedSpeaker {
	/** The delivery-order channel name this layout gives the speaker. */
	readonly channel: AdmBedChannel;
	/** The ADM speaker label, e.g. `M+030`. */
	readonly speakerLabel: string;
	readonly channelRef: string;
	/**
	 * Whether the emitted AXML must carry this channel's own definition. False
	 * for the BS.2094 common definitions, which are referenced rather than
	 * restated.
	 */
	readonly defined: boolean;
	/** Degrees, ADM convention: azimuth positive to the left, elevation up. */
	readonly azimuth: number;
	readonly elevation: number;
	/** Low-frequency effects channels carry no direction to render. */
	readonly lowFrequencyEffects: boolean;
}

export interface AdmBedLayoutDefinition {
	readonly layout: AdmBedLayout;
	readonly packRef: string;
	/** Whether `packRef` names a BS.2094 common definition rather than an own one. */
	readonly commonDefinition: boolean;
	readonly speakers: readonly AdmBedSpeaker[];
}

type SpeakerSeed = Readonly<{
	label: string;
	ref: string;
	azimuth: number;
	elevation: number;
	lfe?: boolean;
	defined?: boolean;
}>;

/** Speaker positions, keyed by ADM speaker label so a position is stated once. */
const SPEAKERS: Readonly<Record<string, SpeakerSeed>> = Object.freeze({
	// BS.2094 common definitions: referenced, never restated.
	'M+030': { label: 'M+030', ref: 'AC_00010001', azimuth: 30, elevation: 0 },
	'M-030': { label: 'M-030', ref: 'AC_00010002', azimuth: -30, elevation: 0 },
	'M+000': { label: 'M+000', ref: 'AC_00010003', azimuth: 0, elevation: 0 },
	LFE1: { label: 'LFE1', ref: 'AC_00010004', azimuth: 45, elevation: -30, lfe: true },
	'M+110': { label: 'M+110', ref: 'AC_00010005', azimuth: 110, elevation: 0 },
	'M-110': { label: 'M-110', ref: 'AC_00010006', azimuth: -110, elevation: 0 },
	// Defined by any file that uses them.
	'M+090': { label: 'M+090', ref: 'AC_00011001', azimuth: 90, elevation: 0, defined: true },
	'M-090': { label: 'M-090', ref: 'AC_00011002', azimuth: -90, elevation: 0, defined: true },
	'M+135': { label: 'M+135', ref: 'AC_00011003', azimuth: 135, elevation: 0, defined: true },
	'M-135': { label: 'M-135', ref: 'AC_00011004', azimuth: -135, elevation: 0, defined: true },
	'U+030': { label: 'U+030', ref: 'AC_00011005', azimuth: 30, elevation: 30, defined: true },
	'U-030': { label: 'U-030', ref: 'AC_00011006', azimuth: -30, elevation: 30, defined: true },
	'U+110': { label: 'U+110', ref: 'AC_00011007', azimuth: 110, elevation: 30, defined: true },
	'U-110': { label: 'U-110', ref: 'AC_00011008', azimuth: -110, elevation: 30, defined: true },
	'U+045': { label: 'U+045', ref: 'AC_00011009', azimuth: 45, elevation: 30, defined: true },
	'U-045': { label: 'U-045', ref: 'AC_0001100A', azimuth: -45, elevation: 30, defined: true },
	'U+135': { label: 'U+135', ref: 'AC_0001100B', azimuth: 135, elevation: 30, defined: true },
	'U-135': { label: 'U-135', ref: 'AC_0001100C', azimuth: -135, elevation: 30, defined: true },
});

const SURROUND_5_1: readonly (readonly [AdmBedChannel, string])[] = Object.freeze([
	['L', 'M+030'], ['R', 'M-030'], ['C', 'M+000'],
	['LFE', 'LFE1'], ['Ls', 'M+110'], ['Rs', 'M-110'],
]);
const SURROUND_7_1: readonly (readonly [AdmBedChannel, string])[] = Object.freeze([
	['L', 'M+030'], ['R', 'M-030'], ['C', 'M+000'], ['LFE', 'LFE1'],
	['Lss', 'M+090'], ['Rss', 'M-090'], ['Lrs', 'M+135'], ['Rrs', 'M-135'],
]);

export const ADM_BED_LAYOUT_DEFINITIONS: Readonly<Record<AdmBedLayout, AdmBedLayoutDefinition>> = Object.freeze({
	mono: layout('mono', 'AP_00010001', false, [['M', 'M+000']]),
	stereo: layout('stereo', 'AP_00010002', false, [['L', 'M+030'], ['R', 'M-030']]),
	'5.1': layout('5.1', 'AP_00010003', false, SURROUND_5_1),
	'5.1.2': layout('5.1.2', 'AP_00011001', true, [
		...SURROUND_5_1, ['Ltf', 'U+030'], ['Rtf', 'U-030'],
	]),
	'5.1.4': layout('5.1.4', 'AP_00011002', true, [
		...SURROUND_5_1,
		['Ltf', 'U+030'], ['Rtf', 'U-030'], ['Ltr', 'U+110'], ['Rtr', 'U-110'],
	]),
	'7.1': layout('7.1', 'AP_00011003', true, SURROUND_7_1),
	'7.1.4': layout('7.1.4', 'AP_00011004', true, [
		...SURROUND_7_1,
		['Ltf', 'U+045'], ['Rtf', 'U-045'], ['Ltr', 'U+135'], ['Rtr', 'U-135'],
	]),
});

function layout(
	name: AdmBedLayout,
	packRef: string,
	own: boolean,
	speakers: readonly (readonly [AdmBedChannel, string])[],
): AdmBedLayoutDefinition {
	return Object.freeze({
		layout: name,
		packRef,
		commonDefinition: !own,
		speakers: Object.freeze(speakers.map(([channel, speakerLabel]) => {
			const seed = SPEAKERS[speakerLabel];
			if (!seed) throw new RangeError(`Unknown ADM speaker label: ${speakerLabel}.`);
			return Object.freeze({
				channel,
				speakerLabel: seed.label,
				channelRef: seed.ref,
				defined: seed.defined === true,
				azimuth: seed.azimuth,
				elevation: seed.elevation,
				lowFrequencyEffects: seed.lfe === true,
			});
		})),
	});
}

/**
 * The track UID for a zero-based delivery channel index.
 *
 * `ATU_` identifiers are eight hexadecimal digits, and this used to be written
 * by padding a decimal counter — which agreed with the reader only while no
 * layout had ten channels. It lives here so the AXML writer and the CHNA writer
 * cannot spell the same channel two different ways.
 */
export function admTrackUid(index: number): string {
	if (!Number.isSafeInteger(index) || index < 0 || index >= 0xffff_fffe) {
		throw new RangeError('An ADM track UID index must be a non-negative safe integer.');
	}
	return `ATU_${(index + 1).toString(16).toUpperCase().padStart(8, '0')}`;
}

export function isAdmBedLayout(value: unknown): value is AdmBedLayout {
	return typeof value === 'string' && Object.hasOwn(ADM_BED_LAYOUT_DEFINITIONS, value);
}

export function admBedLayoutDefinition(layoutName: AdmBedLayout): AdmBedLayoutDefinition {
	const definition = ADM_BED_LAYOUT_DEFINITIONS[layoutName];
	if (!definition) throw new RangeError(`Unsupported ADM bed layout: ${String(layoutName)}.`);
	return definition;
}

export function admBedSpeakers(layoutName: AdmBedLayout): readonly AdmBedSpeaker[] {
	return admBedLayoutDefinition(layoutName).speakers;
}

export function admBedChannelOrder(layoutName: AdmBedLayout): readonly AdmBedChannel[] {
	const order = CHANNEL_ORDER[layoutName];
	if (!order) throw new RangeError(`Unsupported ADM bed layout: ${String(layoutName)}.`);
	return order;
}

export function admBedChannelCount(layoutName: AdmBedLayout): number {
	return admBedSpeakers(layoutName).length;
}

/** The channel-format references a layout's pack points at, in delivery order. */
export function admBedChannelRefs(layoutName: AdmBedLayout): readonly string[] {
	return admBedSpeakers(layoutName).map((speaker) => speaker.channelRef);
}

/**
 * The speakers whose definitions this layout must write into its own AXML.
 *
 * Deduplicated by identifier: two layouts can share a position, and a file that
 * used both would otherwise define it twice.
 */
export function admBedDefinedSpeakers(layoutName: AdmBedLayout): readonly AdmBedSpeaker[] {
	const seen = new Set<string>();
	return Object.freeze(admBedSpeakers(layoutName).filter((speaker) => {
		if (!speaker.defined || seen.has(speaker.channelRef)) return false;
		seen.add(speaker.channelRef);
		return true;
	}));
}

const CHANNEL_ORDER = Object.freeze(Object.fromEntries(
	ADM_BED_LAYOUTS.map((name) => [
		name,
		Object.freeze(ADM_BED_LAYOUT_DEFINITIONS[name].speakers.map((speaker) => speaker.channel)),
	]),
) as Record<AdmBedLayout, readonly AdmBedChannel[]>);

/** Every bed channel name any layout uses, for validating an assignment. */
export const ADM_BED_CHANNEL_ORDER: Readonly<Record<AdmBedLayout, readonly AdmBedChannel[]>> = CHANNEL_ORDER;
