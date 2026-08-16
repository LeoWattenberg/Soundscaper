/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `PersistentRenderQueuePortV1` — the renderer-facing surface of the durable
 * background queue.
 *
 * The port describes and steers work; it never executes any. Running a job
 * stays behind `RenderJobHostPort`, so nothing here can start a process, and
 * the only identifiers it exchanges are opaque ids minted by main. Every
 * operation is abortable and every payload is a bounded port message, which is
 * what keeps a queue with thousands of rows from turning `list` into an
 * unbounded transfer.
 */

import type {
	AbortablePortOperation,
	BoundedPortMessage,
} from './bounded-transfer.ts';

export interface PersistentRenderQueueEnqueueRequest<Description>
	extends AbortablePortOperation {
	readonly description: BoundedPortMessage<Description>;
}

export interface PersistentRenderQueueJobRequest extends AbortablePortOperation {
	readonly jobId: string;
}

export interface PersistentRenderQueueReorderRequest extends PersistentRenderQueueJobRequest {
	readonly position: number;
}

export interface PersistentRenderQueueListRequest extends AbortablePortOperation {
	/** Bounded page size; the port never returns the whole queue at once. */
	readonly limit: number;
	readonly cursor?: string;
}

export interface PersistentRenderQueuePortV1<
	Description = unknown,
	Summary = unknown,
	Event = unknown,
> {
	enqueue(request: PersistentRenderQueueEnqueueRequest<Description>):
		Promise<BoundedPortMessage<Summary>>;
	list(request: PersistentRenderQueueListRequest):
		Promise<BoundedPortMessage<readonly Summary[]>>;
	/** Resolves null when the event stream has ended for this subscription. */
	events(request: AbortablePortOperation): Promise<BoundedPortMessage<Event> | null>;
	reorder(request: PersistentRenderQueueReorderRequest): Promise<void>;
	pause(request: PersistentRenderQueueJobRequest): Promise<void>;
	resume(request: PersistentRenderQueueJobRequest): Promise<void>;
	cancel(request: PersistentRenderQueueJobRequest): Promise<void>;
	retry(request: PersistentRenderQueueJobRequest): Promise<void>;
}
