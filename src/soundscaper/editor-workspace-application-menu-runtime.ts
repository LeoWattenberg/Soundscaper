/* SPDX-License-Identifier: AGPL-3.0-only */

export function useProductNativeServicesMenuRefresh(
	_input: Readonly<{ readonly productId: string }>,
): void {}

export function createProductWorkspaceApplicationMenuRuntime(): Readonly<Record<string, null>> {
	return Object.freeze({
		framescaperNativeServices: null,
		framescaperCandidateAuthoring: null,
		openFramescaperFinishing: null,
	});
}
