/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	commitDirectCompressedDestination,
	directCompressedStagingTemporaryBytes,
	encodeDirectCompressedStagedFile,
	prepareDirectCompressedDestination,
	type DirectCompressedDestination,
	type DirectCompressedEncodeOptions,
	type DirectCompressedEncodedOutput,
	type DirectCompressedFileService,
	type DirectCompressedPlan,
	type DirectCompressedPreparation,
} from './direct-compressed-export.ts';

export type DirectMp3Destination = DirectCompressedDestination;
export type DirectMp3Preparation = DirectCompressedPreparation;
export type DirectMp3EncodeOptions = DirectCompressedEncodeOptions;
export type DirectMp3EncodedOutput = DirectCompressedEncodedOutput & Readonly<{ mimeType: 'audio/mpeg' }>;

/** Temporary MP3-only adapter retained while maintained policy evidence moves to the generic owner. */
export async function prepareDirectMp3Destination(
	fileService: DirectCompressedFileService,
	plan: DirectCompressedPlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectMp3Preparation> {
	if (plan.format !== 'mp3') return Object.freeze({ cancelled: null, destination: null });
	return prepareDirectCompressedDestination(fileService, plan, requestedSettings, signal);
}

export function directMp3StagingTemporaryBytes(plan: DirectCompressedPlan): number | null {
	return plan.format === 'mp3' ? directCompressedStagingTemporaryBytes(plan) : null;
}

export async function encodeDirectMp3StagedFile(
	options: DirectMp3EncodeOptions,
): Promise<DirectMp3EncodedOutput> {
	if (options.plan.format !== 'mp3') throw new TypeError('The MP3 adapter requires an MP3 export plan.');
	return await encodeDirectCompressedStagedFile(options) as DirectMp3EncodedOutput;
}

export async function commitDirectMp3Destination(
	destination: DirectMp3Destination,
	plan: DirectCompressedPlan,
	emittedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	if (plan.format !== 'mp3') throw new TypeError('The MP3 adapter requires an MP3 export plan.');
	return commitDirectCompressedDestination(destination, plan, emittedByteLength, assertReadyToCommit);
}
