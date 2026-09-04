/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The types the editor action facade and its extracted groups share.
 *
 * They live apart from `action-facade.ts` so a group module can describe the runtime it
 * reads without importing the composition root that assembles every group.
 */
export interface EditorActionRuntime {
	// The runtime composition root is JavaScript while it is being decomposed.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

export type RuntimeValue = EditorActionRuntime[string];

/** Wrap an action so it refuses to run unless the product declares the named capability. */
export type RestrictToCapability = (capability: RuntimeValue, action: RuntimeValue) => RuntimeValue;
