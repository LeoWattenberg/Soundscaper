/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CaptureDirectUserAction,
	CaptureRuntimeAvailability,
	CaptureSourceRole,
} from '../framescaper-capture-domain.ts';
import type { AbortablePortOperation } from './bounded-transfer.ts';

export interface CaptureSourceProbeRequest extends AbortablePortOperation {
	readonly embedded: boolean;
}

export interface CaptureSourceDeviceDescriptor {
	readonly id: string;
	readonly kind: 'camera' | 'microphone';
	/** Empty labels are never replaced with an invented or persisted label. */
	readonly label: string;
}

export interface CaptureSourceEnumerateRequest extends AbortablePortOperation {
	/** Device inventory remains empty until the host has observed permission. */
	readonly permissionGranted: boolean;
}

export interface CaptureSourceInventory {
	readonly devices: readonly Readonly<CaptureSourceDeviceDescriptor>[];
}

export interface CaptureSourceOpenPreviewRequest extends AbortablePortOperation {
	/** A controller-issued one-shot generation consumed before any device opens. */
	readonly userActionGeneration: CaptureDirectUserAction['generation'];
	readonly roles: readonly CaptureSourceRole[];
	readonly cameraDeviceId?: string;
	readonly microphoneDeviceId?: string;
}

export interface CapturePreviewSource<Stream = unknown, Track = unknown> {
	readonly sourceId: string;
	readonly role: CaptureSourceRole;
	readonly stream: Stream;
	readonly track: Track;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly capabilities: Readonly<Record<string, unknown>>;
}

export interface CapturePreviewLease<Stream = unknown, Track = unknown> {
	readonly sources: readonly Readonly<CapturePreviewSource<Stream, Track>>[];
	/** Idempotent and non-cancellable once cleanup starts. */
	dispose(): Promise<void>;
}

/** React-independent source discovery and explicit preview authority. */
export interface CaptureSourcePortV1<Stream = unknown, Track = unknown> {
	probe(request: CaptureSourceProbeRequest): Promise<CaptureRuntimeAvailability>;
	enumerate(request: CaptureSourceEnumerateRequest): Promise<CaptureSourceInventory>;
	openPreview(request: CaptureSourceOpenPreviewRequest): Promise<CapturePreviewLease<Stream, Track>>;
}
