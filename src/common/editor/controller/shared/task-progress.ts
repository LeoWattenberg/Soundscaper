/* SPDX-License-Identifier: AGPL-3.0-only */

import { freezePresentationMessage, type LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';

export type EditorTaskProgressKind =
	| 'analysis'
	| 'assistance'
	| 'effect'
	| 'export'
	| 'generate'
	| 'import'
	| 'probe'
	| 'project-io'
	| 'render'
	| 'sample-edit'
	| 'transform';

export interface EditorTaskProgress {
	readonly id: string;
	readonly kind: EditorTaskProgressKind;
	readonly label: string;
	readonly value: number | null;
	readonly cancellable?: boolean;
	readonly localization?: LocalizedPresentationMessage;
}

export interface EditorTaskProgressPhase {
	readonly start?: number;
	readonly end?: number;
	readonly value?: number | null;
}

export interface EditorTaskProgressHandle {
	readonly id: string;
	readonly kind: EditorTaskProgressKind;
	setPhase(label: string, phase?: EditorTaskProgressPhase, localization?: LocalizedPresentationMessage): boolean;
	update(value: number): boolean;
	setIndeterminate(label?: string, localization?: LocalizedPresentationMessage): boolean;
	setCancellation(cancel: () => void): boolean;
	finish(): boolean;
}

export interface EditorTaskProgressCoordinator {
	begin(kind: EditorTaskProgressKind, label: string, value?: number | null, localization?: LocalizedPresentationMessage): EditorTaskProgressHandle;
	run<Result>(kind: EditorTaskProgressKind, label: string, operation: (task: EditorTaskProgressHandle) => Promise<Result> | Result, value?: number | null, localization?: LocalizedPresentationMessage): Promise<Result>;
	getSnapshot(): EditorTaskProgress | null;
	setActivePhase(label: string, phase?: EditorTaskProgressPhase, localization?: LocalizedPresentationMessage): boolean;
	updateActive(value: number): boolean;
	cancelActive(): boolean;
	clear(): boolean;
	refreshLocalization?(): void;
}

/** Owns the single foreground task shown by the editor status area. */
export function createEditorTaskProgressCoordinator({
	onChange = () => {},
	formatMessage,
}: Readonly<{ onChange?: (progress: EditorTaskProgress | null) => void; formatMessage?: (message: LocalizedPresentationMessage) => string }> = {}): EditorTaskProgressCoordinator & { refreshLocalization(): void } {
	let sequence = 0;
	let active: MutableTaskProgress | null = null;

	function publish(): void {
		onChange(active ? freezeProgress(active) : null);
	}

	function begin(
		kind: EditorTaskProgressKind,
		label: string,
		value: number | null = null,
		localization?: LocalizedPresentationMessage,
	): EditorTaskProgressHandle {
		const id = `task-${++sequence}`;
		active = {
			id,
			kind,
			label: normalizeLabel(localization && formatMessage ? formatMessage(localization) : label),
			localization: localization ? freezePresentationMessage(localization) : undefined,
			value: normalizeOptionalProgress(value),
			phaseStart: 0,
			phaseEnd: 1,
			phaseValue: value == null ? null : clampProgress(value),
			cancel: null,
		};
		publish();

		const ownsTask = (): boolean => active?.id === id;
		return Object.freeze({
			id,
			kind,
			setPhase(nextLabel: string, phase: EditorTaskProgressPhase = {}, nextLocalization?: LocalizedPresentationMessage): boolean {
				return ownsTask() && setActivePhase(nextLabel, phase, nextLocalization);
			},
			update(nextValue: number): boolean {
				return ownsTask() && updateActive(nextValue);
			},
			setIndeterminate(nextLabel?: string, nextLocalization?: LocalizedPresentationMessage): boolean {
				if (!ownsTask()) return false;
				if (nextLabel !== undefined) { active!.label = normalizeLabel(nextLocalization && formatMessage ? formatMessage(nextLocalization) : nextLabel); active!.localization = nextLocalization ? freezePresentationMessage(nextLocalization) : undefined; }
				active!.phaseValue = null;
				active!.value = null;
				publish();
				return true;
			},
			setCancellation(cancel: () => void): boolean {
				if (!ownsTask()) return false;
				active!.cancel = cancel;
				publish();
				return true;
			},
			finish(): boolean {
				if (!ownsTask()) return false;
				active = null;
				publish();
				return true;
			},
		});
	}

	function setActivePhase(label: string, phase: EditorTaskProgressPhase = {}, localization?: LocalizedPresentationMessage): boolean {
		if (!active) return false;
		const task = active;
		const start = clampProgress(phase.start ?? task.value ?? 0);
		const end = clampProgress(phase.end ?? 1);
		task.label = normalizeLabel(localization && formatMessage ? formatMessage(localization) : label);
		task.localization = localization ? freezePresentationMessage(localization) : undefined;
		task.phaseStart = Math.min(start, end);
		task.phaseEnd = Math.max(start, end);
		task.phaseValue = phase.value == null ? null : clampProgress(phase.value);
		task.value = task.phaseValue == null ? null : monotonicValue(task.value, mapPhaseValue(task));
		publish();
		return true;
	}

	function updateActive(value: number): boolean {
		if (!active) return false;
		const normalized = clampProgress(value);
		active.phaseValue = Math.max(active.phaseValue ?? 0, normalized);
		active.value = monotonicValue(active.value, mapPhaseValue(active));
		publish();
		return true;
	}

	return Object.freeze({
		begin,
		async run<Result>(kind: EditorTaskProgressKind, label: string, operation: (task: EditorTaskProgressHandle) => Promise<Result> | Result, value: number | null = null, localization?: LocalizedPresentationMessage): Promise<Result> {
			const task = begin(kind, label, value, localization);
			try {
				return await operation(task);
			} finally {
				task.finish();
			}
		},
		getSnapshot: () => active ? freezeProgress(active) : null,
		setActivePhase,
		updateActive,
		cancelActive(): boolean {
			const cancel = active?.cancel;
			if (!cancel) return false;
			active!.cancel = null;
			publish();
			cancel();
			return true;
		},
		clear(): boolean {
			if (!active) return false;
			active = null;
			publish();
			return true;
		},
		refreshLocalization(): void {
			if (!active?.localization || !formatMessage) return;
			active.label = formatMessage(active.localization);
			publish();
		},
	});
}

interface MutableTaskProgress extends EditorTaskProgress {
	label: string;
	localization?: LocalizedPresentationMessage;
	value: number | null;
	phaseStart: number;
	phaseEnd: number;
	phaseValue: number | null;
	cancel: (() => void) | null;
}

function freezeProgress(progress: MutableTaskProgress): EditorTaskProgress {
	return Object.freeze({
		id: progress.id,
		kind: progress.kind,
		label: progress.label,
		value: progress.value,
		...(progress.cancel ? { cancellable: true } : {}),
		...(progress.localization ? { localization: progress.localization } : {}),
	});
}

function mapPhaseValue(progress: MutableTaskProgress): number {
	return progress.phaseStart
		+ (progress.phaseEnd - progress.phaseStart) * (progress.phaseValue ?? 0);
}

function monotonicValue(current: number | null, next: number): number {
	return Math.max(current ?? 0, next);
}

function normalizeOptionalProgress(value: number | null): number | null {
	return value == null ? null : clampProgress(value);
}

function clampProgress(value: number): number {
	const number = Number(value);
	if (!Number.isFinite(number)) return 0;
	return Math.max(0, Math.min(1, number));
}

function normalizeLabel(value: string): string {
	return String(value || '').trim();
}
