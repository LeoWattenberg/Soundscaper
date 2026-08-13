/* SPDX-License-Identifier: AGPL-3.0-only */

declare const framescaperProjectV20ProfileIdentity: unique symbol;

/** Unselected model authority. Runtime/persistence selection is deliberately separate. */
export type FramescaperProjectV20Profile = Readonly<{
	readonly [framescaperProjectV20ProfileIdentity]: true;
}>;

export const FRAMESCAPER_V20_PROJECT_MODEL_PROFILE = Object.freeze(
	Object.create(null),
) as FramescaperProjectV20Profile;

/** Authenticate the process-local V20 model authority before document traversal. */
export function assertFramescaperProjectV20Profile(
	profile: unknown,
): asserts profile is FramescaperProjectV20Profile {
	if (profile !== FRAMESCAPER_V20_PROJECT_MODEL_PROFILE) {
		throw new TypeError('The exact Framescaper V20 model profile is required.');
	}
}
