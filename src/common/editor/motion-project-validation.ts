/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitAudioEditorProjectValidationStructure, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from './project-validation-budget.ts';
import { normalizeMotionWorkArea } from './motion-composition-work-area.ts';
import { normalizeMotionAsset } from './motion-asset.ts';
import type { MotionComposition } from './motion-composition.ts';
import { normalizeMotionAudioPlacement, normalizeMotionLayer } from './motion-layer-validation.ts';
import { motionColor } from './motion-property.ts';
import { freezeMotionValue, motionArray, motionEnum, motionId, motionInteger, motionRational, motionRecord, motionString, uniqueMotionIds } from './motion-values.ts';
import { validateMotionscaperProjectGraph } from './motion-project-graph.ts';
import type { MotionscaperProject } from './motion-project-types.ts';

export type { MotionscaperProject } from './motion-project-types.ts';

/** Detach persisted intent; renderer state and source discovery never enter this wire. */
export function normalizeMotionscaperProject(value: unknown): MotionscaperProject {
	admitAudioEditorProjectValidationStructure(value, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS);
	const record = motionRecord(value, ['schemaFamily', 'schemaVersion', 'id', 'title', 'revision', 'sampleRate', 'primaryCompositionId', 'compositions', 'assets'], 'Motionscaper project');
	if (record.schemaFamily !== 'motionscaper') throw new RangeError('Motionscaper project family must be motionscaper.');
	if (record.schemaVersion !== 1) throw new RangeError('Motionscaper project version must be 1.');
	const compositions = motionArray(record.compositions, 1024, 'project compositions', 1).map(normalizeMotionComposition);
	const assets = motionArray(record.assets, 16384, 'project assets').map(normalizeMotionAsset);
	assets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	const project = {
		schemaFamily: 'motionscaper' as const, schemaVersion: 1 as const,
		id: motionId(record.id, 'project ID'), title: motionString(record.title, 'project title'),
		revision: motionInteger(record.revision, 'project revision'), sampleRate: motionInteger(record.sampleRate, 'project sample rate', 8000, 768000),
		primaryCompositionId: motionId(record.primaryCompositionId), compositions, assets,
	};
	validateMotionscaperProjectGraph(project);
	return freezeMotionValue(project);
}

export function normalizeMotionComposition(value: unknown): MotionComposition {
	const fields = ['id', 'name', 'width', 'height', 'frameRate', 'durationFrames', 'background', 'color', 'layers', 'audio'];
	const record = motionRecord(value, [...fields, 'workArea'], 'motion composition', fields);
	const durationFrames = motionInteger(record.durationFrames, 'composition duration', 1, 100_000_000);
	const color = motionRecord(record.color, ['workingSpace', 'outputSpace', 'alphaMode'], 'composition color');
	const layers = motionArray(record.layers, 4096, 'composition layers').map(normalizeMotionLayer);
	const audio = motionArray(record.audio, 4096, 'composition audio').map(normalizeMotionAudioPlacement);
	uniqueMotionIds([...layers, ...audio], 'composition layers and audio');
	return freezeMotionValue({
		id: motionId(record.id), name: motionString(record.name, 'composition name'), width: motionInteger(record.width, 'composition width', 1, 65536),
		height: motionInteger(record.height, 'composition height', 1, 65536), frameRate: motionRational(record.frameRate, 'composition frame rate', true),
		durationFrames,
		background: motionColor(record.background as Parameters<typeof motionColor>[0]).value,
		color: { workingSpace: motionEnum(color.workingSpace, ['linear-rec709-d65'], 'working space'),
			outputSpace: motionEnum(color.outputSpace, ['srgb', 'rec709'], 'output space'), alphaMode: motionEnum(color.alphaMode, ['premultiplied'], 'working alpha') },
		layers, audio, ...(Object.hasOwn(record, 'workArea') ? { workArea: normalizeMotionWorkArea(record.workArea, durationFrames) } : {}),
	});
}
