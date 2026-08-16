/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `ExternalDisplayPortV1` — the clean programme output surface.
 *
 * The port presents frames that have already been evaluated; it is not a second
 * render engine and owns no timeline, effects, or clock of its own. `present`
 * therefore takes a frame the editor produced, not a description of one to
 * produce. Nothing here is persisted: the selection lives for the session, so
 * the port exposes no save or restore at all.
 */

import type {
	AbortablePortOperation,
	BoundedByteChunk,
	BoundedPortMessage,
} from './bounded-transfer.ts';

export interface ExternalDisplayOpenRequest extends AbortablePortOperation {
	readonly displayId: string;
}

export interface ExternalDisplayPresentRequest extends AbortablePortOperation {
	/** One already-evaluated frame from the editor's own stream. */
	readonly frame: BoundedByteChunk;
	/** The editor transport clock's position for this frame. */
	readonly presentationFrame: number;
}

export interface ExternalDisplayPortV1<
	Display = unknown,
	Status = unknown,
> {
	listDisplays(request: AbortablePortOperation):
		Promise<BoundedPortMessage<readonly Display[]>>;
	open(request: ExternalDisplayOpenRequest): Promise<BoundedPortMessage<Status>>;
	present(request: ExternalDisplayPresentRequest): Promise<void>;
	close(request: AbortablePortOperation): Promise<void>;
	/** Resolves null when the surface is gone and no further status will arrive. */
	events(request: AbortablePortOperation): Promise<BoundedPortMessage<Status> | null>;
}
