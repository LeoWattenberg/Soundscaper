/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from './stable-id.js';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from './video-visual-model-v24.ts';

type Data = Readonly<Record<string, unknown>>;

/** Selected occurrence edits retain generator sources used by other timeline/bin clips. */
export function createSelectedGeneratorSourceCommands(
	project: Data, clipValue: Data, currentValue: unknown, replacementValue: unknown,
): readonly unknown[] {
	const current = normalizeVideoGeneratorSourceV1(currentValue);
	const replacement = normalizeVideoGeneratorSourceV1(replacementValue);
	const bin = project.projectBin !== null && typeof project.projectBin === 'object'
		&& !Array.isArray(project.projectBin) ? project.projectBin as Data : {};
	const shared = [...optionalRecords(project.clips), ...optionalRecords(bin.clips)]
		.some(clip => clip.id !== clipValue.id && clip.sourceId === current.id);
	if (!shared) return [{ type: 'video-visual-source/set', sourceId: current.id,
		expectedSource: current, source: replacement }];
	const clip = normalizeVideoGeneratorClipV1(clipValue);
	const owner = optionalRecords(project.tracks).find(track =>
		Array.isArray(track.clipIds) && track.clipIds.includes(clip.id));
	if (!owner || typeof owner.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(owner.id)) {
		throw new ReferenceError('The selected visual clip has no owning picture track.');
	}
	const placement = { scope: 'timeline', trackId: owner.id };
	const sourceId = createStableId('visual-source');
	return [{ type: 'video-visual-source/set', sourceId, expectedSource: null,
		source: normalizeVideoGeneratorSourceV1({ ...replacement, id: sourceId }) },
	{ type: 'video-visual-clip/set', clipId: clip.id, expectedClip: clip,
		expectedPlacement: placement, clip: { ...clip, sourceId }, placement }];
}

function optionalRecords(value: unknown): Data[] {
	return Array.isArray(value) ? value.filter((entry): entry is Data =>
		entry !== null && typeof entry === 'object' && !Array.isArray(entry)) : [];
}
