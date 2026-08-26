/* SPDX-License-Identifier: AGPL-3.0-only */

export type SpectralEditAdmissionModule = typeof import('../spectral-edit-admission.ts');
export type SpectralEditAdmissionLoader = () => Promise<SpectralEditAdmissionModule>;

const DEFAULT_LOADER: SpectralEditAdmissionLoader = () => import('../spectral-edit-admission.ts');

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
