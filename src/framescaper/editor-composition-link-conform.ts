/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalJsonSha256 } from '../common/canonical-json-sha256.ts';
import { normalizeMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { divideRationals } from '../common/editor/timeline-time.ts';
import { freezeMotionValue } from '../common/editor/motion-values.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperCompositionLink } from './editor-project-successor-link.ts';
import { prepareFramescaperCompositionConform, snapshotFramescaperCompositionConformCommand } from './editor-composition-link-conform-core.ts';
export type FramescaperCompositionConformPlan = ReturnType<typeof createFramescaperCompositionConformPlan>;
/** Review contains exact source units and every leaf occurrence; timeline/AV/container timing stays authored. */
export function createFramescaperCompositionConformPlan(options: Readonly<{ project: unknown; sourceId: string; offer: unknown }>) {
	const project = normalizeFramescaperSuccessorProject(options.project), offer = normalizeMotionCompositionOffer(options.offer);
	const prior = project.compositionLinks.find(link => link.sourceId === options.sourceId); if (!prior) throw new RangeError('Composition link is unavailable for Conform.');
	const link = createFramescaperCompositionLink(options.sourceId, offer.compositionId, offer.revision, { audioSourceId: prior.audioSourceId });
	const result = prepareFramescaperCompositionConform(project, link), sourceProjectDigest = canonicalJsonSha256(project);
	const command = snapshotFramescaperCompositionConformCommand({ type: 'composition-link/conform', policy: 'fit-source-window', sourceId: options.sourceId, expectedDigest: prior.acceptedDigest, expectedProjectDigest: sourceProjectDigest, link });
	return freezeMotionValue({ policy: 'fit-source-window' as const, timelineSpansUnchanged: true as const, rounding: 'nearest-frame-ties-away-from-zero' as const,
		command, changes: result.changes, sourceProjectDigest, acceptedDigest: prior.acceptedDigest, pendingDigest: offer.revision.digest,
		outputBefore: { ...prior.output, duration: divideRationals(prior.output.durationFrames, prior.output.frameRate), sampleRate: prior.snapshot.project.sampleRate },
		outputAfter: { ...offer.output, duration: divideRationals(offer.output.durationFrames, offer.output.frameRate), sampleRate: offer.revision.project.sampleRate } });
}
/** Rebuild review inside the serialized owner publication, before staging the transition or changing history. */
export function verifyFramescaperCompositionConformPlan(plan: FramescaperCompositionConformPlan, options: Readonly<{ project: unknown; offer: unknown }>) {
	const expected = createFramescaperCompositionConformPlan({ ...options, sourceId: plan.command.sourceId });
	if (plan.sourceProjectDigest !== expected.sourceProjectDigest || plan.acceptedDigest !== expected.acceptedDigest || plan.pendingDigest !== expected.pendingDigest) throw new Error('Composition Conform review is stale; the project or pending offer changed.');
	if (canonicalJsonSha256(plan) !== canonicalJsonSha256(expected)) throw new RangeError('Composition Conform plan differs from the exact review.');
	return expected.command;
}
