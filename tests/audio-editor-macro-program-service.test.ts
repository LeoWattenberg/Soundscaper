/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMacroProgramService } from '../src/common/editor/controller/macro-program-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';

const effect = (type: string, id = type) => ({ id, type, enabled: true, params: {} });
const select = (params?: Record<string, unknown>) => createMacroCommandStep('SelectTime', { id: `select-${JSON.stringify(params ?? {})}`, params });

function createHarness(options: { readonly failOnRun?: number } = {}) {
	const events: string[] = [];
	const runs: Array<readonly string[]> = [];
	const progress: Array<[number, number, string]> = [];
	let transactions = 0;
	let settled: string | null = null;
	const service = createMacroProgramService({
		untitledMacroName: 'Untitled macro',
		isRunnableMacroCommand: (command) => command !== 'Unsupported',
		runEffectMacro: async ({ effects }) => {
			runs.push(effects.map((step) => String(step.type)));
			events.push(`run:${effects.map((step) => String(step.type)).join('+')}`);
			if (options.failOnRun === runs.length) throw new Error('render failed');
			return true;
		},
		cancelEffectMacro: () => { events.push('cancel-effects'); return false; },
		runMacroCommand: (step) => { events.push(`command:${step.command}`); },
		beginMacroTransaction: () => {
			transactions += 1;
			return Object.freeze({
				commit: () => { settled = 'commit'; events.push('transaction:commit'); },
				rollback: () => { settled = 'rollback'; events.push('transaction:rollback'); },
			});
		},
		reportProgress: (done, total, label) => { progress.push([done, total, label]); },
	});
	return {
		events, progress, runs, service,
		transactions: () => transactions,
		settled: () => settled,
	};
}

test('consecutive effects go over as one run, and a command ends it', () => {
	const harness = createHarness();
	return harness.service.runMacroProgram({
		name: 'Fade ends',
		effects: [
			select({ start: 0, end: 1 }),
			effect('audacity-fade-in'),
			select({ start: 0, end: 1, relativeTo: 'project-end' }),
			effect('audacity-fade-out'),
			effect('audacity-invert'),
		],
	}).then(() => {
		assert.deepEqual(harness.events, [
			'command:SelectTime',
			'run:audacity-fade-in',
			'command:SelectTime',
			'run:audacity-fade-out+audacity-invert',
			'transaction:commit',
		]);
		assert.deepEqual(harness.progress.at(-1), [5, 5, 'Fade ends']);
	});
});

test('an ordinary effect chain keeps committing exactly once, with no transaction', async () => {
	// One run of effects already produces one history entry, so folding it would
	// only rename what the user already sees.
	const harness = createHarness();
	assert.equal(await harness.service.runMacroProgram({
		name: 'Restoration',
		effects: [effect('audacity-click-removal'), effect('audacity-invert')],
	}), true);
	assert.equal(harness.transactions(), 0);
	assert.deepEqual(harness.runs, [['audacity-click-removal', 'audacity-invert']]);
});

test('a selection command before a single run still needs no transaction', async () => {
	// A command changes the selection without committing, so this is still one
	// entry however it is written.
	const harness = createHarness();
	await harness.service.runMacroProgram({ effects: [select({ start: 0 }), effect('audacity-invert')] });
	assert.equal(harness.transactions(), 0);
	assert.deepEqual(harness.events, ['command:SelectTime', 'run:audacity-invert']);
});

test('a failed step rolls the whole macro back', async () => {
	const harness = createHarness({ failOnRun: 2 });
	await assert.rejects(() => harness.service.runMacroProgram({
		effects: [effect('audacity-invert'), select({ start: 0 }), effect('audacity-amplify')],
	}), /render failed/u);
	assert.equal(harness.settled(), 'rollback');
});

test('an un-runnable command is named before anything is applied', async () => {
	const harness = createHarness();
	await assert.rejects(() => harness.service.runMacroProgram({
		effects: [
			effect('audacity-invert'),
			{ kind: 'command', id: 'x', enabled: true, command: 'Unsupported', params: {} },
		],
	}), /contains the command Unsupported/u);
	assert.deepEqual(harness.events, [], 'nothing may run before every step is admitted');
});

test('cancelling stops the loop before the next step', async () => {
	const harness = createHarness();
	const service = createMacroProgramService({
		untitledMacroName: 'Untitled macro',
		isRunnableMacroCommand: () => true,
		runEffectMacro: async () => { service.cancelMacroProgram(); return true; },
		cancelEffectMacro: () => true,
		runMacroCommand: () => { throw new Error('the loop must stop before this step'); },
		beginMacroTransaction: () => Object.freeze({ commit: () => undefined, rollback: () => undefined }),
	});
	await assert.rejects(
		() => service.runMacroProgram({ effects: [effect('audacity-invert'), select({ start: 0 })] }),
		{ name: 'AbortError' },
	);
	assert.equal(harness.transactions(), 0);
});

test('a macro whose first run is refused stops rather than walking the rest', async () => {
	// The effect runner answers null when the editor is already busy. Continuing
	// would run the later steps against a project that refused the first of them.
	const events: string[] = [];
	const service = createMacroProgramService({
		untitledMacroName: 'Untitled macro',
		isRunnableMacroCommand: () => true,
		runEffectMacro: async () => { events.push('run'); return null; },
		cancelEffectMacro: () => false,
		runMacroCommand: (step) => { events.push(`command:${step.command}`); },
		beginMacroTransaction: () => Object.freeze({
			commit: () => { events.push('commit'); },
			rollback: () => { events.push('rollback'); },
		}),
	});

	assert.equal(await service.runMacroProgram({
		effects: [effect('audacity-invert'), select({ start: 0 }), effect('audacity-amplify')],
	}), null);
	assert.deepEqual(events, ['run', 'rollback']);
});

test('a macro with nothing enabled reports that it did nothing', async () => {
	const harness = createHarness();
	assert.equal(await harness.service.runMacroProgram({ effects: [] }), null);
	assert.equal(await harness.service.runMacroProgram({
		effects: [{ ...effect('audacity-invert'), enabled: false }],
	}), null);
	assert.deepEqual(harness.events, []);
});
