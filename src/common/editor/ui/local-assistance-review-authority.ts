/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The review-authority derivation moved to the controller layer, where the guided path
 * already keeps its own and where editor core is allowed to reach it. This re-export keeps
 * the session stores importing it from the same place they always have.
 */

export { deriveLocalAssistanceReviewAuthority } from
	'../controller/local-assistance-review-authority.ts';
