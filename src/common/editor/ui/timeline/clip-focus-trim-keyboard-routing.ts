/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveFrameCanonicalClipFocusIntent,
	type FrameCanonicalClipFocusStep,
} from '../../frame-canonical-clip-focus-step-request.ts';

export type ClipFocusTrimKeyboardOperation = 'trim' | 'rate-stretch';

export interface ClipFocusTrimKeyboardClip {
	readonly id: unknown;
	readonly kind: unknown;
	readonly avLinkId?: unknown;
}

export interface ClipFocusTrimKeyboardRoutingInput {
	readonly blocked: boolean;
	readonly videoCompositing: boolean;
	readonly clipId: unknown;
	readonly operation: ClipFocusTrimKeyboardOperation;
	readonly edge: unknown;
	readonly callbackDeltaSeconds: unknown;
	readonly resolveFocusedClip: (
		clipId: unknown,
	) => ClipFocusTrimKeyboardClip | null | undefined;
	readonly commitCanonicalTrim: (step: FrameCanonicalClipFocusStep) => unknown;
	readonly commitCanonicalRateStretch: (step: FrameCanonicalClipFocusStep) => unknown;
	readonly commitLegacy: () => unknown;
}

/**
 * Route one existing TrackNew clip callback without turning its 0.1-second
 * payload into canonical timing authority. A non-empty A/V relation selects
 * the canonical service; any refusal from that service deliberately escapes.
 */
export function routeClipFocusTrimKeyboard(
	input: ClipFocusTrimKeyboardRoutingInput,
): unknown {
	if (input.blocked) return undefined;
	if (input.videoCompositing !== true) return input.commitLegacy();
	const focusedClip = input.resolveFocusedClip(input.clipId);
	if (!isLinkedAudioClip(focusedClip)) return input.commitLegacy();
	const intent = resolveFrameCanonicalClipFocusIntent(
		input.edge,
		input.callbackDeltaSeconds,
	);
	const step = Object.freeze({
		activeClipId: String(focusedClip.id),
		...intent,
	});
	return input.operation === 'trim'
		? input.commitCanonicalTrim(step)
		: input.commitCanonicalRateStretch(step);
}

function isLinkedAudioClip(
	clip: ClipFocusTrimKeyboardClip | null | undefined,
): clip is ClipFocusTrimKeyboardClip {
	return clip?.kind === 'audio'
		&& typeof clip.avLinkId === 'string'
		&& clip.avLinkId.length > 0;
}
