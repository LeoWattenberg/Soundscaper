/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingSourceSegment,
	RecordingSourceWriter,
	RecordingWriterFinish,
} from '../recording-transaction-types.ts';

/** Ordinary writers remain one segment; checkpoint writers can salvage a prefix. */
export async function finishRecordingSegments(
	writer: RecordingSourceWriter,
	sourceId: string,
	metadata: Readonly<Record<string, unknown>>,
): Promise<RecordingWriterFinish> {
	if (writer.finishRecording) return writer.finishRecording(metadata);
	const frameCount = writer.framesWritten;
	if (frameCount <= 0) {
		await writer.abort();
		return Object.freeze({ segments: Object.freeze([]) });
	}
	const storedMetadata = await writer.commit(metadata);
	const segment: RecordingSourceSegment = Object.freeze({
		sourceId, frameStart: 0, frameCount, metadata: storedMetadata,
	});
	return Object.freeze({ segments: Object.freeze([segment]) });
}
