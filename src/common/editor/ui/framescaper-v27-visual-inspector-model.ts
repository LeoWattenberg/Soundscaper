/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../native-media-plan-canonical-form.ts';
import { createStableId } from '../stable-id.js';
import { normalizeVideoMaskMatteGraphV1 } from '../video-mask-matte-v24.ts';
import { normalizeVideoVisualPresetV1 } from '../video-visual-preset-v24.ts';
import {
	normalizeVideoGeneratorClipV1,
	normalizeVideoGeneratorSourceV1,
	normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1,
	type VideoGeneratorDocumentV1,
} from '../video-visual-model-v24.ts';
import {
	normalizeVideoVisualPresentationV1,
	type VideoVisualPresentationV1,
} from '../video-visual-presentation-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from '../../../framescaper/editor-project-v28-foundation.ts';
import { framescaperProjectV27FoundationShapeV30 } from '../../../framescaper/editor-project-v30-foundation.ts';
import { framescaperProjectV28FoundationShapeV31 } from '../../../framescaper/editor-project-v31-foundation.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperV27VisualInspectorPreset {
	readonly id: string;
	readonly name: string;
	readonly generator: VideoGeneratorDocumentV1;
}

export interface FramescaperV27VisualInspectorModel {
	readonly clipId: string | null;
	readonly sourceId: string | null;
	readonly kind: 'still' | 'title' | 'text' | 'shape' | 'solid' | null;
	readonly generator: VideoGeneratorDocumentV1 | null;
	readonly opacity: number;
	readonly blendMode: VideoVisualPresentationV1['blendMode'];
	readonly maskId: string | null;
	readonly maskWidth: number;
	readonly masks: readonly Readonly<{ readonly id: string; readonly name: string }>[];
	readonly presets: readonly FramescaperV27VisualInspectorPreset[];
}

export interface FramescaperV27VisualInspectorDraft {
	readonly generator: VideoGeneratorDocumentV1 | null;
	readonly opacity: number;
	readonly blendMode: VideoVisualPresentationV1['blendMode'];
	readonly maskId: string | null;
	readonly maskWidth: number;
	readonly presetId: string | null;
}

export function createFramescaperV27VisualInspectorModel(input: Readonly<{
	readonly project: unknown;
	readonly selectedClipId?: unknown;
}>): FramescaperV27VisualInspectorModel {
	const project = projectRecord(input?.project);
	const selectedClipId = selectedId(input.selectedClipId, project);
	const clipValue = records(project.clips, 'project clips').find(({ id }) => id === selectedClipId);
	if (!clipValue || (clipValue.kind !== 'still' && clipValue.kind !== 'generator')) return emptyModel(project);
	const sourceValue = records(project.sources, 'project sources').find(({ id }) => id === clipValue.sourceId);
	if (!sourceValue || sourceValue.kind !== clipValue.kind) {
		throw new ReferenceError(`Selected visual clip ${String(clipValue.id)} has no matching source.`);
	}
	const clip = clipValue.kind === 'still'
		? normalizeVideoStillClipV1(clipValue) : normalizeVideoGeneratorClipV1(clipValue);
	const source = sourceValue.kind === 'still'
		? normalizeVideoStillSourceV1(sourceValue) : normalizeVideoGeneratorSourceV1(sourceValue);
	const presentations = records(project.videoVisualPresentations, 'visual presentations').filter((value) => {
		const owner = data(value.owner, 'visual presentation owner');
		return value.enabled === true && owner.kind === 'clip' && owner.id === clip.id;
	}).map(normalizeVideoVisualPresentationV1);
	if (presentations.length > 1) throw new RangeError('The selected visual has ambiguous clip presentations.');
	const presentation = presentations[0] ?? null;
	const masks = supportedMasks(project);
	const maskId = presentation?.maskMatteIds[0] ?? null;
	return Object.freeze({
		clipId: clip.id,
		sourceId: source.id,
		kind: source.kind === 'still' ? 'still' : generatorKind(source.generator),
		generator: source.kind === 'generator' ? source.generator : null,
		opacity: presentation?.opacity ?? 1,
		blendMode: presentation?.blendMode ?? 'normal',
		maskId,
		maskWidth: maskId === null ? 1 : maskWidth(project, maskId),
		masks: Object.freeze(masks.map(({ id }) => Object.freeze({ id, name: id }))),
		presets: boundGeneratorPresets(project),
	});
}

export function createFramescaperV27VisualInspectorCommand(
	projectValue: unknown,
	clipIdValue: unknown,
	draft: FramescaperV27VisualInspectorDraft,
): unknown {
	const project = projectRecord(projectValue);
	const clipId = stableId(clipIdValue, 'selected visual clip ID');
	const clip = records(project.clips, 'project clips').find(({ id }) => id === clipId);
	if (!clip || (clip.kind !== 'still' && clip.kind !== 'generator')) {
		throw new ReferenceError('The selected visual clip is unavailable.');
	}
	const source = records(project.sources, 'project sources').find(({ id }) => id === clip.sourceId);
	if (!source || source.kind !== clip.kind) throw new ReferenceError('The selected visual source is unavailable.');
	const commands: unknown[] = [];
	if (source.kind === 'generator') {
		const current = normalizeVideoGeneratorSourceV1(source);
		const generator = draftGenerator(project, draft, current.generator);
		const replacement = normalizeVideoGeneratorSourceV1({ ...current, generator });
		if (!same(current, replacement)) commands.push({
			type: 'video-visual-source/set', sourceId: current.id,
			expectedSource: current, source: replacement,
		});
	} else if (draft.generator !== null || draft.presetId !== null) {
		throw new RangeError('Still images cannot apply generator state.');
	}
	const maskId = draft.maskId === null ? null : stableId(draft.maskId, 'selected mask ID');
	if (maskId !== null) {
		const current = supportedMasks(project).find(({ id }) => id === maskId);
		if (!current) throw new ReferenceError(`Visual mask ${maskId} is unavailable or not editable.`);
		const replacement = resizeMask(current, finite(draft.maskWidth, 0.01, 1, 'mask width'));
		if (!same(current, replacement)) commands.push({
			type: 'video-mask-matte/set', maskMatteId: maskId,
			expectedMaskMatte: current, maskMatte: replacement,
		});
	}
	const existing = existingClipPresentation(project, clipId);
	const presentation = normalizeVideoVisualPresentationV1({
		...(existing ?? {
			schemaVersion: 1, id: createStableId('visual-presentation'),
			owner: { kind: 'clip', id: clipId }, enabled: true,
			grade: null, processorStackId: null,
		}),
		opacity: finite(draft.opacity, 0, 1, 'visual opacity'),
		blendMode: blendMode(draft.blendMode),
		maskMatteIds: maskId === null ? [] : [maskId],
	});
	if (!same(existing, presentation)) commands.push({
		type: 'video-visual-presentation/set', presentationId: presentation.id,
		expectedPresentation: existing, presentation,
	});
	if (commands.length === 0) throw new RangeError('The selected visual has no inspector changes.');
	return commands.length === 1 ? commands[0] : Object.freeze({
		type: 'batch', commands: Object.freeze(commands),
	});
}

function emptyModel(project: Data): FramescaperV27VisualInspectorModel {
	return Object.freeze({
		clipId: null, sourceId: null, kind: null, generator: null,
		opacity: 1, blendMode: 'normal', maskId: null, maskWidth: 1,
		masks: Object.freeze(supportedMasks(project).map(({ id }) => Object.freeze({ id, name: id }))),
		presets: boundGeneratorPresets(project),
	});
}

function projectRecord(value: unknown): Data {
	let input = record(value, 'V27, V28, V30, or F31 visual inspector project');
	if (input.schemaVersion === 31) {
		input = record(framescaperProjectV28FoundationShapeV31(input), 'F31 visual inspector foundation');
	}
	if (input.schemaVersion !== 27 && input.schemaVersion !== 28 && input.schemaVersion !== 30) {
		throw new RangeError('The visual inspector requires Framescaper V27, V28, V30, or F31.');
	}
	return input.schemaVersion === 30
		? record(framescaperProjectV27FoundationShapeV30(input), 'V30 visual inspector foundation')
		: input.schemaVersion === 28
		? record(framescaperProjectV27FoundationShapeV28(input), 'V28 visual inspector foundation')
		: input;
}

function boundGeneratorPresets(project: Data): readonly FramescaperV27VisualInspectorPreset[] {
	const sources = records(project.sources, 'project sources').filter(({ kind }) => kind === 'generator')
		.map(normalizeVideoGeneratorSourceV1);
	return Object.freeze(records(project.videoVisualPresets, 'visual presets').flatMap((value) => {
		const preset = normalizeVideoVisualPresetV1(value);
		if (preset.modelKind !== 'generator') return [];
		const source = sources.find((candidate) => (
			fingerprintNativeMediaPlan(candidate).sha256 === preset.authoredStateSha256
		));
		return source ? [Object.freeze({ id: preset.id, name: preset.name, generator: source.generator })] : [];
	}));
}

function draftGenerator(
	project: Data,
	draft: FramescaperV27VisualInspectorDraft,
	current: VideoGeneratorDocumentV1,
): VideoGeneratorDocumentV1 {
	if (draft.presetId !== null) {
		const preset = boundGeneratorPresets(project).find(({ id }) => id === draft.presetId);
		if (!preset) throw new ReferenceError(`Visual preset ${draft.presetId} has no fresh owning generator.`);
		if (draft.generator === null) return preset.generator;
	}
	return draft.generator ?? current;
}

function supportedMasks(project: Data) {
	return records(project.videoMaskMattes, 'visual masks').map(normalizeVideoMaskMatteGraphV1)
		.filter((graph) => graph.nodes.some((node) => node.id === graph.outputNodeId
			&& node.kind === 'vector-shape'));
}

function resizeMask(graph: ReturnType<typeof normalizeVideoMaskMatteGraphV1>, width: number) {
	return normalizeVideoMaskMatteGraphV1({
		...graph,
		nodes: graph.nodes.map((node) => node.id === graph.outputNodeId && node.kind === 'vector-shape'
			? { ...node, x: 0, width } : node),
	});
}

function maskWidth(project: Data, maskId: string): number {
	const graph = supportedMasks(project).find(({ id }) => id === maskId);
	const output = graph?.nodes.find(({ id }) => id === graph.outputNodeId);
	return output?.kind === 'vector-shape' ? output.width : 1;
}

function existingClipPresentation(project: Data, clipId: string): VideoVisualPresentationV1 | null {
	const values = records(project.videoVisualPresentations, 'visual presentations').map(normalizeVideoVisualPresentationV1)
		.filter(({ owner }) => owner.kind === 'clip' && owner.id === clipId);
	if (values.length > 1) throw new RangeError('The selected visual has ambiguous clip presentations.');
	return values[0] ?? null;
}

function selectedId(value: unknown, project: Data): string | null {
	if (typeof value === 'string' && value) return value;
	const selection = data(project.selection, 'project selection');
	return Array.isArray(selection.clipIds) && selection.clipIds.length === 1
		&& typeof selection.clipIds[0] === 'string' ? selection.clipIds[0] : null;
}

function generatorKind(value: VideoGeneratorDocumentV1) {
	if (value.kind === 'external-generator') throw new RangeError('Dormant external generators have no selected inspector.');
	return value.kind;
}

function blendMode(value: unknown): VideoVisualPresentationV1['blendMode'] {
	if (!['normal', 'multiply', 'screen', 'overlay', 'add'].includes(String(value))) {
		throw new RangeError('The visual blend mode is unsupported.');
	}
	return value as VideoVisualPresentationV1['blendMode'];
}

function finite(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite range.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function data(value: unknown, _name: string): Data {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : Object.freeze({});
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
