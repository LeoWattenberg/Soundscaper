/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The plan versions this build accepts.
 *
 * Both the plan's public assertions and its canonical reduction have to agree on this list,
 * and it lives apart from either so neither has to import the other to read it.
 */
export const UNIFIED_EXACT_RENDER_PLAN_VERSIONS = Object.freeze([9, 10, 11, 12, 13, 14, 15] as const);
