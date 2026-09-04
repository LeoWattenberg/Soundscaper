/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEffectMacroLibraryService,
	type EffectMacroLibraryServiceRuntime,
} from './effect-macro-library-service.ts';

type RuntimeAction = (...args: never[]) => unknown;
type RestrictedAction = (capability: string, action: RuntimeAction) => RuntimeAction;

export interface EffectLibraryActionScope {
	readonly state: Readonly<Record<string, unknown>>;
	readonly createStableId: (prefix: string) => string;
	readonly persistSetting: RuntimeAction;
	readonly publishDocumentSnapshot: () => void;
	readonly handleError: (error: unknown) => void;
	readonly listAudioEditorEffectPresets: RuntimeAction;
	readonly applyEffectPreset: RuntimeAction;
	readonly saveEffectPreset: RuntimeAction;
	readonly currentAudacityEffectParams: RuntimeAction;
	readonly deleteEffectPreset: RuntimeAction;
	readonly importEffectPresets: RuntimeAction;
	readonly exportEffectPreset: RuntimeAction;
	readonly runEffectMacro: RuntimeAction;
}

/**
 * The two saved-effect libraries an editor session accumulates: presets, which
 * remember one effect's parameters, and macros, which remember a chain of them.
 * They are assembled here rather than in the legacy facade, and the macro
 * library service is built with them because nothing outside these actions
 * reaches for it.
 */
export function createEffectPresetActions(
	scope: EffectLibraryActionScope,
	restricted: RestrictedAction,
) {
	const { state } = scope;
	return Object.freeze({
		list: (effectType: unknown = state.audacityEffectType) => (
			scope.listAudioEditorEffectPresets(state.effectPresets as never, effectType as never)
		),
		apply: restricted('audioEffects', scope.applyEffectPreset),
		save: restricted('audioEffects', scope.saveEffectPreset),
		saveAs: restricted('audioEffects', ((name: unknown, params: unknown = scope.currentAudacityEffectParams()) => (
			scope.saveEffectPreset({ name, params } as never)
		)) as RuntimeAction),
		delete: restricted('audioEffects', scope.deleteEffectPreset),
		import: restricted('audioEffects', scope.importEffectPresets),
		export: restricted('audioEffects', scope.exportEffectPreset),
	});
}

/** The macro runner and the saved macro library behind the macro manager. */
export function createEffectMacroActions(
	scope: EffectLibraryActionScope,
	restricted: RestrictedAction,
) {
	const library = createEffectMacroLibraryService({
		state: scope.state,
		createId: scope.createStableId,
		persistSetting: scope.persistSetting,
		publishDocumentSnapshot: scope.publishDocumentSnapshot,
		handleError: scope.handleError,
	} as unknown as EffectMacroLibraryServiceRuntime);
	return Object.freeze({
		run: restricted('audioMacros', scope.runEffectMacro),
		library: Object.freeze({
			list: restricted('audioMacros', () => library.list()),
			save: restricted('audioMacros', ((macro: unknown) => library.save(macro)) as RuntimeAction),
			delete: restricted('audioMacros', ((macroId: unknown) => library.delete(macroId as string)) as RuntimeAction),
			flush: () => library.flush(),
		}),
	});
}
