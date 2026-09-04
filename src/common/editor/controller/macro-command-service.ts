/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Running Audacity's selection commands. The arithmetic — which edge each
 * `RelativeTo` measures from, what an absent parameter leaves alone, and how a
 * track range is set, added or removed — is ported from Audacity 3.7.7 commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b, src/commands/SelectCommand.cpp.
 * Audacity is distributed under GPL version 3; this TypeScript adaptation was
 * created for kw.media in 2026.
 */

import { audacityMacroMenuCommand } from '../audacity-macro-menu-commands.ts';
import type { MacroCommandStep } from '../macro-command-steps.ts';

export interface MacroCommandTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface MacroCommandSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly frequencyRange?: Readonly<{ low: number; high: number }> | null;
}

export interface MacroCommandProject extends Readonly<Record<string, unknown>> {
	readonly tracks: readonly MacroCommandTrack[];
	readonly selection?: MacroCommandSelection | null;
}

export interface MacroCommandServiceRuntime {
	readonly getProject: () => MacroCommandProject;
	readonly projectSampleRate: () => number;
	/**
	 * The last frame the project's own content reaches, which `ProjectEnd`
	 * measures back from. Not the timeline's visible extent, which runs past the
	 * content so there is somewhere to drag to.
	 */
	readonly timelineDurationFrames: () => number;
	readonly setExactSelection: (
		startFrame: number,
		endFrame: number,
		details?: Readonly<Record<string, unknown>>,
	) => unknown;
	/**
	 * The editor's own action tree, read at call time.
	 *
	 * Bare commands name a path into it rather than into the action manifest,
	 * because the manifest also describes a tier that only asks the interface to
	 * open something — a command that cannot run headlessly has nowhere to be
	 * written down this way.
	 */
	readonly getActions?: () => Readonly<Record<string, unknown>> | null;
}

const TRACK_MODES = Object.freeze({ set: 'set', add: 'add', remove: 'remove' } as const);

/** Whether this build can run the command a step names. */
export function isRunnableMacroCommand(command: string): boolean {
	return command === 'Select' || command === 'SelectTime'
		|| command === 'SelectFrequencies' || command === 'SelectTracks'
		|| audacityMacroMenuCommand(command) !== null;
}

export function createMacroCommandService(runtime: MacroCommandServiceRuntime) {
	return Object.freeze({ runMacroCommand });

	function runMacroCommand(step: MacroCommandStep): void {
		if (!isRunnableMacroCommand(step.command)) {
			throw new RangeError(`This build cannot run the macro command ${step.command}.`);
		}
		const menuCommand = audacityMacroMenuCommand(step.command);
		if (menuCommand) {
			runMenuCommand(menuCommand.command, menuCommand.path);
			return;
		}
		const project = runtime.getProject();
		const selection = project.selection ?? { startFrame: 0, endFrame: 0 };
		const params = step.params as Readonly<Record<string, unknown>>;
		const wantsTime = step.command === 'Select' || step.command === 'SelectTime';
		const wantsFrequencies = step.command === 'Select' || step.command === 'SelectFrequencies';
		const wantsTracks = step.command === 'Select' || step.command === 'SelectTracks';

		// Audacity leaves the selection alone entirely when a time command carries
		// neither edge, so an unrelated Select that only names tracks does not
		// silently collapse the range to zero.
		const range = wantsTime && (has(params, 'start') || has(params, 'end'))
			? timeRange(params, selection)
			: { startFrame: selection.startFrame, endFrame: selection.endFrame };

		// The track selection is carried through every command, because upstream a
		// time or frequency command does not touch it — and a selection written
		// without it would drop whatever the reader or an earlier step selected.
		const details: Record<string, unknown> = {
			trackIds: wantsTracks && (has(params, 'track') || has(params, 'trackCount') || has(params, 'mode'))
				? trackIds(params, project, selection)
				: [...(selection.trackIds ?? [])],
		};
		if (wantsFrequencies && (has(params, 'high') || has(params, 'low'))) {
			details.frequencyRange = frequencyRange(params, selection);
		}
		runtime.setExactSelection(range.startFrame, range.endFrame, details);
	}

	/**
	 * Run one bare command by walking the editor's own action tree.
	 *
	 * A path that does not resolve is a catalogue that has drifted from the
	 * editor, and saying so is better than a step that quietly does nothing —
	 * which is exactly how a macro produces a plausible-looking wrong result.
	 */
	function runMenuCommand(command: string, path: string): void {
		const actions = runtime.getActions?.();
		let target: unknown = actions;
		for (const segment of path.split('.')) {
			if (!target || typeof target !== 'object' || !Object.hasOwn(target, segment)) {
				throw new RangeError(`The macro command ${command} has no editor action (${path}).`);
			}
			target = (target as Record<string, unknown>)[segment];
		}
		if (typeof target !== 'function') {
			throw new RangeError(`The macro command ${command} has no editor action (${path}).`);
		}
		(target as () => unknown)();
	}

	/**
	 * Where each edge lands, in Audacity's own asymmetric terms: `Project`
	 * extends past the project end, `ProjectEnd` counts backwards from it, and
	 * `Selection` moves each edge by its own offset.
	 */
	function timeRange(
		params: Readonly<Record<string, unknown>>,
		selection: MacroCommandSelection,
	): Readonly<{ startFrame: number; endFrame: number }> {
		const sampleRate = runtime.projectSampleRate();
		const toFrames = (seconds: number) => Math.round(seconds * sampleRate);
		const start = toFrames(number(params.start));
		const end = toFrames(number(params.end));
		const projectEnd = runtime.timelineDurationFrames();
		switch (params.relativeTo) {
			case 'project':
				return { startFrame: start, endFrame: projectEnd + end };
			case 'project-end':
				return { startFrame: projectEnd - start, endFrame: projectEnd - end };
			case 'selection-start':
				return { startFrame: selection.startFrame + start, endFrame: selection.startFrame + end };
			case 'selection':
				return { startFrame: selection.startFrame + start, endFrame: selection.endFrame + end };
			case 'selection-end':
				return { startFrame: selection.endFrame - start, endFrame: selection.endFrame - end };
			default:
				return { startFrame: start, endFrame: end };
		}
	}

	function frequencyRange(
		params: Readonly<Record<string, unknown>>,
		selection: MacroCommandSelection,
	): Readonly<{ low: number; high: number }> {
		const current = selection.frequencyRange ?? { low: 0, high: 0 };
		return {
			low: has(params, 'low') ? number(params.low) : current.low,
			high: has(params, 'high') ? number(params.high) : current.high,
		};
	}

	/**
	 * Which tracks the range covers, applied by position as Audacity applies it.
	 * `Set` replaces the selection, `Add` widens it, and `Remove` takes the range
	 * back out; tracks outside the range are untouched by the latter two.
	 */
	function trackIds(
		params: Readonly<Record<string, unknown>>,
		project: MacroCommandProject,
		selection: MacroCommandSelection,
	): readonly string[] {
		const first = has(params, 'track') ? number(params.track) : 0;
		const count = has(params, 'trackCount') ? number(params.trackCount) : 1;
		const mode = has(params, 'mode') ? String(params.mode) : TRACK_MODES.set;
		const last = first + count;
		const selected = new Set(selection.trackIds ?? []);
		const covered = (index: number) => first <= index && index < last;
		return project.tracks.filter((track, index) => {
			if (mode === TRACK_MODES.set) return covered(index);
			if (!covered(index)) return selected.has(track.id);
			return mode === TRACK_MODES.add;
		}).map(({ id }) => id);
	}
}

function has(params: Readonly<Record<string, unknown>>, name: string): boolean {
	return Object.hasOwn(params, name);
}

function number(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
