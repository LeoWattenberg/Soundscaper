/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createInitialEffectMacroLibrary,
	type EffectMacroLibraryState,
} from './effect-macro-library-service.ts';
import {
	createInitialMacroScriptLibrary,
	type MacroScriptLibraryState,
} from './macro-script-library-service.ts';
import type { EffectsCompositionState } from './effects-composition-types.ts';

type SharedEffectsCompositionField =
	| 'selectedTrackId'
	| 'selectedClipId'
	| 'readOnly'
	| 'writeAuthorityGeneration';

/**
 * Mutable state owned by the effects domain. Selection and write authority
 * remain workspace concerns that the effects composition receives read access
 * to through its scoped state view.
 */
export type ControllerEffectsState<EffectPresets> = Omit<
	EffectsCompositionState,
	SharedEffectsCompositionField | 'effectPresets'
> & {
	effectPresets: EffectPresets;
	effectMacros: EffectMacroLibraryState;
	effectMacrosReadOnly: boolean;
	macroScripts: MacroScriptLibraryState;
	macroScriptsReadOnly: boolean;
	nyquistResult: unknown;
};

export interface ControllerEffectsStateOptions<EffectPresets> {
	readonly effectPresets: EffectPresets;
	readonly initialEffectType: string;
}

export function createControllerEffectsState<EffectPresets>({
	effectPresets,
	initialEffectType,
}: ControllerEffectsStateOptions<EffectPresets>): ControllerEffectsState<EffectPresets> {
	return {
		effectClipboard: null,
		audacityEffectType: initialEffectType,
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
		effectPresets,
		effectMacros: createInitialEffectMacroLibrary(),
		effectMacrosReadOnly: false,
		macroScripts: createInitialMacroScriptLibrary(),
		macroScriptsReadOnly: false,
		rackEffectGestures: new Map(),
		parametricEqGestures: new Map(),
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		audacityPreviewSource: null,
		audacityPreviewAuditionBandId: null,
		audacityPreviewGeneration: 0,
		lastAudacityEffect: null,
		audacityEffectWorker: null,
		nyquistAbort: null,
		nyquistResult: null,
		spectralWorker: null,
	};
}

/** Capabilities used by the few non-effects coordinators that transition effect state. */
export function createControllerEffectsStatePorts<EffectPresets>(
	state: ControllerEffectsState<EffectPresets>,
) {
	return Object.freeze({
		processing: Object.freeze({
			set: (processing: boolean) => { state.audacityEffectProcessing = processing; },
		}),
		project: Object.freeze({
			beginSwitch: () => {
				state.rackEffectGestures.clear();
				state.parametricEqGestures.clear();
				state.nyquistAbort = null;
			},
			resetScope: () => {
				state.audacityNoiseProfile = null;
				state.audacityControlTrackId = null;
			},
		}),
		bootstrap: Object.freeze({
			setEffectPresets: (value: EffectPresets) => { state.effectPresets = value; },
			setEffectMacros: (value: EffectMacroLibraryState, readOnly = false) => {
				state.effectMacros = value;
				state.effectMacrosReadOnly = readOnly;
			},
			setMacroScripts: (value: MacroScriptLibraryState, readOnly = false) => {
				state.macroScripts = value;
				state.macroScriptsReadOnly = readOnly;
			},
		}),
		runtime: Object.freeze({
			takeSelectionWorker: () => {
				const worker = state.audacityEffectWorker;
				state.audacityEffectWorker = null;
				return worker;
			},
			takeSpectralWorker: () => {
				const worker = state.spectralWorker;
				state.spectralWorker = null;
				return worker;
			},
			clearNyquistAbort: () => { state.nyquistAbort = null; },
		}),
		preview: Object.freeze({
			auditionParametricEq: (bandId: string | number | null) => {
				state.audacityPreviewAuditionBandId = bandId == null ? null : String(bandId);
				const source = state.audacityPreviewSource as null | Readonly<{
					audition?: (id: string | number | null) => unknown;
				}>;
				return source?.audition?.(state.audacityPreviewAuditionBandId) ?? false;
			},
		}),
	});
}
