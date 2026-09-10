/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Shared refusal plumbing for optional controller domains.
 *
 * A product may leave a domain uncomposed while its actions and shortcuts stay
 * registered. The owning domain supplies a stand-in with the real service's
 * shape; attempted work raises this capability-style error, while that domain
 * keeps cancellation members as harmless no-ops for unconditional teardown.
 */
export interface AbsentSubsystemContext {
	/** Product display name included in the refusal. */
	readonly productName: string;
}

/** Raise the same capability-shaped error for every uncomposed domain. */
export function refuseAbsentSubsystem(context: AbsentSubsystemContext, domain: string): never {
	throw new RangeError(`${context.productName} does not compose the ${domain} subsystem.`);
}

/** Build a synchronous refusal while preserving the unavailable service's call shape. */
export function createAbsentSubsystemRefusal(context: AbsentSubsystemContext, domain: string) {
	return (..._args: readonly unknown[]): never => refuseAbsentSubsystem(context, domain);
}

/** Build an asynchronous refusal while preserving the unavailable service's call shape. */
export function createAsyncAbsentSubsystemRefusal(context: AbsentSubsystemContext, domain: string) {
	return async (..._args: readonly unknown[]): Promise<never> => refuseAbsentSubsystem(context, domain);
}
