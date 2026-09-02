/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The state a tab keeps once one of its lazy chunks refuses to arrive.
 *
 * The controller exists so that a failed load and a prompt are two separate
 * events. A rejection only starts a probe; the prompt appears when, and only
 * when, `probeStaleBuild` has proved the origin moved on. Anything else - an
 * offline device, a flaky connection, a genuinely broken chunk - leaves the tab
 * exactly as it was, which is the behaviour it had before this module existed.
 *
 * Staleness is monotonic: a release the origin has retired never comes back, so
 * a proven verdict is remembered and cancelling only hides the prompt. Reaching
 * for a second unloaded feature therefore prompts again immediately, with no
 * further network round trip, which matches what the prompt actually says - the
 * editor has to be reloaded before that function can be used.
 */

import {
	discardStaleBuild,
	isModuleLoadFailure,
	probeStaleBuild,
	type DiscardStaleBuildOptions,
	type StaleBuildProbeOptions,
	type StaleBuildVerdict,
} from './stale-build.ts';

export type StaleBuildStatus = 'idle' | 'checking' | 'prompting' | 'dismissed' | 'reloading';

export interface StaleBuildSnapshot {
	readonly status: StaleBuildStatus;
	/** Whether the dialog should be on screen right now. */
	readonly prompting: boolean;
}

export interface StaleBuildController {
	/** Records a rejection that may be a retired chunk; ignores anything else. */
	report(error: unknown): void;
	subscribe(listener: (snapshot: StaleBuildSnapshot) => void): () => void;
	snapshot(): StaleBuildSnapshot;
	dismiss(): void;
	reload(): Promise<void>;
	/** Resolves once no probe is in flight. Test seam; the application never waits. */
	settled(): Promise<void>;
}

export interface StaleBuildControllerOptions {
	readonly probe?: (options: StaleBuildProbeOptions) => Promise<StaleBuildVerdict>;
	readonly discard?: (options: DiscardStaleBuildOptions) => Promise<void>;
	readonly recognize?: (error: unknown) => boolean;
	readonly moduleUrl: string;
	readonly reload: () => void;
}

export function createStaleBuildController(options: StaleBuildControllerOptions): StaleBuildController {
	const probe = options.probe ?? probeStaleBuild;
	const discard = options.discard ?? discardStaleBuild;
	const recognize = options.recognize ?? isModuleLoadFailure;
	const listeners = new Set<(snapshot: StaleBuildSnapshot) => void>();
	let status: StaleBuildStatus = 'idle';
	let proven = false;
	let pending: Promise<void> | null = null;

	const snapshot = (): StaleBuildSnapshot => Object.freeze({ status, prompting: status === 'prompting' });
	const settle = (next: StaleBuildStatus): void => {
		if (status === next) return;
		status = next;
		const current = snapshot();
		for (const listener of [...listeners]) listener(current);
	};

	const check = (): void => {
		if (pending) return;
		settle('checking');
		pending = probe({ moduleUrl: options.moduleUrl }).then((verdict) => {
			if (verdict === 'stale') {
				proven = true;
				settle('prompting');
			} else settle('idle');
		}, () => {
			settle('idle');
		}).finally(() => {
			pending = null;
		});
	};

	return Object.freeze({
		report(error: unknown): void {
			if (status === 'reloading' || !recognize(error)) return;
			if (proven) {
				settle('prompting');
				return;
			}
			check();
		},
		subscribe(listener: (next: StaleBuildSnapshot) => void): () => void {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		snapshot,
		dismiss(): void {
			if (status === 'prompting') settle('dismissed');
		},
		async reload(): Promise<void> {
			if (status === 'reloading') return;
			settle('reloading');
			await discard({ reload: options.reload });
		},
		async settled(): Promise<void> {
			while (pending) await pending;
		},
	});
}
