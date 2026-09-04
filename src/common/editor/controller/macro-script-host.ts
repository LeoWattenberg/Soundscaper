/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What a macro program is allowed to ask for.
 *
 * This is the security boundary. The worker's own capability reduction is
 * defence in depth; what a program can actually reach is exactly the table
 * below, and every argument is admitted before it reaches the editor.
 *
 * The table is deliberately small. A program can look at the project, move the
 * selection, and run the effects and commands a step-list macro can run — the
 * same vocabulary, so a program and a step list are provably the same reach. It
 * cannot open, save, export or import anything, touch preferences or storage,
 * ask for a device, or reach another project: the run's blast radius is the one
 * project that was open when it started.
 */

import { createMacroCommandStep } from '../macro-command-steps.ts';
import type { MacroValue } from '../macro-script/protocol.ts';

export interface MacroScriptTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface MacroScriptHostRuntime {
	readonly getProject: () => Readonly<Record<string, unknown>> | null;
	readonly projectSampleRate: () => number;
	readonly runEffectMacro: (
		request: Readonly<{ name: string; effects: readonly Readonly<Record<string, unknown>>[] }>,
	) => Promise<unknown>;
	readonly runMacroCommand: (step: Readonly<Record<string, unknown>>) => void;
	readonly setExactSelection: (
		startFrame: number, endFrame: number, details?: Readonly<Record<string, unknown>>,
	) => unknown;
	readonly listSavedMacros: () => readonly Readonly<{
		id: string; name: string; effects: readonly Readonly<Record<string, unknown>>[];
	}>[];
	readonly beginMacroTransaction: () => Readonly<{
		commit(command: Readonly<Record<string, unknown>>): unknown;
		rollback(): unknown;
	}>;
}

export interface MacroScriptRunRequest {
	readonly name: string;
	readonly run: (dispatch: MacroScriptDispatch) => Promise<unknown>;
}

export type MacroScriptDispatch = (method: string, args: readonly MacroValue[]) => Promise<MacroValue>;

export function createMacroScriptHost(runtime: MacroScriptHostRuntime) {
	return Object.freeze({ runMacroScript, createDispatch });

	/**
	 * Run a program under one history entry.
	 *
	 * A program can change the project as many times as it likes, and it is still
	 * one action to the person who pressed Run — so the whole run is a single
	 * transaction, collapsed at the end or rolled back if the program throws.
	 */
	async function runMacroScript(request: MacroScriptRunRequest): Promise<unknown> {
		const transaction = runtime.beginMacroTransaction();
		let mutations = 0;
		try {
			const result = await request.run(createDispatch(() => { mutations += 1; }));
			transaction.commit({ type: 'macro/run', name: request.name, stepCount: mutations });
			return result;
		} catch (error) {
			transaction.rollback();
			throw error;
		}
	}

	function createDispatch(onMutation: () => void = () => undefined): MacroScriptDispatch {
		return async (method, args) => {
			const handler = READERS[method];
			if (handler) return handler(runtime, args);
			const mutator = MUTATORS[method];
			if (!mutator) {
				throw Object.assign(
					new Error(`A macro cannot ask the editor for ${method}.`),
					{ code: 'MACRO_UNKNOWN_METHOD' },
				);
			}
			onMutation();
			return mutator(runtime, args);
		};
	}
}

type Handler = (
	runtime: MacroScriptHostRuntime, args: readonly MacroValue[],
) => MacroValue | Promise<MacroValue>;

const READERS: Readonly<Record<string, Handler>> = Object.freeze({
	'project.snapshot': (runtime) => ({
		sampleRate: runtime.projectSampleRate(),
		tracks: readTracks(runtime),
		selection: readSelection(runtime),
	}),
	'project.tracks': (runtime) => readTracks(runtime),
	'project.selection': (runtime) => readSelection(runtime),
	'project.clips': (runtime, args) => {
		const trackId = typeof args[0] === 'string' ? args[0] : null;
		const clips = asArray(requireProject(runtime).clips);
		return clips
			.filter((clip) => !trackId || clipTrackId(requireProject(runtime), clip) === trackId)
			.map((clip) => ({
				id: String(clip.id ?? ''),
				name: String(clip.title ?? ''),
				startFrame: Number(clip.timelineStartFrame ?? 0),
				durationFrames: Number(clip.durationFrames ?? 0),
			}));
	},
});

const MUTATORS: Readonly<Record<string, Handler>> = Object.freeze({
	'select.frames': (runtime, args) => {
		const details = optionsOf(args[2]);
		runtime.setExactSelection(numberOf(args[0]), numberOf(args[1]), {
			trackIds: trackIdsOf(details) ?? currentTrackIds(runtime),
		});
		return readSelection(runtime);
	},
	'select.time': (runtime, args) => {
		const options = optionsOf(args[2]);
		return runCommand(runtime, 'SelectTime', {
			start: numberOf(args[0]),
			end: numberOf(args[1]),
			...(typeof options.relativeTo === 'string' ? { relativeTo: options.relativeTo } : {}),
		});
	},
	'select.tracks': (runtime, args) => runCommand(runtime, 'SelectTracks', numericParams(
		optionsOf(args[0]), ['track', 'trackCount'], ['mode'],
	)),
	'select.frequencies': (runtime, args) => runCommand(runtime, 'SelectFrequencies', numericParams(
		optionsOf(args[0]), ['low', 'high'], [],
	)),
	'select.all': (runtime) => {
		const project = requireProject(runtime);
		const frames = Number(project.durationFrames ?? 0) || projectFrames(project);
		runtime.setExactSelection(0, frames, {
			trackIds: asArray(project.tracks).map((track) => String(track.id ?? '')),
		});
		return readSelection(runtime);
	},
	'select.none': (runtime) => {
		runtime.setExactSelection(0, 0, { trackIds: [] });
		return readSelection(runtime);
	},
	'effect.apply': async (runtime, args) => {
		const type = String(args[0] ?? '');
		const params = optionsOf(args[1]);
		await runtime.runEffectMacro({ name: type, effects: [{ type, params }] });
		return null;
	},
	'effect.chain': async (runtime, args) => {
		const steps = asArray(args[0]).map((step) => ({
			type: String((step as Record<string, unknown>).type ?? ''),
			params: optionsOf((step as Record<string, unknown>).params),
		}));
		if (!steps.length) throw new RangeError('A macro chain needs at least one effect.');
		await runtime.runEffectMacro({ name: steps[0]!.type, effects: steps });
		return null;
	},
	'macro.runSaved': async (runtime, args) => {
		const name = String(args[0] ?? '').trim();
		const saved = runtime.listSavedMacros().find((macro) => macro.name === name);
		if (!saved) throw new ReferenceError(`There is no saved macro called ${JSON.stringify(name)}.`);
		// A saved macro may itself hold commands, so it goes back through the same
		// split a step list takes rather than being handed over as effects.
		for (const run of splitRuns(saved.effects)) {
			if (run.command) runtime.runMacroCommand(run.command);
			else await runtime.runEffectMacro({ name: saved.name, effects: run.effects });
		}
		return null;
	},
	'command.run': (runtime, args) => runCommand(
		runtime, String(args[0] ?? ''), optionsOf(args[1]),
	),
});

function runCommand(
	runtime: MacroScriptHostRuntime,
	command: string,
	params: Readonly<Record<string, unknown>>,
): MacroValue {
	runtime.runMacroCommand(createMacroCommandStep(command, { params }));
	return readSelection(runtime);
}

/** A saved macro's steps, split the way the sequencer splits them. */
function splitRuns(steps: readonly Readonly<Record<string, unknown>>[]): readonly Readonly<{
	command?: Readonly<Record<string, unknown>>;
	effects: readonly Readonly<Record<string, unknown>>[];
}>[] {
	const runs: { command?: Readonly<Record<string, unknown>>; effects: Readonly<Record<string, unknown>>[] }[] = [];
	let buffered: Readonly<Record<string, unknown>>[] = [];
	for (const step of steps) {
		if (step.kind === 'command') {
			if (buffered.length) runs.push({ effects: buffered });
			buffered = [];
			runs.push({ command: step, effects: [] });
			continue;
		}
		buffered.push(step);
	}
	if (buffered.length) runs.push({ effects: buffered });
	return runs;
}

function readTracks(runtime: MacroScriptHostRuntime): MacroValue {
	const project = requireProject(runtime);
	return asArray(project.tracks).map((track, index) => ({
		id: String(track.id ?? ''),
		name: String(track.name ?? ''),
		kind: String(track.type ?? 'audio'),
		index,
		muted: track.mute === true,
		solo: track.solo === true,
	}));
}

function readSelection(runtime: MacroScriptHostRuntime): MacroValue {
	const selection = requireProject(runtime).selection as Record<string, unknown> | null | undefined;
	return {
		startFrame: Number(selection?.startFrame ?? 0),
		endFrame: Number(selection?.endFrame ?? 0),
		trackIds: asArray(selection?.trackIds).map((id) => String(id)),
	};
}

function currentTrackIds(runtime: MacroScriptHostRuntime): readonly string[] {
	const selection = requireProject(runtime).selection as Record<string, unknown> | null | undefined;
	return asArray(selection?.trackIds).map((id) => String(id));
}

function projectFrames(project: Readonly<Record<string, unknown>>): number {
	return asArray(project.clips).reduce((frames, clip) => Math.max(
		frames,
		Number(clip.timelineStartFrame ?? 0) + Number(clip.durationFrames ?? 0),
	), 0);
}

function clipTrackId(project: Readonly<Record<string, unknown>>, clip: Record<string, unknown>): string | null {
	const track = asArray(project.tracks)
		.find((candidate) => asArray(candidate.clipIds).some((id) => String(id) === String(clip.id ?? '')));
	return track ? String(track.id ?? '') : null;
}

function requireProject(runtime: MacroScriptHostRuntime): Readonly<Record<string, unknown>> {
	const project = runtime.getProject();
	if (!project) throw new Error('A macro needs an open project.');
	return project;
}

function numericParams(
	options: Readonly<Record<string, unknown>>,
	numbers: readonly string[],
	strings: readonly string[],
): Readonly<Record<string, unknown>> {
	const params: Record<string, unknown> = {};
	for (const name of numbers) if (name in options) params[name] = numberOf(options[name]);
	for (const name of strings) if (typeof options[name] === 'string') params[name] = options[name];
	return params;
}

function optionsOf(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: {};
}

function trackIdsOf(options: Readonly<Record<string, unknown>>): readonly string[] | null {
	return Array.isArray(options.trackIds) ? options.trackIds.map((id) => String(id)) : null;
}

function asArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function numberOf(value: unknown): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError('A macro must pass a finite number.');
	return number;
}
