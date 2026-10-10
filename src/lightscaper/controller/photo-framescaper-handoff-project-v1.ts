/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { normalizeFramescaperImageSourceV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { FRAMESCAPER_IMAGE_TICKS_PER_SECOND } from '../../common/editor/timeline-image-model.ts';
import { createVideoTrack } from '../../common/editor/project-media-factory.ts';
import { createFramescaperProject, type FramescaperProject } from '../../framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../../framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../framescaper/editor-project-runtime-profile.ts';
import { id } from '../catalog/value-validation.ts';

export interface PhotoFramescaperHandoffProjectIdentityV1 {
	readonly projectId: string; readonly sequenceId: string; readonly trackId: string; readonly clipId: string; readonly now: string;
}

/** Assemble one unpublished current Frame document using its own factory and
 * commands. Natural dimensions and ordered Develop remain source authority;
 * the original pack is never flattened into developed pixels. */
export function createPhotoFramescaperHandoffProjectV1(sourceValue: unknown, identity: Readonly<PhotoFramescaperHandoffProjectIdentityV1>): FramescaperProject {
	const source = normalizeFramescaperImageSourceV2(sourceValue), label = 'Photo handoff project identity';
	const input = record(identity, label, ['projectId', 'sequenceId', 'trackId', 'clipId', 'now']);
	const projectId = id(field(input, 'projectId', label), 'handoff project ID'), sequenceId = id(field(input, 'sequenceId', label), 'handoff sequence ID');
	const trackId = id(field(input, 'trackId', label), 'handoff track ID'), clipId = id(field(input, 'clipId', label), 'handoff clip ID');
	if (new Set([projectId, sequenceId, trackId, clipId, source.id]).size !== 5) throw new Error('Image handoff identifiers must be distinct.');
	const now = field(input, 'now', label);
	if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) throw new TypeError('Image handoff requires an admitted timestamp.');
	if (source.canonical.frameCount !== 1) throw new RangeError('Image handoff requires one single still frame.');
	const ticks = BigInt(source.canonical.durationTicks), denominator = BigInt(FRAMESCAPER_IMAGE_TICKS_PER_SECOND);
	const sequenceFrameCount = Number((ticks * 30n + denominator - 1n) / denominator);
	const project = createFramescaperProject(PROFILE, { id: projectId, title: source.name, now, sources: [], clips: [], projectBin: { clips: [] },
		tracks: [createVideoTrack({ id: trackId, name: source.name, clipIds: [], locked: false })],
		sequences: [{ id: sequenceId, rate: { num: 30, den: 1 }, trackIds: [trackId] }], primarySequenceId: sequenceId,
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId, workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] } });
	return applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId, expectedClip: null, expectedPlacement: null,
			clip: { schemaVersion: 1, kind: 'image', id: clipId, sourceId: source.id, sequenceId, sequenceStartFrame: 0, sequenceFrameCount, sourceStartTicks: '0' },
			placement: { scope: 'timeline', trackId } },
	] }, { now });
}
