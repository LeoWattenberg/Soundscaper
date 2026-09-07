/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createMacroCommandService,
	isRunnableMacroCommand,
} from './macro-command-service.ts';
import { createMacroProgramService } from './macro-program-service.ts';
import { createMacroScriptHost } from './macro-script-host.ts';
import { createMacroScriptLibraryService } from './macro-script-library-service.ts';
import {
	createEffectMacroLibraryService,
} from './effect-macro-library-service.ts';

import type { EditorActionFunctions } from './editor-action-functions.ts';
import type { EditorActionResources } from './editor-action-resources.ts';
import type { RestrictToCapability } from './action-facade-runtime.ts';

export type EffectLibraryActionScope = Pick<EditorActionFunctions,
	 'createStableId'
	| 'persistSetting'
	| 'publishDocumentSnapshot'
	| 'handleError'
	| 'listAudioEditorEffectPresets'
	| 'applyEffectPreset'
	| 'saveEffectPreset'
	| 'currentAudacityEffectParams'
	| 'deleteEffectPreset'
	| 'importEffectPresets'
	| 'exportEffectPreset'
	| 'runEffectMacro'
	| 'cancelEffectMacro'
	| 'getProject'
	| 'projectSampleRate'
	| 'timelineDurationFrames'
	| 'setExactSelection'
	| 'beginMacroTransaction'
> & Pick<EditorActionResources, 'state' | 'copy' | 'productId' | 'locale' | 'onMacroScriptLog' | 'macroScriptStartedAt'> & {
	readonly getEditorActions?: () => Readonly<Record<string, unknown>> | null;
};

/**
 * The two saved-effect libraries an editor session accumulates: presets, which
 * remember one effect's parameters, and macros, which remember a chain of them.
 * They are assembled here rather than in the legacy facade, and the macro
 * library service is built with them because nothing outside these actions
 * reaches for it.
 */
export function createEffectPresetActions(
	scope: EffectLibraryActionScope,
	restricted: RestrictToCapability,
) {
	const { state } = scope;
	return Object.freeze({
		list: (effectType: string = state.audacityEffectType) => (
			scope.listAudioEditorEffectPresets(state.effectPresets, effectType)
		),
		apply: restricted('audioEffects', scope.applyEffectPreset),
		save: restricted('audioEffects', scope.saveEffectPreset),
		saveAs: restricted('audioEffects', ((name: string, params: Readonly<Record<string, unknown>> = scope.currentAudacityEffectParams()) => (
			scope.saveEffectPreset({ name, params })
		))),
		delete: restricted('audioEffects', scope.deleteEffectPreset),
		import: restricted('audioEffects', scope.importEffectPresets),
		export: restricted('audioEffects', scope.exportEffectPreset),
	});
}

/** The macro runner and the saved macro library behind the macro manager. */
export function createEffectMacroActions(
	scope: EffectLibraryActionScope,
	restricted: RestrictToCapability,
) {
	const library = createEffectMacroLibraryService({
		state: scope.state,
		createId: scope.createStableId,
		persistSetting: scope.persistSetting,
		publishDocumentSnapshot: scope.publishDocumentSnapshot,
		handleError: scope.handleError,
	});
	// The sequencer owns the order of a macro's steps; the effect runner keeps its
	// job of turning one run of effects into audio, and the command service keeps
	// Audacity's selection arithmetic.
	// The action tree is read at call time rather than captured, because these
	// groups are built while it is still being assembled.
	let actions: Readonly<Record<string, unknown>> | null = null;
	const commands = createMacroCommandService({
		getProject: () => {
			const project = scope.getProject();
			if (!project) throw new Error('A project is required to run a macro.');
			return project;
		},
		projectSampleRate: scope.projectSampleRate,
		timelineDurationFrames: scope.timelineDurationFrames,
		setExactSelection: scope.setExactSelection,
		getActions: () => actions ?? scope.getEditorActions?.() ?? null,
	});
	const program = createMacroProgramService({
		runEffectMacro: scope.runEffectMacro,
		cancelEffectMacro: scope.cancelEffectMacro,
		runMacroCommand: commands.runMacroCommand,
		beginMacroTransaction: scope.beginMacroTransaction,
		isRunnableMacroCommand,
		untitledMacroName: scope.copy.untitledMacro || scope.copy.macroManager || 'Untitled macro',
	});
	const scripts = createMacroScriptLibraryService({
		state: scope.state,
		createId: scope.createStableId,
		persistSetting: scope.persistSetting,
		publishDocumentSnapshot: scope.publishDocumentSnapshot,
		handleError: scope.handleError,
	});
	const scriptHost = createMacroScriptHost({
		getProject: scope.getProject,
		projectSampleRate: scope.projectSampleRate,
		runEffectMacro: scope.runEffectMacro,
		runMacroCommand: commands.runMacroCommand,
		setExactSelection: scope.setExactSelection,
		listSavedMacros: () => library.list(),
		beginMacroTransaction: scope.beginMacroTransaction,
	});
	let sandbox: Sandbox | null = null;
	const group = Object.freeze({
		run: restricted('audioMacros', program.runMacroProgram),
		cancel: restricted('audioMacros', (() => {
			sandbox?.cancelMacroSandbox();
			return program.cancelMacroProgram();
		})),
		runScript: restricted('audioMacros', (async (request: unknown) => {
			const { name, source } = readScriptRequest(request, scope);
			// The gate is on the bytes, not on the record the manager happens to hold,
			// so reading an unreviewed program out of the list and passing its text
			// straight here is not a way around it.
			if (scripts.blocked(source)) throw new Error('MACRO_SCRIPT_NOT_TRUSTED');
			// The sandbox is loaded on demand: it is only reachable from the macro
			// manager, and its worker prelude has no business in the startup graph.
			const { createBrowserMacroSandbox } = await import('../macro-script/browser-sandbox.ts');
			return scriptHost.runMacroScript({
				name,
				run: async (dispatch) => {
					sandbox = createBrowserMacroSandbox({ dispatch, onLog: scope.onMacroScriptLog });
					try {
						return await sandbox.runMacroSandbox({
							runId: scope.createStableId('macro-run'),
							source,
							env: {
								productId: String(scope.productId ?? 'soundscaper'),
								locale: String(scope.locale ?? 'en'),
								seed: scope.createStableId('macro-seed'),
								startedAt: scope.macroScriptStartedAt?.() ?? '',
								dryRun: false,
							},
						});
					} finally {
						sandbox = null;
					}
				},
			});
		})),
		scripts: Object.freeze({
			list: restricted('audioMacros', () => scripts.list()),
			save: restricted('audioMacros', ((script: unknown) => scripts.save(script))),
			delete: restricted('audioMacros', ((scriptId: string) => scripts.delete(scriptId))),
			// Importing stores text and nothing else; enabling it is a separate act.
			import: restricted('audioMacros', ((text: unknown, origin?: unknown) => scripts.import(text, origin))),
			export: restricted('audioMacros', ((scriptId: string) => scripts.export(scriptId))),
			trust: restricted('audioMacros', ((scriptId: string) => scripts.trust(scriptId))),
			blocked: (source: unknown) => scripts.blocked(String(source ?? '')),
			flush: () => scripts.flush(),
		}),
		library: Object.freeze({
			list: restricted('audioMacros', () => library.list()),
			save: restricted('audioMacros', ((macro: unknown) => library.save(macro))),
			delete: restricted('audioMacros', ((macroId: string) => library.delete(macroId))),
			flush: () => library.flush(),
		}),
		/** Lets the facade hand back the assembled tree these commands walk. */
		bindEditorActions(value: Readonly<Record<string, unknown>>) { actions = value; },
	});
	return group;
}

type Sandbox = ReturnType<
	typeof import('../macro-script/browser-sandbox.ts')['createBrowserMacroSandbox']
>;

function readScriptRequest(
	request: unknown,
	scope: EffectLibraryActionScope,
): Readonly<{ name: string; source: string }> {
	const value = request && typeof request === 'object' ? request as Record<string, unknown> : {};
	const source = typeof value.source === 'string' ? value.source : '';
	if (!source.trim()) throw new RangeError('A macro program needs source to run.');
	const name = String(value.name ?? '').trim() || scope.copy.untitledMacro || 'Untitled macro';
	return Object.freeze({ name, source });
}
