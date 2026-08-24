/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-private request handed from selected V28 authority to the closed media helper. */

import type { NativeMediaV14ExecutionAttempt } from './native-media-v14-executor.ts';
import type { HelperNativeInputGrant } from './helper-native-job-contract.ts';
import type { HelperDataPlaneTransfer } from './helper-data-plane-transfer.ts';
import type { NativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';

export interface FramescaperNativeMediaV14DerivedInputs {
	readonly byteLength: number;
	readonly scratchByteLength?: number;
	readonly materialize: (
		directory: string,
		signal?: AbortSignal,
	) => Promise<readonly HelperNativeInputGrant[]>;
	readonly transfers?: () => readonly HelperDataPlaneTransfer[];
}

export interface FramescaperNativeMediaV14RuntimeRequest {
	readonly adapterVersion: 1;
	readonly attempt: NativeMediaV14ExecutionAttempt;
	readonly sourceBodies: readonly Readonly<{
		readonly grantId: string;
		readonly sourceId: string;
		readonly contentSha256: string;
		readonly mimeType: string;
		readonly byteLength: number;
		readonly materialize: (destination: string, signal?: AbortSignal) => Promise<unknown>;
	}>[];
	readonly timingBodies: readonly Readonly<{
		readonly sourceId: string;
		readonly sha256: string;
		readonly bytes: Uint8Array;
	}>[];
	/** Null only for the independently authenticated single-full-frame CPU family. */
	readonly derivedInputs: FramescaperNativeMediaV14DerivedInputs | null;
	readonly destination: Readonly<{
		readonly jobId: string;
		readonly rootPath: string;
		readonly volumeIdentity: string;
		readonly directoryIdentity: string;
		readonly relativeDestination: string;
		readonly temporaryRelativePath: string;
	}>;
	readonly onProgress: (value: number | null) => void;
}

export interface FramescaperNativeMediaV14RuntimePort {
	available(): boolean;
	executeV14(request: FramescaperNativeMediaV14RuntimeRequest): Promise<unknown>;
	executeProxyV14(request: FramescaperNativeMediaProxyV14RuntimeRequest): Promise<unknown>;
}

export interface FramescaperNativeMediaProxyV14RuntimeRequest {
	readonly adapterVersion: 1;
	readonly envelope: NativeMediaPlanEnvelopeV2;
	readonly sourceBody: FramescaperNativeMediaV14RuntimeRequest['sourceBodies'][number];
	readonly timingBodies: FramescaperNativeMediaV14RuntimeRequest['timingBodies'];
	readonly recipe: Readonly<{
		readonly id: 'framescaper-native-prores-proxy-mov-v1';
		readonly width: number;
		readonly height: number;
	}>;
	readonly destination: FramescaperNativeMediaV14RuntimeRequest['destination'];
	readonly signal?: AbortSignal;
	readonly onProgress: (value: number | null) => void;
}
