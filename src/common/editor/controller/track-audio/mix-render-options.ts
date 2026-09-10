/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MixRenderOptions {
	readonly mixDown: boolean;
	readonly mixDownChannelCount?: number;
	readonly renderEffects: boolean;
	readonly replaceOriginals: boolean;
}

export interface NormalizedMixRenderOptions {
	readonly mixDown: boolean;
	readonly mixDownChannelCount: number | null;
	readonly renderEffects: boolean;
	readonly replaceOriginals: boolean;
}

const OPTION_KEYS = ['mixDown', 'renderEffects', 'replaceOriginals'] as const;

export function normalizeMixRenderOptions(
	options: MixRenderOptions | undefined = undefined,
): Readonly<NormalizedMixRenderOptions> {
	if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) {
		throw new TypeError('Mix and Render options must be an object.');
	}
	if (options === undefined) {
		return Object.freeze({
			mixDown: true,
			mixDownChannelCount: null,
			renderEffects: true,
			replaceOriginals: true,
		});
	}
	const requested = options;
	for (const key of OPTION_KEYS) {
		if (typeof requested[key] !== 'boolean') {
			throw new TypeError(`Mix and Render option ${key} must be a boolean.`);
		}
	}
	const requestedChannelCount = requested.mixDownChannelCount;
	if (requestedChannelCount !== undefined && (
		!Number.isSafeInteger(requestedChannelCount)
		|| requestedChannelCount < 1
		|| requestedChannelCount > 32
	)) {
		throw new RangeError('Mix and Render output channel count must be an integer from 1 through 32.');
	}
	const normalized = Object.freeze({
		mixDown: requested.mixDown,
		mixDownChannelCount: requestedChannelCount ?? null,
		renderEffects: requested.renderEffects,
		replaceOriginals: requested.replaceOriginals,
	});
	if (!normalized.mixDown && !normalized.renderEffects) {
		throw new RangeError('Mix and Render must mix down, render effects, or both.');
	}
	return normalized;
}
