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
	readonly cancelEffectMacro: RuntimeAction;
	readonly getProject: () => unknown;
	readonly projectSampleRate: () => number;
	readonly timelineDurationFrames: () => number;
	readonly setExactSelection: (
		startFrame: number, endFrame: number, details?: Readonly<Record<string, unknown>>,
	) => unknown;
	readonly beginMacroTransaction: () => Readonly<{
		commit(command: Readonly<Record<string, unknown>>): unknown;
		rollback(): unknown;
	}>;
	readonly copy: Readonly<Record<string, string>>;
	readonly productId?: string;
	readonly locale?: string;
	readonly onMacroScriptLog?: (entry: Readonly<{
		readonly level: 'info' | 'warn' | 'error'; readonly text: string; readonly at: number;
	}>) => void;
	readonly macroScriptStartedAt?: () => string;
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
	// The sequencer owns the order of a macro's steps; the effect runner keeps its
	// job of turning one run of effects into audio, and the command service keeps
	// Audacity's selection arithmetic.
	const commands = createMacroCommandService({
		getProject: scope.getProject as () => never,
		projectSampleRate: scope.projectSampleRate,
		timelineDurationFrames: scope.timelineDurationFrames,
		setExactSelection: scope.setExactSelection,
	});
	const program = createMacroProgramService({
		runEffectMacro: scope.runEffectMacro as never,
		cancelEffectMacro: scope.cancelEffectMacro as unknown as () => boolean,
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
	} as never);
	const scriptHost = createMacroScriptHost({
		getProject: scope.getProject as () => never,
		projectSampleRate: scope.projectSampleRate,
		runEffectMacro: scope.runEffectMacro as never,
		runMacroCommand: commands.runMacroCommand as never,
		setExactSelection: scope.setExactSelection,
		listSavedMacros: () => library.list() as never,
		beginMacroTransaction: scope.beginMacroTransaction,
	});
	let sandbox: Sandbox | null = null;
	return Object.freeze({
		run: restricted('audioMacros', program.runMacroProgram as unknown as RuntimeAction),
		cancel: restricted('audioMacros', ((...args: never[]) => {
			sandbox?.cancelMacroSandbox();
			return (program.cancelMacroProgram as (...values: never[]) => unknown)(...args);
		}) as RuntimeAction),
		runScript: restricted('audioMacros', (async (request: unknown) => {
			const { name, source } = readScriptRequest(request, scope);
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
		}) as RuntimeAction),
		scripts: Object.freeze({
			list: restricted('audioMacros', () => scripts.list()),
			save: restricted('audioMacros', ((script: unknown) => scripts.save(script)) as RuntimeAction),
			delete: restricted('audioMacros', ((scriptId: unknown) => scripts.delete(scriptId as string)) as RuntimeAction),
			flush: () => scripts.flush(),
		}),
		library: Object.freeze({
			list: restricted('audioMacros', () => library.list()),
			save: restricted('audioMacros', ((macro: unknown) => library.save(macro)) as RuntimeAction),
			delete: restricted('audioMacros', ((macroId: unknown) => library.delete(macroId as string)) as RuntimeAction),
			flush: () => library.flush(),
		}),
	});
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
