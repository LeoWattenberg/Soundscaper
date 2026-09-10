/* SPDX-License-Identifier: AGPL-3.0-only */

type RuntimeAction = (...args: readonly unknown[]) => unknown;

export interface TakeCompActionFacadeDependencies {
	readonly enabled: boolean;
	readonly productName: string;
	readonly service: Readonly<Record<string, unknown>>;
}

/** Capability-gated public ports for every persistent and audition take operation. */
export function createTakeCompActionFacade(dependencies: TakeCompActionFacadeDependencies) {
	const guarded = (name: string): RuntimeAction => (...args) => {
		if (!dependencies.enabled) {
			throw new RangeError(`${dependencies.productName} does not support takeComp.`);
		}
		const candidate = dependencies.service[name];
		if (typeof candidate !== 'function') throw new TypeError(`Missing take comp action: ${name}.`);
		return Reflect.apply(candidate, dependencies.service, args);
	};
	return Object.freeze({
		createGroup: guarded('createGroup'),
		updateGroup: guarded('updateGroup'),
		removeGroup: guarded('removeGroup'),
		auditionTake: guarded('auditionTake'),
		auditionLane: guarded('auditionLane'),
		stopAudition: guarded('stopAudition'),
		promoteTake: guarded('promoteTake'),
		editCompBoundary: guarded('editCompBoundary'),
		editSharedCompBoundary: guarded('editSharedCompBoundary'),
		flatten: guarded('flatten'),
	});
}
