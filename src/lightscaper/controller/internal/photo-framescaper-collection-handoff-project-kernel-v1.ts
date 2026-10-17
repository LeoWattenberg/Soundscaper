/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { framescaperImageSourceResourceReferencesCurrentV1 } from '../../../common/editor/timeline-image-model-current-v1.ts';
import { assertHandoffProfile, normalizeEditableSourceForProfileV1, type HandoffProfile } from './photo-image-handoff-model-kernel-v1.ts';
import { FRAMESCAPER_IMAGE_TICKS_PER_SECOND } from '../../../common/editor/timeline-image-model.ts';
import { createVideoTrack } from '../../../common/editor/project-media-factory.ts';
import { createFramescaperProject, type FramescaperProject } from '../../../framescaper/editor-project.ts';
import { applyFramescaperProjectCommand, type FramescaperProjectCommand } from '../../../framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../framescaper/editor-project-runtime-profile.ts';
import { id, name } from '../../catalog/value-validation.ts';

export interface PhotoFramescaperCollectionHandoffProjectIdentityV1 {
	readonly projectId: string; readonly sequenceId: string; readonly trackId: string;
	readonly clipIds: readonly string[]; readonly name: string; readonly now: string;
}

/** Assemble an unpublished current Frame sequence in the captured query order.
 * Every selected Photo retains its own source and clip even when originals
 * alias. Sources keep their complete saved recipe/provenance and canonical
 * still duration. This leaf has no resource, storage or archive authority. */
export function createPhotoFramescaperCollectionHandoffProjectForProfileV1(
	profile: HandoffProfile, sourcesValue: unknown, identity: Readonly<PhotoFramescaperCollectionHandoffProjectIdentityV1>,
): FramescaperProject {
	assertHandoffProfile(profile);
	const sources = array(sourcesValue, 'Collection handoff sources', 1, 4_094).map(value => normalizeEditableSourceForProfileV1(profile, value));
	if (profile === 'current3') for (const source of sources) framescaperImageSourceResourceReferencesCurrentV1(source);
	const label = 'Collection handoff project identity';
	const input = record(identity, label, ['projectId', 'sequenceId', 'trackId', 'clipIds', 'name', 'now']);
	const projectId = id(field(input, 'projectId', label), 'collection project ID');
	const sequenceId = id(field(input, 'sequenceId', label), 'collection sequence ID');
	const trackId = id(field(input, 'trackId', label), 'collection track ID');
	const clipIds = array(field(input, 'clipIds', label), 'Collection clip identities', sources.length, sources.length)
		.map(value => id(value, 'collection clip ID'));
	const identifiers = [projectId, sequenceId, trackId, ...clipIds, ...sources.map(source => source.id)];
	if (new Set(identifiers).size !== identifiers.length) throw new Error('Collection handoff identifiers must be distinct.');
	const title = name(field(input, 'name', label), 'collection handoff name'), now = field(input, 'now', label);
	if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) throw new TypeError('Collection handoff requires an admitted timestamp.');
	const denominator = BigInt(FRAMESCAPER_IMAGE_TICKS_PER_SECOND), commands: FramescaperProjectCommand[] = [];
	let nextFrame = 0n;
	for (const [index, source] of sources.entries()) {
		if (source.canonical.frameCount !== 1) throw new RangeError('Collection handoff requires single still sources.');
		const frameCount = (BigInt(source.canonical.durationTicks) * 30n + denominator - 1n) / denominator;
		if (nextFrame + frameCount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Collection sequence frame range is unsafe.');
		const clipId = clipIds[index]!;
		commands.push({ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
			{ type: 'image-clip/set', clipId, expectedClip: null, expectedPlacement: null,
				clip: { schemaVersion: 1, kind: 'image', id: clipId, sourceId: source.id, sequenceId,
					sequenceStartFrame: Number(nextFrame), sequenceFrameCount: Number(frameCount), sourceStartTicks: '0' },
				placement: { scope: 'timeline', trackId } });
		nextFrame += frameCount;
	}
	const project = createFramescaperProject(PROFILE, { id: projectId, title, now, sources: [], clips: [], projectBin: { clips: [] },
		tracks: [createVideoTrack({ id: trackId, name: title, clipIds: [], locked: false })],
		sequences: [{ id: sequenceId, rate: { num: 30, den: 1 }, trackIds: [trackId] }], primarySequenceId: sequenceId,
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId, workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] } });
	return applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands }, { now });
}
