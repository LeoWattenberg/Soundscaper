/* SPDX-License-Identifier: AGPL-3.0-only */

type Data = Readonly<Record<string, unknown>>;

export type FramescaperSupplementalVisualIdentityV27 = Readonly<{
	readonly trackId: string;
	readonly sourceId: string;
	readonly clipId: string;
}>;

export function validatedFramescaperSupplementalPictureIdsV27(
	values: readonly unknown[],
	visuals: ReadonlyMap<string, FramescaperSupplementalVisualIdentityV27>,
	activeVisualIds: ReadonlySet<string>,
): ReadonlySet<string> {
	const result = new Set<string>();
	for (const value of values) {
		const { clipId } = framescaperSupplementalPictureIdentityV27(
			value, visuals, activeVisualIds,
		);
		if (result.has(clipId)) {
			throw new Error(`Selected V27 supplemental picture ${clipId} is duplicated.`);
		}
		result.add(clipId);
	}
	return result;
}

export function framescaperSupplementalPictureIdentityV27(
	value: unknown,
	visuals: ReadonlyMap<string, FramescaperSupplementalVisualIdentityV27>,
	activeVisualIds: ReadonlySet<string>,
): FramescaperSupplementalVisualIdentityV27 {
	const picture = record(value, 'Selected V27 supplemental picture');
	const clipId = stableId(picture.clipId, 'Selected V27 supplemental clip ID');
	const sourceId = stableId(picture.sourceId, 'Selected V27 supplemental source ID');
	const trackId = stableId(picture.trackId, 'Selected V27 supplemental track ID');
	const visual = visuals.get(clipId);
	if (!visual || !activeVisualIds.has(clipId)
		|| visual.trackId !== trackId || visual.sourceId !== sourceId || visual.clipId !== clipId) {
		throw new Error(`Selected V27 supplemental picture ${clipId} changed exact visual authority.`);
	}
	return Object.freeze({ clipId, sourceId, trackId });
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Data;
}
