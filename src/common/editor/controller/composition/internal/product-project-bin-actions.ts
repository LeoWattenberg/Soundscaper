/* SPDX-License-Identifier: AGPL-3.0-only */

/** Owned media leaves can share bin actions without entering the A/V projection. */
export interface ProductProjectBinActions {
	moveFromTimeline(clipId?: string | readonly (string | null | undefined)[] | null): readonly string[] | null | undefined;
	place(clipId: string, placement?: Readonly<{ trackId?: string | null; timelineStartFrame?: unknown }>): string | null | undefined;
	rename?(clipId: string, name: unknown): string | null | undefined;
	removeFromBin?(clipId: string): string | null | undefined;
	removeFromProject?(clipId: string): readonly string[] | null | undefined;
	selectInstances?(clipId: string): readonly string[] | null | undefined;
	instanceCount?(clipId: string): number | undefined;
}

const OWNERS = new WeakMap<object, (runtime: ProductProjectBinActions) => void>();

export function registerProductProjectBinActionGroup(
	owner: object, bind: (runtime: ProductProjectBinActions) => void,
): void {
	OWNERS.set(owner, bind);
}

export function bindProductProjectBinActions(owner: object, runtime: ProductProjectBinActions): void {
	const bind = OWNERS.get(owner);
	if (!bind) throw new TypeError('Product bin actions require the controller-owned bin group.');
	bind(runtime);
}

/** The public lifetime fence copies groups while retaining their owning binding. */
export function inheritProductProjectBinActionGroup(owner: object, publicGroup: object): void {
	const bind = OWNERS.get(owner);
	if (bind) OWNERS.set(publicGroup, bind);
}
