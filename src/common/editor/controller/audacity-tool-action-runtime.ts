/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudacitySpectralActionRuntime } from './audacity-spectral-action-runtime.ts';

const EXCLUSIVE_UI_TOOL_FLAGS = Object.freeze([
	'automationTool',
	'spectralBrush',
	'splitTool',
] as const);
const CLIP_PITCH_STEP_CENTS = 100;
const CLIP_PITCH_LIMIT_CENTS = 1_200;

type ExclusiveUiToolFlag = (typeof EXCLUSIVE_UI_TOOL_FLAGS)[number];

interface ToolActionSnapshot {
	readonly sampleEdit?: Readonly<{ available?: boolean; mode?: string | null }>;
}

interface SpectralSelectionState {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly frequencyRange?: Readonly<{
		minimumFrequency: number;
		maximumFrequency: number;
	}> | null;
}

interface AudacityToolActionDependencies {
	readonly getSnapshot: () => ToolActionSnapshot;
	readonly setSampleEditMode: (mode: 'pencil' | null) => unknown;
	readonly getProject: () => Readonly<{
		readonly id?: string;
		readonly selection?: SpectralSelectionState | null;
	}> | null | undefined;
	readonly setSelection: (
		startFrame: number,
		endFrame: number,
		details: Readonly<Record<string, unknown>>,
	) => unknown;
	readonly spectralActions: Readonly<{
		readonly boxSelect: (options?: Readonly<{
			minimumFrequency: number;
			maximumFrequency: number;
		}>) => unknown;
	}>;
	readonly openSurface: (surface: string) => unknown;
	readonly getUiFlags: () => Readonly<Partial<Record<ExclusiveUiToolFlag, boolean>>>;
	readonly setUiFlag: (name: ExclusiveUiToolFlag, value: boolean) => boolean;
}

interface SelectedPitchClip {
	readonly id: string;
	readonly kind?: unknown;
	readonly pitchCents?: unknown;
}

interface AudacityClipPitchActionDependencies {
	readonly getSelectedClip: () => SelectedPitchClip | null | undefined;
	readonly setTimePitch: (
		clipId: string,
		changes: Readonly<{ pitchCents: number }>,
	) => unknown;
}

export function createAudacityToolActionRuntime(
	dependencies: AudacityToolActionDependencies,
) {
	function setUiFlag(name: ExclusiveUiToolFlag, value: boolean): boolean {
		if (Boolean(dependencies.getUiFlags()[name]) === value) return value;
		return dependencies.setUiFlag(name, value);
	}

	function clearUiTools(except: ExclusiveUiToolFlag | null = null): void {
		for (const name of EXCLUSIVE_UI_TOOL_FLAGS) {
			if (name !== except) setUiFlag(name, false);
		}
	}

	function clearExclusiveTools(except: ExclusiveUiToolFlag | null = null): void {
		if (dependencies.getSnapshot().sampleEdit?.mode === 'pencil') {
			dependencies.setSampleEditMode(null);
		}
		clearUiTools(except);
	}

	function toggleUiTool(name: ExclusiveUiToolFlag): boolean {
		const enabled = !dependencies.getUiFlags()[name];
		if (enabled) clearExclusiveTools(name);
		return setUiFlag(name, enabled);
	}

	const spectral = createAudacitySpectralActionRuntime({
		getProject: dependencies.getProject,
		setSelection: dependencies.setSelection,
		spectralActions: dependencies.spectralActions,
		openSurface: dependencies.openSurface,
		getUiFlags: dependencies.getUiFlags,
		setUiFlag: dependencies.setUiFlag,
		beforeEnableSpectralBrush: () => clearExclusiveTools('spectralBrush'),
	});

	return Object.freeze({
		...spectral,
		selectTool: () => clearExclusiveTools(),
		drawTool: () => {
			if (dependencies.getSnapshot().sampleEdit?.available !== true) return null;
			clearUiTools();
			return dependencies.setSampleEditMode('pencil');
		},
		synchronizeDrawTool: () => clearUiTools(),
		toggleAutomationTool: () => toggleUiTool('automationTool'),
		toggleSplitTool: () => toggleUiTool('splitTool'),
	});
}

export function createAudacityClipPitchActionRuntime(
	dependencies: AudacityClipPitchActionDependencies,
) {
	function adjust(direction: -1 | 1): unknown {
		const clip = dependencies.getSelectedClip();
		if (clip?.kind !== 'audio') return null;
		const current = Number.isFinite(Number(clip.pitchCents)) ? Number(clip.pitchCents) : 0;
		const next = current + direction * CLIP_PITCH_STEP_CENTS;
		if (next < -CLIP_PITCH_LIMIT_CENTS || next > CLIP_PITCH_LIMIT_CENTS) return null;
		return dependencies.setTimePitch(clip.id, { pitchCents: next });
	}

	return Object.freeze({
		pitchUp: () => adjust(1),
		pitchDown: () => adjust(-1),
	});
}
