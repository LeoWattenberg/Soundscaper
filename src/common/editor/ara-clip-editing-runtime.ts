/* SPDX-License-Identifier: AGPL-3.0-only */

export interface AraRenderedClip {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
	readonly name?: string;
}

export interface AraClipPublication {
	readonly trackId: string;
	readonly clipId: string;
	readonly sourceId: string;
}

/** PCM and document publication authority belong to the selected clip operation. */
export interface AraPreparedClipEdit {
	readonly sourceId: string;
	readonly name: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly sourceStartSeconds: number;
	readonly playbackStartSeconds: number;
	readonly durationSeconds: number;
	readonly channels: readonly Float32Array[];
	assertCurrent(): void;
	apply(result: AraRenderedClip): Promise<AraClipPublication>;
	cancel(): void;
}

export interface AraClipEditingRuntime {
	prepare(options?: Readonly<{ signal?: AbortSignal }>): Promise<AraPreparedClipEdit>;
}

/** Both product facades preserve the common controller's exact preparation port. */
export function resolveAraClipEditingRuntime(owner: unknown): AraClipEditingRuntime | null {
	if (!owner || typeof owner !== 'object') return null;
	const runtime = (owner as { readonly araClipEditing?: unknown }).araClipEditing;
	return runtime && typeof runtime === 'object' && 'prepare' in runtime
		&& typeof runtime.prepare === 'function' ? runtime as AraClipEditingRuntime : null;
}
