/* SPDX-License-Identifier: AGPL-3.0-only */

type RuntimeAction = (...args: readonly unknown[]) => unknown;

export interface AudioWarpActionFacadeDependencies {
	readonly enabled: boolean;
	readonly productName: string;
	readonly service: Readonly<Record<string, unknown>>;
}

/** Capability-gated selected-clip ports; no scalar or cross-product fallback. */
export function createAudioWarpActionFacade(dependencies: AudioWarpActionFacadeDependencies) {
	const guarded = (serviceName: string): RuntimeAction => (...args) => {
		if (!dependencies.enabled) {
			throw new RangeError(`${dependencies.productName} does not support audioWarp.`);
		}
		const candidate = dependencies.service[serviceName];
		if (typeof candidate !== 'function') throw new TypeError(`Missing audio warp action: ${serviceName}.`);
		return Reflect.apply(candidate, dependencies.service, args);
	};
	return Object.freeze({
		view: guarded('view'),
		analyze: guarded('analyzeSelected'),
		createIdentityMap: guarded('createIdentityMapSelected'),
		quantize: guarded('quantizeSelected'),
		applyGroove: guarded('applyGrooveSelected'),
		clear: guarded('clearSelected'),
	});
}
