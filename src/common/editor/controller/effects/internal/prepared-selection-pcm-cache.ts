/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_PROJECT_TASK_SCOPE, isCurrentAssertion, type EditorProjectToken,
	type EditorTaskScope } from '../../shared/lifecycle.ts';

const MAXIMUM_PREPARED_PCM_BYTES = 32 * 1024 ** 2;

interface PreparationCacheRuntime {
	readonly authority: () => object | null;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly startTask: (name: string, options: { scope: string }) => EditorTaskScope;
}

interface PreparedSelection {
	readonly authority: object;
	readonly key: string;
	readonly channels: Float32Array[][];
	readonly task: EditorTaskScope;
	readonly project: EditorProjectToken;
}

/** Canonical controller ownership is opt-in; a consumed entry never retains transferred PCM. */
export function createPreparedSelectionPcmCache(runtime: PreparationCacheRuntime) {
	let prepared: PreparedSelection | null = null;
	function clear(): void {
		prepared?.task.finish();
		prepared = null;
	}
	return {
		clear,
		retain(authority: object | null, key: string, channels: readonly (readonly Float32Array[])[], headroomBytes: number): void {
			clear();
			if (!Number.isFinite(headroomBytes) || headroomBytes <= 0) return;
			const bytes = channels.reduce((total, set) => total + set.reduce((sum, channel) => sum + channel.byteLength, 0), 0);
			if (!authority || authority !== runtime.authority() || !bytes
				|| bytes > Math.min(MAXIMUM_PREPARED_PCM_BYTES, headroomBytes)) return;
			const task = runtime.startTask('selection-effect-prepared-audio', { scope: EDITOR_PROJECT_TASK_SCOPE });
			const entry: PreparedSelection = { authority, key, task, project: runtime.captureProject(),
				channels: channels.map((set) => set.map((channel) => channel.slice())) };
			prepared = entry;
			task.signal.addEventListener('abort', () => { if (prepared === entry) clear(); }, { once: true });
		},
		take(key: string): Float32Array[][] | null {
			const entry = prepared;
			const current = entry && entry.key === key && entry.authority === runtime.authority()
				&& isCurrentAssertion(() => { entry.task.assertCurrent(); runtime.assertProject(entry.project); });
			clear();
			return current ? entry.channels : null;
		},
	};
}

interface PreparedPcmTarget {
	readonly track: { readonly id: string };
	readonly startFrame: number;
	readonly endFrame: number;
	readonly channelCount: number;
	readonly clipIds?: readonly string[] | null;
	readonly sourceSampleRate?: number;
	readonly sourceFrameCount?: number;
}

export function preparedSelectionPcmKey(targets: readonly PreparedPcmTarget[]): string {
	return JSON.stringify(targets.map((target) => [target.track.id, target.startFrame, target.endFrame,
		target.channelCount, target.clipIds ?? null, target.sourceSampleRate ?? null, target.sourceFrameCount ?? null]));
}
