/* SPDX-License-Identifier: AGPL-3.0-only */

interface SpectralSelectionState {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly frequencyRange?: Readonly<Record<string, number>> | null;
}

interface SpectralActionProject {
	readonly selection?: SpectralSelectionState | null;
}

interface AudacitySpectralActionDependencies {
	readonly getProject: () => SpectralActionProject | null | undefined;
	readonly setSelection: (
		startFrame: number,
		endFrame: number,
		details: Readonly<Record<string, unknown>>,
	) => unknown;
	readonly spectralActions: Readonly<{ boxSelect: () => unknown }>;
	readonly openSurface: (surface: string) => unknown;
	readonly getUiFlags: () => Readonly<{ spectralBrush?: boolean }>;
	readonly setUiFlag: (name: string, value: boolean) => boolean;
}

export function createAudacitySpectralActionRuntime(
	dependencies: AudacitySpectralActionDependencies,
) {
	return Object.freeze({
		openSpectralSelection: () => dependencies.openSurface('spectral-selection'),
		toggleSpectralSelection: () => {
			const selection = dependencies.getProject()?.selection;
			if (!selection?.frequencyRange) return dependencies.spectralActions.boxSelect();
			return dependencies.setSelection(selection.startFrame, selection.endFrame, {
				trackIds: selection.trackIds || [],
				frequencyRange: null,
			});
		},
		toggleSpectralBrush: () => {
			const enabled = !dependencies.getUiFlags().spectralBrush;
			if (enabled) dependencies.setUiFlag('splitTool', false);
			return dependencies.setUiFlag('spectralBrush', enabled);
		},
	});
}
