/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WebVcrLifecyclePhase, WebVcrSnapshot } from '../web-vcr-domain.ts';

type SnapshotIdentity = Readonly<Pick<WebVcrSnapshot, 'generation' | 'sessionId' | 'phase'>>;

export interface FramescaperWebVcrSnapshotOrder {
	readonly generation: number;
	accept(value: SnapshotIdentity): boolean;
}

/** Keeps delayed main-to-renderer snapshot delivery from reviving retired guest authority. */
export function createFramescaperWebVcrSnapshotOrder(): Readonly<FramescaperWebVcrSnapshotOrder> {
	let current: Readonly<{
		readonly generation: number;
		readonly sessionId: string | null;
		readonly terminal: boolean;
	}> | null = null;
	return Object.freeze({
		get generation() { return current?.generation ?? 0; },
		accept(value: SnapshotIdentity): boolean {
			if (!supersedes(current, value)) return false;
			current = Object.freeze({
				generation: value.generation,
				sessionId: value.sessionId,
				terminal: value.phase === 'closed',
			});
			return true;
		},
	});
}

function supersedes(
	current: Readonly<{ readonly generation: number; readonly sessionId: string | null;
		readonly terminal: boolean }> | null,
	next: Readonly<{ readonly generation: number; readonly sessionId: string | null;
		readonly phase: WebVcrLifecyclePhase }>,
): boolean {
	if (!current || next.generation > current.generation) return true;
	if (next.generation < current.generation) return false;
	if (current.terminal) return next.phase === 'closed' && next.sessionId === null;
	if (next.phase === 'closed') return next.sessionId === null;
	return next.sessionId !== null && next.sessionId === current.sessionId;
}
