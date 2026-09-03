/* SPDX-License-Identifier: AGPL-3.0-only */

interface SpectralSelectionState {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly frequencyRange?: SpectralFrequencyRange | null;
}

interface SpectralActionProject {
	readonly id?: string;
	readonly selection?: SpectralSelectionState | null;
}

interface SpectralFrequencyRange {
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
}

interface AudacitySpectralActionDependencies {
	readonly getProject: () => SpectralActionProject | null | undefined;
	readonly setSelection: (
		startFrame: number,
		endFrame: number,
		details: Readonly<Record<string, unknown>>,
	) => unknown;
	readonly spectralActions: Readonly<{ boxSelect: (options?: SpectralFrequencyRange) => unknown }>;
	readonly openSurface: (surface: string) => unknown;
	readonly getUiFlags: () => Readonly<{ spectralBrush?: boolean }>;
	readonly setUiFlag: (name: 'spectralBrush' | 'splitTool', value: boolean) => boolean;
	readonly beforeEnableSpectralBrush?: () => unknown;
}

export function createAudacitySpectralActionRuntime(
	dependencies: AudacitySpectralActionDependencies,
) {
	const rememberedFrequencyRanges = new Map<string | undefined, SpectralFrequencyRange>();
	return Object.freeze({
		openSpectralSelection: () => dependencies.openSurface('spectral-selection'),
		toggleSpectralSelection: () => {
			const project = dependencies.getProject();
			const rememberedFrequencyRange = rememberedFrequencyRanges.get(project?.id) || null;
			const selection = project?.selection;
			if (!selection?.frequencyRange) {
				if (!rememberedFrequencyRange) return dependencies.spectralActions.boxSelect();
				if (!selection) return dependencies.spectralActions.boxSelect(rememberedFrequencyRange);
				return dependencies.setSelection(selection.startFrame, selection.endFrame, {
					trackIds: selection.trackIds || [],
					frequencyRange: rememberedFrequencyRange,
				});
			}
			rememberedFrequencyRanges.set(project?.id, {
				minimumFrequency: selection.frequencyRange.minimumFrequency,
				maximumFrequency: selection.frequencyRange.maximumFrequency,
			});
			return dependencies.setSelection(selection.startFrame, selection.endFrame, {
				trackIds: selection.trackIds || [],
				frequencyRange: null,
			});
		},
		toggleSpectralBrush: () => {
			const enabled = !dependencies.getUiFlags().spectralBrush;
			if (enabled) {
				if (dependencies.beforeEnableSpectralBrush) dependencies.beforeEnableSpectralBrush();
				else dependencies.setUiFlag('splitTool', false);
			}
			return dependencies.setUiFlag('spectralBrush', enabled);
		},
	});
}
