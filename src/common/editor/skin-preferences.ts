/* SPDX-License-Identifier: AGPL-3.0-only */

export const SKIN_IDS = ['default', 'sakura', 'lilac', 'techno'] as const;
export type SkinId = typeof SKIN_IDS[number];

export function isSkinId(value: unknown): value is SkinId {
	return typeof value === 'string' && SKIN_IDS.some((id) => id === value);
}

export function normalizeSkin(value: unknown): SkinId {
	return isSkinId(value) ? value : 'default';
}
