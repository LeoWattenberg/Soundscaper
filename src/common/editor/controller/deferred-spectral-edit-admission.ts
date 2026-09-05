/* SPDX-License-Identifier: AGPL-3.0-only */

export type SpectralEditAdmissionModule = typeof import('../spectral-edit-admission.ts');
export type SpectralEditAdmissionLoader = () => Promise<SpectralEditAdmissionModule>;

const DEFAULT_LOADER: SpectralEditAdmissionLoader = () => import('../spectral-edit-admission.ts');

/**
 * A cached module load rather than a facade: the callers want the admission
 * module itself, and they await it before branching on what it exports, so
 * there is no method surface for `createDeferredModuleFacade` to stand in for.
 */
export function createDeferredSpectralEditAdmissionLoader(
	loadModule: SpectralEditAdmissionLoader = DEFAULT_LOADER,
) {
	let modulePromise: Promise<SpectralEditAdmissionModule> | null = null;
	return () => {
		modulePromise ??= Promise.resolve().then(loadModule);
		return modulePromise;
	};
}

export const loadDeferredSpectralEditAdmission = createDeferredSpectralEditAdmissionLoader();
