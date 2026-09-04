/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Running a macro whose steps are not all effects.
 *
 * Audacity's macro is a command script: it walks the steps in order, and each
 * one reads whatever the one before it left behind. Soundscaper's effect runner
 * cannot express that — it resolves one target up front and carries one buffer
 * to the end — so ordering lives here instead, and the runner keeps its job of
 * turning a run of effects into audio.
 *
 * Consecutive effect steps are handed over as one run, which is what preserves
 * the rack warming, the length-change reslicing and the single-buffer chain the
 * effect runner already does. A command step ends the run before it, and the
 * next run resolves its own target from whatever the command selected.
 */

import { isMacroCommandStep, type MacroCommandStep } from '../macro-command-steps.ts';

export interface MacroProgramStep extends Readonly<Record<string, unknown>> {
	readonly id?: string;
	readonly type?: string;
	readonly enabled?: boolean;
}

export interface MacroProgramRequest {
	readonly name?: unknown;
	readonly effects?: readonly MacroProgramStep[];
	readonly steps?: readonly MacroProgramStep[];
}

export interface MacroProgramServiceRuntime {
	readonly runEffectMacro: (
		request: Readonly<{ name: string; effects: readonly MacroProgramStep[] }>,
	) => Promise<unknown>;
	readonly cancelEffectMacro: () => boolean;
	readonly runMacroCommand: (step: MacroCommandStep) => void;
	readonly beginMacroTransaction: () => Readonly<{
		commit(command: Readonly<Record<string, unknown>>): unknown;
		rollback(): unknown;
	}>;
	readonly isRunnableMacroCommand: (command: string) => boolean;
	readonly reportProgress?: (done: number, total: number, label: string) => void;
	readonly untitledMacroName: string;
}

export function createMacroProgramService(runtime: MacroProgramServiceRuntime) {
	let cancelled = false;
	let running = false;

	return Object.freeze({ runMacroProgram, cancelMacroProgram });

	async function runMacroProgram(request: MacroProgramRequest = {}): Promise<true | null> {
		const steps = (request.steps ?? request.effects ?? [])
			.filter((step) => step?.enabled !== false && step?.type !== 'missing');
		assertRunnable(steps);
		const name = String(request.name || runtime.untitledMacroName).trim() || runtime.untitledMacroName;

		// A single run of effects already commits exactly once, and a command step
		// changes the selection without committing at all. Only a macro that runs
		// effects more than once has anything to fold together, so an ordinary
		// effect chain keeps producing exactly the history entry it always has.
		const runs = countEffectRuns(steps);
		const transaction = runs > 1 ? runtime.beginMacroTransaction() : null;
		cancelled = false;
		running = true;
		let applied = false;
		try {
			let buffered: MacroProgramStep[] = [];
			for (const [index, step] of steps.entries()) {
				assertNotCancelled();
				runtime.reportProgress?.(index, steps.length, stepLabel(step));
				if (!isMacroCommandStep(step)) {
					buffered.push(step);
					continue;
				}
				const outcome = await flush(buffered, name);
				if (outcome === 'blocked') return blocked(transaction);
				applied = outcome === 'applied' || applied;
				buffered = [];
				// The run just awaited may itself have been cancelled, so ask again
				// before the command that would otherwise follow it.
				assertNotCancelled();
				runtime.runMacroCommand(step);
				applied = true;
			}
			assertNotCancelled();
			const outcome = await flush(buffered, name);
			if (outcome === 'blocked') return blocked(transaction);
			applied = outcome === 'applied' || applied;
			transaction?.commit({ type: 'macro/run', name, stepCount: steps.length });
			runtime.reportProgress?.(steps.length, steps.length, name);
			return applied ? true : null;
		} catch (error) {
			transaction?.rollback();
			throw error;
		} finally {
			running = false;
		}
	}

	/**
	 * Stops the macro that is running. The effect run in flight is cancelled the
	 * way it always was; the loop around it stops before the next step, so a
	 * cancelled macro never starts work the user has already asked it not to do.
	 */
	function cancelMacroProgram(): boolean {
		const stopped = runtime.cancelEffectMacro();
		if (!running) return stopped;
		cancelled = true;
		return true;
	}

	/**
	 * Hand one run of effects to the effect runner.
	 *
	 * The runner answers `null` when the editor is already busy with another
	 * edit. The macro stops there rather than walking its remaining steps against
	 * a project that refused the first of them.
	 */
	async function flush(
		steps: readonly MacroProgramStep[],
		name: string,
	): Promise<'applied' | 'blocked' | 'empty'> {
		if (!steps.length) return 'empty';
		const result = await runtime.runEffectMacro({ name, effects: steps });
		return result === null ? 'blocked' : 'applied';
	}

	function blocked(transaction: ReturnType<MacroProgramServiceRuntime['beginMacroTransaction']> | null): null {
		transaction?.rollback();
		return null;
	}

	function assertNotCancelled(): void {
		if (!cancelled) return;
		throw Object.assign(new Error('The macro was cancelled.'), { name: 'AbortError' });
	}

	function assertRunnable(steps: readonly MacroProgramStep[]): void {
		// Every un-runnable step is named before anything is applied. A macro that
		// discovered its fortieth step was impossible would already have rewritten
		// the audio the first thirty-nine touched.
		for (const step of steps) {
			if (!isMacroCommandStep(step)) continue;
			if (runtime.isRunnableMacroCommand(step.command)) continue;
			throw new RangeError(`This macro contains the command ${step.command}, which this build cannot run.`);
		}
	}
}

/** How many separate runs of effects the steps fall into. */
function countEffectRuns(steps: readonly MacroProgramStep[]): number {
	let runs = 0;
	let inRun = false;
	for (const step of steps) {
		if (isMacroCommandStep(step)) {
			inRun = false;
			continue;
		}
		if (!inRun) runs += 1;
		inRun = true;
	}
	return runs;
}

function stepLabel(step: MacroProgramStep): string {
	return isMacroCommandStep(step) ? step.command : String(step.type ?? '');
}
