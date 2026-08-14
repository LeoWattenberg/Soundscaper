/* SPDX-License-Identifier: AGPL-3.0-only */

export type EditorTaskProgressKind =
	| 'analysis'
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
}

export interface EditorTaskProgressPhase {
	readonly start?: number;
	readonly end?: number;
	readonly value?: number | null;
}

export interface EditorTaskProgressHandle {
	readonly id: string;
	readonly kind: EditorTaskProgressKind;
	setPhase(label: string, phase?: EditorTaskProgressPhase): boolean;
	update(value: number): boolean;
	setIndeterminate(label?: string): boolean;
	finish(): boolean;
}

export interface EditorTaskProgressCoordinator {
	begin(kind: EditorTaskProgressKind, label: string, value?: number | null): EditorTaskProgressHandle;
	run<Result>(kind: EditorTaskProgressKind, label: string, operation: (task: EditorTaskProgressHandle) => Promise<Result> | Result, value?: number | null): Promise<Result>;
	getSnapshot(): EditorTaskProgress | null;
	setActivePhase(label: string, phase?: EditorTaskProgressPhase): boolean;
	updateActive(value: number): boolean;
	clear(): boolean;
}

/** Owns the single foreground task shown by the editor status area. */
export function createEditorTaskProgressCoordinator({
	onChange = () => {},
}: Readonly<{ onChange?: (progress: EditorTaskProgress | null) => void }> = {}): EditorTaskProgressCoordinator {
	let sequence = 0;
	let active: MutableTaskProgress | null = null;

	function publish(): void {
		onChange(active ? freezeProgress(active) : null);
	}

	function begin(
		kind: EditorTaskProgressKind,
		label: string,
		value: number | null = null,
	): EditorTaskProgressHandle {
		const id = `task-${++sequence}`;
		active = {
			id,
			kind,
			label: normalizeLabel(label),
			value: normalizeOptionalProgress(value),
			phaseStart: 0,
			phaseEnd: 1,
			phaseValue: value == null ? null : clampProgress(value),
		};
		publish();

		const ownsTask = (): boolean => active?.id === id;
		return Object.freeze({
			id,
			kind,
			setPhase(nextLabel: string, phase: EditorTaskProgressPhase = {}): boolean {
				if (!ownsTask()) return false;
				const start = clampProgress(phase.start ?? active!.value ?? 0);
				const end = clampProgress(phase.end ?? 1);
				active!.label = normalizeLabel(nextLabel);
				active!.phaseStart = Math.min(start, end);
				active!.phaseEnd = Math.max(start, end);
				active!.phaseValue = phase.value == null ? null : clampProgress(phase.value);
				active!.value = active!.phaseValue == null
					? null
					: monotonicValue(active!.value, mapPhaseValue(active!));
				publish();
				return true;
			},
			update(nextValue: number): boolean {
				if (!ownsTask()) return false;
				const normalized = clampProgress(nextValue);
				active!.phaseValue = Math.max(active!.phaseValue ?? 0, normalized);
				active!.value = monotonicValue(active!.value, mapPhaseValue(active!));
				publish();
				return true;
			},
			setIndeterminate(nextLabel?: string): boolean {
				if (!ownsTask()) return false;
				if (nextLabel !== undefined) active!.label = normalizeLabel(nextLabel);
				active!.phaseValue = null;
				active!.value = null;
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

	return Object.freeze({
		begin,
		async run<Result>(kind: EditorTaskProgressKind, label: string, operation: (task: EditorTaskProgressHandle) => Promise<Result> | Result, value: number | null = null): Promise<Result> {
			const task = begin(kind, label, value);
			try {
				return await operation(task);
			} finally {
				task.finish();
			}
		},
		getSnapshot: () => active ? freezeProgress(active) : null,
		setActivePhase(label: string, phase: EditorTaskProgressPhase = {}): boolean {
			if (!active) return false;
			const task = active;
			const start = clampProgress(phase.start ?? task.value ?? 0);
			const end = clampProgress(phase.end ?? 1);
			task.label = normalizeLabel(label);
			task.phaseStart = Math.min(start, end);
			task.phaseEnd = Math.max(start, end);
			task.phaseValue = phase.value == null ? null : clampProgress(phase.value);
			task.value = task.phaseValue == null ? null : monotonicValue(task.value, mapPhaseValue(task));
			publish();
			return true;
		},
		updateActive(value: number): boolean {
			if (!active) return false;
			const normalized = clampProgress(value);
			active.phaseValue = Math.max(active.phaseValue ?? 0, normalized);
			active.value = monotonicValue(active.value, mapPhaseValue(active));
			publish();
			return true;
		},
		clear(): boolean {
			if (!active) return false;
			active = null;
			publish();
			return true;
		},
	});
}

interface MutableTaskProgress extends EditorTaskProgress {
	label: string;
	value: number | null;
	phaseStart: number;
	phaseEnd: number;
	phaseValue: number | null;
}

function freezeProgress(progress: MutableTaskProgress): EditorTaskProgress {
	return Object.freeze({
		id: progress.id,
		kind: progress.kind,
		label: progress.label,
		value: progress.value,
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
