/* SPDX-License-Identifier: AGPL-3.0-only */

type Data = Readonly<Record<string, unknown>>;

export type FramescaperSupplementalVisualIdentityFinishing = Readonly<{
	readonly trackId: string;
	readonly sourceId: string;
	readonly clipId: string;
}>;

export function validatedFramescaperSupplementalPictureIdsFinishing(
	values: readonly unknown[],
	visuals: ReadonlyMap<string, FramescaperSupplementalVisualIdentityFinishing>,
	activeVisualIds: ReadonlySet<string>,
): ReadonlySet<string> {
	const result = new Set<string>();
	for (const value of values) {
		const { clipId } = framescaperSupplementalPictureIdentityFinishing(
			value, visuals, activeVisualIds,
		);
		if (result.has(clipId)) {
			throw new Error(`Selected finishing supplemental picture ${clipId} is duplicated.`);
		}
		result.add(clipId);
	}
	return result;
}

export function framescaperSupplementalPictureIdentityFinishing(
	value: unknown,
	visuals: ReadonlyMap<string, FramescaperSupplementalVisualIdentityFinishing>,
	activeVisualIds: ReadonlySet<string>,
): FramescaperSupplementalVisualIdentityFinishing {
	const picture = record(value, 'Selected finishing supplemental picture');
	const clipId = stableId(picture.clipId, 'Selected finishing supplemental clip ID');
	const sourceId = stableId(picture.sourceId, 'Selected finishing supplemental source ID');
	const trackId = stableId(picture.trackId, 'Selected finishing supplemental track ID');
	const visual = visuals.get(clipId);
	if (!visual || !activeVisualIds.has(clipId)
		|| visual.trackId !== trackId || visual.sourceId !== sourceId || visual.clipId !== clipId) {
		throw new Error(`Selected finishing supplemental picture ${clipId} changed exact visual authority.`);
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
