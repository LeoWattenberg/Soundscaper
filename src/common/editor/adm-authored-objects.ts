/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	MAX_ADM_NAME_BYTES,
	enumValue,
	finiteNumber,
	nonEmptyText,
	objectValue,
	safeInteger,
} from './adm-normalization-guards.ts';
import type { AdmTerminalStripKind } from './adm-project-metadata.ts';

/**
 * Authored ADM objects: one signal, one position, one delivered channel.
 *
 * An object programme is authored **on top of** a bed rather than instead of
 * one. That is a deliberate limit, not an oversight: every path that resolves an
 * authored delivery — master width, channel order, CHNA, the render router —
 * asks the bed how wide it is, and a bed-less programme would need each of them
 * to grow a second answer for a shape that real deliveries rarely take. The cost
 * is one wasted channel on a pure-object delivery, which is stated here so it is
 * a decision rather than a surprise.
 *
 * The delivered channel order is the bed in its layout order, then the objects
 * in authored order. Each object takes exactly one channel, because an object
 * with a position is a point source — a stereo object is two objects.
 *
 * **The authored gain is applied by the render and is deliberately not written
 * into the file.** ADM can carry a gain in the block format, and a renderer that
 * found one there would apply it to samples that already carry it.
 */

export interface AdmObjectPosition {
	/** Degrees, ADM convention: positive azimuth to the left, elevation up. */
	readonly azimuth: number;
	readonly elevation: number;
	/** Normalized distance from the listener, where 1 is the reference radius. */
	readonly distance: number;
}

export interface AdmAuthoredObject {
	readonly id: string;
	readonly name: string;
	readonly stripKind: AdmTerminalStripKind;
	readonly stripId: string;
	/** Zero-based channel index at the output of the terminal strip. */
	readonly sourceChannel: number;
	readonly gain: number;
	readonly position: AdmObjectPosition;
}

/**
 * The widest authored delivery, bed and objects together.
 *
 * The render graph clamps a mix at 32 channels, so a wider programme would
 * author a delivery that cannot be rendered. Refusing here says so at the point
 * the operator can still act on it.
 */
export const ADM_AUTHORED_MAXIMUM_CHANNELS = 32;

export function normalizeAdmAuthoredObjects(
	value: unknown,
	bedChannelCount: number,
): readonly AdmAuthoredObject[] {
	if (value == null) return Object.freeze([]);
	if (!Array.isArray(value)) throw new TypeError('project.metadata.adm.objects must be an array.');
	const maximum = ADM_AUTHORED_MAXIMUM_CHANNELS - bedChannelCount;
	if (value.length > maximum) {
		throw new RangeError(
			`An authored ADM delivery carries at most ${ADM_AUTHORED_MAXIMUM_CHANNELS} channels, `
			+ `so a ${bedChannelCount}-channel bed leaves room for ${maximum} objects.`,
		);
	}
	const ids = new Set<string>();
	return Object.freeze(value.map((candidate, index) => {
		const item = objectValue(candidate, `project.metadata.adm.objects[${index}]`);
		const id = nonEmptyText(item.id, `ADM object ${index} ID`, MAX_ADM_NAME_BYTES);
		if (ids.has(id)) throw new RangeError(`Duplicate ADM object ID: ${id}.`);
		ids.add(id);
		const position = objectValue(item.position, `project.metadata.adm.objects[${index}].position`);
		return Object.freeze({
			id,
			name: nonEmptyText(item.name, `ADM object ${index} name`, MAX_ADM_NAME_BYTES),
			stripKind: enumValue(item.stripKind, ['track', 'group', 'send'], `ADM object ${index} strip kind`),
			stripId: nonEmptyText(item.stripId, `ADM object ${index} strip ID`, MAX_ADM_NAME_BYTES),
			sourceChannel: safeInteger(item.sourceChannel, 0, 65_535, `ADM object ${index} source channel`),
			gain: finiteNumber(item.gain ?? 1, 0, 4, `ADM object ${index} gain`),
			position: Object.freeze({
				azimuth: finiteNumber(position.azimuth ?? 0, -180, 180, `ADM object ${index} azimuth`),
				elevation: finiteNumber(position.elevation ?? 0, -90, 90, `ADM object ${index} elevation`),
				distance: finiteNumber(position.distance ?? 1, 0, 1, `ADM object ${index} distance`),
			}),
		});
	}));
}

/** The identifiers an authored object programme writes into its own AXML. */
export function admObjectFormatIds(index: number): Readonly<{
	object: string;
	pack: string;
	channel: string;
	block: string;
}> {
	// Type 0003 is the Objects type definition; values from 0x1001 are the custom
	// range, which is where a file's own definitions belong.
	const suffix = (0x1001 + index).toString(16).toUpperCase().padStart(4, '0');
	const channel = `AC_0003${suffix}`;
	return Object.freeze({
		object: `AO_${suffix}`,
		pack: `AP_0003${suffix}`,
		channel,
		block: `AB_0003${suffix}_00000001`,
	});
}
