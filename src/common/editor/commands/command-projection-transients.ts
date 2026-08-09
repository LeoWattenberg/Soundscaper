/* SPDX-License-Identifier: AGPL-3.0-only */

/** Marks a command-only video placement that has already been conformed in sequence-frame space. */
export const CONFORMED_SEQUENCE_PLACEMENT: unique symbol = Symbol('conformed-sequence-placement');

/** Identifies clips whose timing mutations came from the same non-batch editor command. */
export const FOUNDATION_EDIT_OPERATION: unique symbol = Symbol('foundation-edit-operation');

/** Records that a command draft received a legacy structural track mutation. */
export const LEGACY_TRACK_STRUCTURE_EDIT: unique symbol = Symbol('legacy-track-structure-edit');
