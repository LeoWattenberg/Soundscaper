/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerEdgeV21 } from './mixer-graph-v21.ts';

type RoutingProject = Readonly<Record<string, unknown>>;
type TrackCopy = Readonly<{ sourceTrackId: string; targetTrackId: string }>;

export interface DerivedSidechainRoute {
	readonly original: MixerEdgeV21;
	readonly route: MixerEdgeV21;
}

/** A copied detector must address the copied rack, not the original effect identity. */
export function derivedTrackSidechainRoutes(
	originalProject: RoutingProject,
	project: RoutingProject,
	edges: readonly MixerEdgeV21[],
	copies: readonly TrackCopy[],
): readonly DerivedSidechainRoute[] {
	const results: DerivedSidechainRoute[] = [];
	for (const edge of edges) {
		if (edge.destination.kind !== 'effect-sidechain') continue;
		const originalDestination = edge.destination;
		const sourceCopies = edge.source.kind === 'track'
			? copies.filter(copy => edge.source.kind === 'track' && copy.sourceTrackId === edge.source.id) : [];
		const destinationCopies = originalDestination.strip.kind === 'track'
			? copies.filter(copy => originalDestination.strip.kind === 'track'
				&& copy.sourceTrackId === originalDestination.strip.id) : [];
		if (destinationCopies.length) {
			for (const [index, copy] of destinationCopies.entries()) {
				const effectId = copiedEffectId(originalProject, project, copy, originalDestination.effectId);
				if (!effectId) continue;
				const sourceCopy = sourceCopies[index] ?? sourceCopies[0];
				// Combining a detector and its programme removes their separate signal
				// identities; do not turn that external input into a rack feedback loop.
				if (sourceCopy?.targetTrackId === copy.targetTrackId) continue;
				results.push({ original: edge, route: { ...edge,
					source: sourceCopy ? { kind: 'track', id: sourceCopy.targetTrackId } : edge.source,
					destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: copy.targetTrackId }, effectId },
				} });
			}
		} else {
			for (const copy of sourceCopies) results.push({ original: edge, route: {
				...edge, source: { kind: 'track', id: copy.targetTrackId },
			} });
		}
	}
	return results;
}

function copiedEffectId(
	originalProject: RoutingProject,
	project: RoutingProject,
	copy: TrackCopy,
	effectId: string,
): string | null {
	const originalEffects = trackEffects(originalProject, copy.sourceTrackId);
	const index = originalEffects.findIndex(effect => effect.id === effectId);
	const copied = trackEffects(project, copy.targetTrackId)[index];
	return index >= 0 && typeof copied?.id === 'string'
		&& copied.type === originalEffects[index]?.type ? copied.id : null;
}

function trackEffects(project: RoutingProject, trackId: string): readonly RoutingProject[] {
	const tracks: readonly unknown[] = Array.isArray(project.tracks) ? project.tracks : [];
	const track = tracks.find((candidate): candidate is RoutingProject => isRecord(candidate) && candidate.id === trackId);
	const effects: readonly unknown[] = Array.isArray(track?.effects) ? track.effects : [];
	return effects.filter(isRecord);
}

function isRecord(value: unknown): value is RoutingProject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
