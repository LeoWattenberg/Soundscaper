/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureRecorder } from './framescaper-capture-session-types.ts';

interface RecorderOwner {
	readonly recorder: FramescaperCaptureRecorder;
}

export interface FramescaperCaptureRecorderStartFence {
	readonly hasDurablePacket: boolean;
	start(
		recorders: readonly RecorderOwner[],
		activeTimeUs: number,
		isActive: () => boolean,
	): Promise<void>;
	admitDurablePacket(): void;
	waitForPendingStart(): Promise<void>;
	reset(): void;
}

/** Serializes recorder startup against graph teardown and remembers durable startup output. */
export function createFramescaperCaptureRecorderStartFence(): FramescaperCaptureRecorderStartFence {
	let pending: Promise<void> | null = null;
	let hasDurablePacket = false;
	return Object.freeze({
		get hasDurablePacket() { return hasDurablePacket; },
		async start(
			recorders: readonly RecorderOwner[],
			activeTimeUs: number,
			isActive: () => boolean,
		) {
			for (const { recorder } of recorders) {
				if (!isActive()) {
					throw new DOMException('Capture recorder startup was interrupted.', 'AbortError');
				}
				const operation = Promise.resolve().then(() => recorder.start(activeTimeUs));
				pending = operation;
				try { await operation; }
				finally { if (pending === operation) pending = null; }
			}
		},
		admitDurablePacket() { hasDurablePacket = true; },
		async waitForPendingStart() {
			const operation = pending;
			if (operation) await operation.catch(() => undefined);
		},
		reset() { hasDurablePacket = false; },
	});
}
