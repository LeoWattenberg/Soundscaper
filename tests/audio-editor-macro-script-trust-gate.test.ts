/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEffectMacroActions,
	type EffectLibraryActionScope,
} from '../src/common/editor/controller/effects/effect-library-action-groups.ts';
import { createEffectMacroLibrary } from '../src/common/editor/effect-macro-library.js';
import { createMacroScriptLibrary } from '../src/common/editor/macro-script-library.ts';
import { serializeMacroScriptEnvelope } from '../src/common/editor/macro-script-envelope.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE, EditorControllerLifetime, type EditorTaskScope,
} from '../src/common/editor/controller/shared/lifecycle.ts';

interface MacroScriptRecord {
	readonly id: string;
	readonly name: string;
	readonly trust: string;
	readonly origin: unknown;
	readonly trustedSource: unknown;
}

/**
 * What this test drives. The action group describes its members as the
 * capability wrapper leaves them — arguments withheld — so the fixture states
 * the calls it makes rather than casting at each one.
 */
interface MacroScriptActions {
	readonly scripts: Readonly<{
		import: (envelope: string, fileName?: string) => MacroScriptRecord;
		trust: (id: string) => unknown;
		blocked: (source: string) => boolean;
		list: () => readonly MacroScriptRecord[];
		export: (id: string) => string;
	}>;
	readonly runScript: (script: Readonly<{ name: string; source: string }>) => Promise<unknown>;
}

function createMacroActions(options: Readonly<{
	startMacroScriptTask?: () => EditorTaskScope;
	beginMacroTransaction?: () => Readonly<{
		assertCurrent(): void;
		commit(): void;
		rollback(): void;
	}>;
}> = {}): MacroScriptActions {
	let minted = 0;
	const lifetime = new EditorControllerLifetime();
	const state = {
		effectMacros: createEffectMacroLibrary(),
		macroScripts: createMacroScriptLibrary(),
	};
	return createEffectMacroActions({
		effectLibraryState: state,
		createStableId: (prefix: string) => `${prefix}-${++minted}`,
		persistSetting: async () => {},
		publishDocumentSnapshot: () => {},
		handleError: (error: unknown) => { throw error; },
		copy: { untitledMacro: 'Untitled macro' },
		getProject: () => ({ tracks: [], selection: null }),
		projectSampleRate: () => 48_000,
		timelineDurationFrames: () => 0,
		setExactSelection: () => undefined,
		beginMacroTransaction: options.beginMacroTransaction ?? (() => ({
			assertCurrent: () => undefined, commit: () => undefined, rollback: () => undefined,
		})),
		startMacroScriptTask: options.startMacroScriptTask ?? (() => lifetime.startTask(
			'macro-script', { scope: EDITOR_PROJECT_TASK_SCOPE },
		)),
		cancelEffectMacro: () => false,
	} as unknown as EffectLibraryActionScope,
	(_capability, action) => action,
	) as unknown as MacroScriptActions;
}

test('a program nobody has reviewed does not run, however it reaches the runner', async () => {
	// The gate is on the bytes rather than on the record the manager happens to
	// hold, so reading the unreviewed program out of the list and handing its
	// text straight to the runner is not a way around it.
	const macros = createMacroActions();
	const imported = macros.scripts.import(
		serializeMacroScriptEnvelope({ name: 'Sweep', source: 'await sound.select.all();' }),
		'sweep.soundscapemacro',
	);
	assert.equal(imported.trust, 'imported-untrusted');
	assert.equal(macros.scripts.blocked('await sound.select.all();'), true);
	await assert.rejects(
		() => macros.runScript({ name: 'Sweep', source: 'await sound.select.all();' }),
		/MACRO_SCRIPT_NOT_TRUSTED/u,
	);

	// Importing stores text and grants nothing; enabling it is a separate act,
	// and it is what lifts the gate.
	macros.scripts.trust(imported.id);
	assert.equal(macros.scripts.blocked('await sound.select.all();'), false);
});

test('a project lifecycle cancellation stops a script during sandbox loading', async () => {
	const lifetime = new EditorControllerLifetime();
	let rolledBack = false;
	const macros = createMacroActions({
		startMacroScriptTask: () => lifetime.startTask('macro-script', { scope: EDITOR_PROJECT_TASK_SCOPE }),
		beginMacroTransaction: () => ({
			assertCurrent: () => undefined,
			commit: () => { throw new Error('A cancelled script must not commit.'); },
			rollback: () => { rolledBack = true; },
		}),
	});
	const run = macros.runScript({ name: 'Old project', source: 'await sound.select.none();' });
	lifetime.cancelScope(EDITOR_PROJECT_TASK_SCOPE);
	await assert.rejects(run, (error: Error) => error.name === 'AbortError');
	assert.equal(rolledBack, true);
});

test('importing a program never runs it and never grants it anything', () => {
	const macros = createMacroActions();
	assert.throws(() => macros.scripts.import('await sound.select.all();'), /not a macro program file/u);
	const imported = macros.scripts.import(
		serializeMacroScriptEnvelope({ name: 'Sweep', source: 'await sound.log("hi");' }),
	);
	assert.equal(imported.origin, null);
	assert.equal(imported.trustedSource, null);
	assert.deepEqual(macros.scripts.list().map(({ name, trust }) => ({ name, trust })), [
		{ name: 'Sweep', trust: 'imported-untrusted' },
	]);
	assert.equal(JSON.parse(macros.scripts.export(imported.id)).source, 'await sound.log("hi");');
});
