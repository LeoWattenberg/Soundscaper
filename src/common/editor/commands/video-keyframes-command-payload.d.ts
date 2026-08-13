/* SPDX-License-Identifier: AGPL-3.0-only */

/** Serializable optimistic replacement payload for one clip-owned V1 curve set. */
export interface VideoKeyframesSetCommandPayload {
	readonly clipId: string;
	readonly expectedKeyframes: VideoKeyframeCommandWire;
	readonly keyframes: VideoKeyframeCommandWire;
}

/** Context-free closed wire; clip-aware normalization owns its nested semantics. */
export interface VideoKeyframeCommandWire extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: 1;
	readonly timeDomain: Readonly<Record<string, unknown>>;
	readonly curves: readonly unknown[];
}
