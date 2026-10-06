/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EditorTaskProgressHandle, EditorTaskProgressPhase } from '../../../shared/task-progress.ts';
import type { LocalizedPresentationMessage } from '../../../../../i18n/presentation-message.ts';

export interface StemPresentationPorts {
	readonly task: Pick<EditorTaskProgressHandle, 'setPhase' | 'update'>;
	readonly assertCurrent: () => void;
	readonly reportProgress: (progress: number) => void;
	readonly setStatus: (message: unknown, state?: string, localization?: LocalizedPresentationMessage) => void;
}

/** One export-wide absolute observer also covers archive acknowledgments after the following render has advanced. */
export function createMonotonicStemPresentation(ports: StemPresentationPorts): StemPresentationPorts {
	let last = 0;
	return { ...ports, reportProgress(value) {
		try { ports.assertCurrent(); } catch { return; }
		if (!Number.isFinite(value)) return;
		last = Math.max(last, Math.max(0, Math.min(1, value))); ports.reportProgress(last);
	} };
}

/** Private phase/cancel state per entry; only the owning export task may receive its mapped progress. */
export function createOwnedStemProgress(ports: StemPresentationPorts, signal: AbortSignal) {
	const owner = new AbortController(); let active = true; let start = 0; let end = 1; let last = 0;
	let label = ''; let localization: LocalizedPresentationMessage | undefined; let cancel: (() => void) | null = null;
	const abort = (): void => { owner.abort(signal.reason); cancel?.(); };
	signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
	const isCurrent = (): boolean => { if (!active || owner.signal.aborted) return false; try { ports.assertCurrent(); return true; } catch { return false; } };
	const absolute = (value: number): boolean => {
		if (!isCurrent() || !Number.isFinite(value)) return false;
		last = Math.max(last, Math.max(0, Math.min(1, value)));
		if (!ports.task.setPhase(label, { start: 0, end: 1, value: last }, localization)) return false;
		ports.reportProgress(last); return true;
	};
	const taskProgress = Object.freeze({
		getSnapshot: () => ({ kind: 'export', value: last }),
		setActivePhase(nextLabel: unknown, phase: EditorTaskProgressPhase = {}, nextLocalization?: LocalizedPresentationMessage): boolean {
			label = String(nextLabel ?? ''); localization = nextLocalization; start = phase.start ?? last; end = phase.end ?? 1;
			return absolute(start + (end - start) * (phase.value ?? 0));
		},
		updateActive: (value: number): boolean => absolute(start + (end - start) * value),
		setCancellation(next: () => void): boolean { if (!isCurrent()) return false; cancel = next; return true; },
	});
	return Object.freeze({ signal: owner.signal, taskProgress, reportAbsolute: absolute,
		setStatus(message: unknown, state?: string, descriptor?: LocalizedPresentationMessage): void { if (isCurrent()) ports.setStatus(message, state, descriptor); },
		dispose(): void { active = false; cancel = null; signal.removeEventListener('abort', abort); },
	});
}
