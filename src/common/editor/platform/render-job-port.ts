/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AbortablePortOperation,
	BoundedPortMessage,
} from './bounded-transfer.ts';
import type { MediaByteWriterPort } from './media-stream-port.ts';

export interface RenderJobOpenRequest<Request> extends AbortablePortOperation {
	readonly request: BoundedPortMessage<Request>;
	readonly destination: MediaByteWriterPort;
}

export interface RenderJobPort<Progress = unknown, Result = unknown> {
	read(request: AbortablePortOperation): Promise<BoundedPortMessage<Progress> | null>;
	result(request: AbortablePortOperation): Promise<BoundedPortMessage<Result>>;
	cancel(request: AbortablePortOperation & Readonly<{ reason?: unknown }>): Promise<void>;
}

export interface RenderJobHostPort<Request = unknown, Progress = unknown, Result = unknown> {
	open(request: RenderJobOpenRequest<Request>): Promise<RenderJobPort<Progress, Result>>;
}
