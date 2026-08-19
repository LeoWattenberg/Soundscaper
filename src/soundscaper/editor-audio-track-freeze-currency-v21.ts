/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioTrackFreezeRenderFingerprintV1 } from '../common/editor/audio-track-freeze-v21.ts';
import type { SoundscaperProjectV21 } from './editor-project-v21.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface FreezeCurrencyController {
	readonly project: unknown;
}

export interface SoundscaperFreezeTicketV21 {
	readonly project: SoundscaperProjectV21;
	readonly trackId: string;
	readonly fingerprint: string;
}

/**
 * Whether the document still says what the render was started against.
 *
 * Object identity answered a different question: every command publishes a new
 * document, so moving the selection during a freeze aborted it and rolled the
 * work back although nothing the render reads had changed. The fingerprint
 * states the render's own inputs, so an edit that touches them still stops the
 * freeze — and one that does not, does not.
 */
export function assertCurrentSoundscaperFreezeProjectV21(
	controller: FreezeCurrencyController,
	ticket: SoundscaperFreezeTicketV21,
): void {
	if (controller.project === ticket.project) return;
	const current = controller.project as SoundscaperProjectV21 | undefined;
	if (current?.id !== ticket.project.id) {
		throw new DOMException('The audio freeze project changed.', 'AbortError');
	}
	if (currentFingerprint(current, ticket) !== ticket.fingerprint) {
		throw new DOMException('The audio freeze project changed.', 'AbortError');
	}
}

function currentFingerprint(
	project: SoundscaperProjectV21,
	ticket: SoundscaperFreezeTicketV21,
): string | null {
	try {
		return soundscaperFreezeRenderFingerprintV21(project, ticket.trackId);
	} catch {
		// A track that is gone, locked out, or no longer readable is a change.
		return null;
	}
}

/** The fingerprint of everything the freeze render reads from one track. */
export function soundscaperFreezeRenderFingerprintV21(
	project: SoundscaperProjectV21,
	trackId: string,
): string {
	const document = project as unknown as DataRecord;
	const track = records(document.tracks).find((candidate) => String(candidate.id) === trackId);
	if (!track) throw new ReferenceError(`Audio freeze track ${trackId} does not exist.`);
	const clipIds = new Set(
		(Array.isArray(track.clipIds) ? track.clipIds as readonly unknown[] : []).map(String),
	);
	const clips = records(document.clips).filter((clip) => clipIds.has(String(clip.id)));
	const sourceIds = [...new Set(clips.map((clip) => String(clip.sourceId)))].sort();
	const sources = records(document.sources);
	return audioTrackFreezeRenderFingerprintV1({
		sampleRate: Number(document.sampleRate),
		track,
		clips,
		sourceContentIdentities: sourceIds.map((sourceId) => Object.freeze({
			sourceId,
			contentSha256: persistedContentDigest(sources, sourceId),
		})),
		automationLanes: records(document.automationLanes),
		tempoMap: document.tempoMap ?? null,
	});
}

/**
 * The digest the document states for a source, or a stand-in.
 *
 * The fingerprint compares two readings of the same document, so a source with
 * no persisted digest is compared as itself; the authoritative content check
 * happens at publication, where the bytes have actually been read.
 */
function persistedContentDigest(sources: readonly DataRecord[], sourceId: string): string {
	const source = sources.find((candidate) => String(candidate.id) === sourceId);
	const digestValue = source?.contentSha256;
	return typeof digestValue === 'string' && /^[a-f0-9]{64}$/u.test(digestValue)
		? digestValue
		: '0'.repeat(64);
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value as readonly DataRecord[] : [];
}
