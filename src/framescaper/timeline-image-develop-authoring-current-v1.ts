/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProject } from './editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from './editor-project-runtime-profile.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';
import { framescaperEditableImageWorkingBytes } from './timeline-image-current-frame-source.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../common/editor/timeline-image-model-current-v1.ts';
import { prepareFramescaperRawImageWorkingCurrentV1 } from './internal/timeline-image-raw-working-plan-current-v1.ts';
import { prepareFramescaperHdrImageWorkingCurrentV1 } from './internal/timeline-image-hdr-working-plan-current-v1.ts';
import { createImageDevelopHandoffProvenanceHdrCurrentV1 } from '../common/editor/image-develop-handoff-provenance-hdr-current-v1.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../common/editor/video-cube-lut-project-references-current-v1.ts';
import { createImageDevelopHandoffProvenanceCurrentV1 } from '../common/editor/image-develop-handoff-provenance-current-v1.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV1 } from '../common/editor/imaging/image-develop-state-v1.ts';
import { planImageGeometryV1 } from '../common/editor/imaging/image-geometry-plan-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../common/editor/video-image-geometry-v1.ts';

/** Scalar preparation only: the existing command/history and native store own
 * publication and resource bodies. Opening or closing an editor never promotes
 * a source; an explicit changed recipe keeps the immutable authenticated pack. */
export function prepareFramescaperImageDevelopSourceCurrentV1(projectValue: unknown, clipIdValue: unknown,
	developValue: unknown): FramescaperImageSourceSetCommandTimelineImage {
	const project = cloneFramescaperProject(PROFILE, projectValue);
	if (typeof clipIdValue !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(clipIdValue)) throw new TypeError('Image Develop requires an exact selected clip ID.');
	const clip = [...project.clips, ...project.projectBin.clips].find(value => value.id === clipIdValue);
	if (!clip || clip.kind !== 'image') throw new ReferenceError('Image Develop requires a selected timeline image clip.');
	const track = project.tracks.find(value => Array.isArray(value.clipIds) && value.clipIds.includes(clip.id));
	if (track?.locked) throw new Error('The selected image track is locked.');
	const current = project.sources.find(value => value.id === clip.sourceId);
	if (!current || current.kind !== 'image') throw new ReferenceError('The selected image has no exact image source.');
	const source = normalizeFramescaperImageSourceCurrentV1(current);
	if (source.canonical.frameCount !== 1) throw new RangeError('Image Develop requires one static canonical frame.');
	collectFramescaperImageProjectResourcesCurrentV1(project);
	const develop = normalizeImageDevelopStateThroughV4(developValue), previous = source.schemaVersion === 1 ? defaultImageDevelopStateV1() : source.develop;
	const unchanged = JSON.stringify(develop) === JSON.stringify(previous);
	const nextValue = { ...source, schemaVersion: source.schemaVersion === 4 || source.schemaVersion === 5 ? source.schemaVersion : 3, develop,
		developed: natural(develop, source.canonical.width, source.canonical.height),
		provenance: (source.schemaVersion === 5 ? createImageDevelopHandoffProvenanceHdrCurrentV1 : createImageDevelopHandoffProvenanceCurrentV1)({ develop,
			original: { exactName: source.schemaVersion === 1 ? source.original.fileName : source.provenance.original.exactName,
				sha256: source.original.sha256, byteLength: source.original.byteLength },
			origin: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: project.id, revision: project.revision,
				sourceId: source.id, sequenceId: clip.sequenceId, clipId: clip.id } }) };
	const next = unchanged ? source : normalizeFramescaperImageSourceCurrentV1(nextValue);
	// Close the complete next project namespace, including declarations in other
	// sources and disabled/unused inputs, before the command can reach a writer.
	collectFramescaperImageProjectResourcesCurrentV1({ ...project, sources: project.sources.map(value => value.id === source.id ? next : value) });
	if (next.schemaVersion === 4) prepareFramescaperRawImageWorkingCurrentV1(next);
	else if (next.schemaVersion === 5) prepareFramescaperHdrImageWorkingCurrentV1(next);
	else if (BigInt(next.assetByteLength) * 3n + framescaperEditableImageWorkingBytes(next) > 512n * 1024n * 1024n) {
		throw new RangeError('Image Develop exceeds its 512 MiB working byte bound.');
	}
	return Object.freeze({ type: 'image-source/set', sourceId: source.id, expectedSource: source, source: next });
}

function natural(develop: ImageDevelopStateThroughV4, width: number, height: number) {
	let plan = planImageGeometryV1({ schemaVersion: 1, ...develop.geometry, perspective: null }, width, height);
	for (const effect of develop.effects) if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
		plan = planImageGeometryV1(imageGeometryForVideoEffectV1(effect, plan.width, plan.height), plan.width, plan.height);
	}
	return Object.freeze({ width: plan.width, height: plan.height });
}
