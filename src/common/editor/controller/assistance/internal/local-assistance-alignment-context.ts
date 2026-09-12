/* SPDX-License-Identifier: AGPL-3.0-only */

/** Project authenticated stored transcript timing onto the selected alignment audio. */

import { reviewOwnedAssistanceTranscriptV1 } from
	'../../../assistance/owned-transform-validation-v1.ts';
import type { LocalAssistanceGuidedExternalInput } from
	'./guided/local-assistance-guided-transcript-context.ts';

export async function prepareLocalAssistanceAlignmentContext(
	input: LocalAssistanceGuidedExternalInput,
	projectSampleRate: unknown,
): Promise<LocalAssistanceGuidedExternalInput | null> {
	const transcript = reviewOwnedAssistanceTranscriptV1(JSON.parse(await input.bytes.text()) as unknown);
	const { fence } = input;
	if (transcript.sourceId !== fence.sourceId || transcript.sampleRate !== projectSampleRate) {
		throw new TypeError('The alignment transcript does not match its selected audio authority.');
	}
	if (transcript.language !== 'en') return null;
	const segments: Array<{ startSeconds: number; endSeconds: number; text: string }> = [];
	for (const segment of transcript.segments) {
		if (segment.endFrame <= fence.sourceStartFrame || segment.startFrame >= fence.sourceEndFrame) continue;
		let { startFrame, endFrame, text } = segment;
		if (startFrame < fence.sourceStartFrame || endFrame > fence.sourceEndFrame) {
			// A clipped segment's full text cannot describe the shortened audio. Use timed words only.
			if (segment.words.length === 0) return null;
			const words = segment.words.filter((word) => word.startFrame >= fence.sourceStartFrame
				&& word.endFrame <= fence.sourceEndFrame && word.endFrame > word.startFrame);
			if (words.length === 0) continue;
			startFrame = words[0]!.startFrame;
			endFrame = words.at(-1)!.endFrame;
			text = words.map((word) => word.text).join(' ');
		}
		const startSample = Math.round((startFrame - fence.sourceStartFrame) * 16_000 / transcript.sampleRate);
		const endSample = Math.round((endFrame - fence.sourceStartFrame) * 16_000 / transcript.sampleRate);
		if (endSample - startSample < 400 || endSample - startSample > 60 * 16_000) return null;
		segments.push({ startSeconds: startSample / 16_000, endSeconds: endSample / 16_000, text });
	}
	if (segments.length === 0) return null;
	return Object.freeze({ ...input, bytes: new Blob([JSON.stringify({ language: 'en', segments })],
		{ type: input.mediaType }) });
}
