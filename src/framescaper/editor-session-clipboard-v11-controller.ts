/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import {
	sampleFrameToVideoFrame,
	type RationalRate,
} from '../common/editor/timeline-time.ts';
import type { FramescaperProjectCommandFinishing } from './editor-project-finishing-commands.ts';
import { applyFramescaperProjectCommandFinishing } from './editor-project-finishing-commands.ts';
import {
	normalizeFramescaperSessionClipboardV11,
	prepareFramescaperFinishingClipboardPasteV11,
	type FramescaperFinishingClipboardPasteV11,
} from './editor-session-clipboard-v11.ts';
import { validateFramescaperProjectFinishing, type FramescaperProjectFinishing } from './editor-project-finishing.ts';

type DataRecord = Record<string, unknown>;
type IdFactory = (prefix?: string) => string;

/** Append selected V11 visual/finishing state to the foundation paste as one command transaction. */
export function prepareFramescaperSessionClipboardPasteCommandV11(
	profile: unknown,
	projectValue: unknown,
	clipboardValue: unknown,
	baseCommand: AudioEditorCommand,
	createId: IdFactory,
): FramescaperProjectCommandFinishing {
	validateFramescaperProjectFinishing(profile, projectValue);
	if (typeof createId !== 'function') throw new TypeError('V11 paste requires an ID factory.');
	const project = projectValue as FramescaperProjectFinishing;
	const clipboard = normalizeFramescaperSessionClipboardV11(clipboardValue);
	const paste = findPasteCommand(baseCommand);
	if (JSON.stringify(paste.clipboard) !== JSON.stringify(clipboard.descriptor)) {
		throw new RangeError('The V11 carrier and foundation paste descriptors must match exactly.');
	}
	const foundationCommand = sanitizeFoundationCommand(baseCommand, clipboard);
	const afterBase = applyFramescaperProjectCommandFinishing(profile, project, foundationCommand);
	const allocations = allocationMaps(project, clipboard.finishing, createId);
	const references = projectReferenceMaps(afterBase, clipboard, paste, allocations);
	const pasted = prepareFramescaperFinishingClipboardPasteV11(clipboard.finishing, {
		visual: {
			sourceIdMap: allocations.visualSources,
			clipIdMap: allocations.visualClips,
			adjustmentLayerIdMap: allocations.visualAdjustments,
			presetIdMap: allocations.visualPresets,
			maskMatteIdMap: allocations.visualMasks,
			projectReferenceIdMap: references.visual,
		},
		presentationIdMap: allocations.presentations,
		processorStackIdMap: allocations.stacks,
		processorIdMap: allocations.processors,
		motionAnalysisIdMap: allocations.analyses,
		finishingPresetIdMap: allocations.presets,
		captionTrackIdMap: allocations.captions,
		projectReferenceIdMap: references.finishing,
	});
	const visualCommands = createVisualCommands(afterBase, pasted, clipboard, paste);
	const afterVisual = visualCommands.length === 0 ? afterBase : applyFramescaperProjectCommandFinishing(
		profile,
		afterBase,
		{ type: 'batch', commands: visualCommands },
	);
	const finishingCommands = createFinishingCommands(afterVisual, pasted);
	const commands = [foundationCommand, ...visualCommands, ...finishingCommands];
	return commands.length === 1 ? commands[0]! : Object.freeze({
		type: 'batch' as const,
		commands: Object.freeze(commands),
	});
}

function sanitizeFoundationCommand(
	commandValue: AudioEditorCommand,
	clipboard: ReturnType<typeof normalizeFramescaperSessionClipboardV11>,
): FramescaperProjectCommandFinishing {
	const visualSourceIds = new Set(clipboard.finishing.visual.sources.map(({ id }) => id));
	const visualClipIds = new Set(clipboard.finishing.visual.clips.map(({ id }) => id));
	const visualKeys = new Set(clipboard.clipBindings.flatMap(({ clipId, descriptorKey }) => (
		visualClipIds.has(clipId) ? [descriptorKey] : []
	)));
	const sanitize = (value: unknown): DataRecord | null => {
		const command = structuredClone(record(value, 'V11 foundation command'));
		if (command.type === 'source/add') {
			const source = record(command.source, 'V11 foundation source');
			return visualSourceIds.has(dataString(source.id, 'V11 foundation source ID')) ? null : command;
		}
		if (command.type === 'batch') {
			if (!Array.isArray(command.commands)) throw new TypeError('V11 foundation batch commands must be an array.');
			const commands = command.commands.flatMap((child) => {
				const sanitized = sanitize(child);
				return sanitized === null ? [] : [sanitized];
			});
			if (commands.length === 0) throw new RangeError('V11 foundation paste cannot become empty.');
			return { type: 'batch', commands };
		}
		if (command.type !== 'clipboard/paste') return command;
		const descriptor = structuredClone(record(command.clipboard, 'V11 foundation descriptor'));
		if (!Array.isArray(descriptor.tracks)) throw new TypeError('V11 foundation descriptor tracks must be an array.');
		descriptor.tracks = descriptor.tracks.map((trackValue) => {
			const track = structuredClone(record(trackValue, 'V11 foundation descriptor track'));
			if (!Array.isArray(track.clips)) throw new TypeError('V11 foundation descriptor clips must be an array.');
			track.clips = track.clips.filter((clip) => !visualKeys.has(dataString(
				record(clip, 'V11 foundation descriptor clip').key,
				'V11 foundation descriptor clip key',
			)));
			return track;
		});
		command.clipboard = descriptor;
		for (const field of ['clipIds', 'videoEffectIds'] as const) {
			const values = record(command[field], `V11 foundation ${field}`);
			command[field] = Object.fromEntries(Object.entries(values).filter(([key]) => !visualKeys.has(key)));
		}
		return command;
	};
	return sanitize(commandValue) as unknown as FramescaperProjectCommandFinishing;
}

interface AllocationMaps {
	readonly visualSources: ReadonlyMap<string, string>;
	readonly visualClips: ReadonlyMap<string, string>;
	readonly visualAdjustments: ReadonlyMap<string, string>;
	readonly visualPresets: ReadonlyMap<string, string>;
	readonly visualMasks: ReadonlyMap<string, string>;
	readonly presentations: ReadonlyMap<string, string>;
	readonly stacks: ReadonlyMap<string, string>;
	readonly processors: ReadonlyMap<string, string>;
	readonly analyses: ReadonlyMap<string, string>;
	readonly presets: ReadonlyMap<string, string>;
	readonly captions: ReadonlyMap<string, string>;
}

function allocationMaps(
	project: FramescaperProjectFinishing,
	finishing: ReturnType<typeof normalizeFramescaperSessionClipboardV11>['finishing'],
	createId: IdFactory,
): AllocationMaps {
	const occupied = collectStrings(project);
	const allocate = (values: readonly Readonly<{ id: string }>[], prefix: string) => new Map(
		values.map(({ id }) => [id, freshId(createId, prefix, occupied)]),
	);
	return Object.freeze({
		visualSources: allocate(finishing.visual.sources, 'visual-source'),
		visualClips: allocate(finishing.visual.clips, 'visual-clip'),
		visualAdjustments: allocate(finishing.visual.adjustmentLayers, 'adjustment-layer'),
		visualPresets: allocate(finishing.visual.presets, 'visual-preset'),
		visualMasks: allocate(finishing.visual.maskMattes, 'mask-matte'),
		presentations: allocate(finishing.visualPresentations, 'visual-presentation'),
		stacks: allocate(finishing.processorStacks, 'processor-stack'),
		processors: allocate(finishing.processorStacks.flatMap(({ processors }) => processors), 'video-processor'),
		analyses: allocate(finishing.motionAnalyses, 'motion-analysis'),
		presets: allocate(finishing.finishingPresets, 'finishing-preset'),
		captions: allocate(finishing.captionTracks, 'caption-track'),
	});
}

function projectReferenceMaps(
	project: FramescaperProjectFinishing,
	clipboard: ReturnType<typeof normalizeFramescaperSessionClipboardV11>,
	paste: DataRecord,
	allocations: AllocationMaps,
): Readonly<{ visual: ReadonlyMap<string, string>; finishing: ReadonlyMap<string, string> }> {
	const clipTargets = new Map(clipboard.clipBindings.map(({ clipId, descriptorKey }) => [
		clipId,
		dataString(record(paste.clipIds, 'V11 paste clip IDs')[descriptorKey], `pasted clip ${descriptorKey}`),
	]));
	const trackMap = record(paste.trackMap, 'V11 paste track map');
	const sequenceTargets = new Map<string, string>();
	for (const track of clipboard.descriptor.tracks) {
		if (track.sourceSequenceId === undefined) continue;
		const targetTrackId = dataString(trackMap[track.sourceTrackId] ?? track.sourceTrackId, 'pasted track ID');
		const targetSequenceId = sequenceForTrack(project, targetTrackId);
		const prior = sequenceTargets.get(track.sourceSequenceId);
		if (prior !== undefined && prior !== targetSequenceId) {
			throw new RangeError('One V11 source sequence cannot paste into multiple destination sequences.');
		}
		sequenceTargets.set(track.sourceSequenceId, targetSequenceId);
	}
	const effectTargets = pastedEffectTargets(clipboard, paste);
	const resolve = (required: ReadonlySet<string>): ReadonlyMap<string, string> => new Map([...required].map((reference) => {
		const target = clipTargets.get(reference)
			?? sequenceTargets.get(reference)
			?? dataStringOrNull(trackMap[reference])
			?? effectTargets.get(reference)
			?? (records(project.sources, 'V11 destination sources').some(({ id }) => id === reference)
				? reference : null);
		if (target === null) throw new ReferenceError(`V11 paste cannot resolve project reference ${reference}.`);
		return [reference, target];
	}));
	return Object.freeze({
		visual: resolve(requiredVisualProjectReferences(clipboard.finishing, allocations)),
		finishing: resolve(requiredFinishingProjectReferences(clipboard.finishing, allocations)),
	});
}

function requiredVisualProjectReferences(
	finishing: ReturnType<typeof normalizeFramescaperSessionClipboardV11>['finishing'],
	allocations: AllocationMaps,
): ReadonlySet<string> {
	const result = new Set<string>();
	const addUnless = (id: string, allocated: ReadonlyMap<string, string>) => {
		if (!allocated.has(id)) result.add(id);
	};
	for (const source of finishing.visual.sources) {
		if (source.kind === 'generator' && source.generator.kind === 'external-generator') {
			for (const input of source.generator.inputs) addUnless(input.sourceRef, allocations.visualSources);
		}
	}
	for (const clip of finishing.visual.clips) {
		addUnless(clip.sourceId, allocations.visualSources);
		result.add(clip.sequenceId);
	}
	for (const adjustment of finishing.visual.adjustmentLayers) {
		result.add(adjustment.sequenceId);
		for (const id of adjustment.targetTrackIds) result.add(id);
		for (const id of adjustment.effectIds) result.add(id);
	}
	for (const mask of finishing.visual.maskMattes) {
		for (const input of mask.inputs) addUnless(input.sourceRef, allocations.visualSources);
	}
	for (const fallback of finishing.visual.freezeFallbacks) {
		addUnless(fallback.renderedSourceId, allocations.visualSources);
	}
	return result;
}

function requiredFinishingProjectReferences(
	finishing: ReturnType<typeof normalizeFramescaperSessionClipboardV11>['finishing'],
	allocations: AllocationMaps,
): ReadonlySet<string> {
	const result = new Set<string>();
	const addUnless = (id: string, allocated: ReadonlyMap<string, string>) => {
		if (!allocated.has(id)) result.add(id);
	};
	for (const context of finishing.colorContexts) result.add(context.sequenceId);
	for (const interpretation of finishing.sourceColorInterpretations) {
		addUnless(interpretation.sourceId, allocations.visualSources);
	}
	for (const stack of finishing.processorStacks) addUnless(stack.sourceId, allocations.visualSources);
	for (const analysis of finishing.motionAnalyses) addUnless(analysis.sourceId, allocations.visualSources);
	for (const presentation of finishing.visualPresentations) {
		const ownerMap = presentation.owner.kind === 'clip' ? allocations.visualClips
			: presentation.owner.kind === 'source' || presentation.owner.kind === 'generator'
				? allocations.visualSources
				: presentation.owner.kind === 'adjustment-layer' ? allocations.visualAdjustments
					: allocations.visualMasks;
		addUnless(presentation.owner.id, ownerMap);
	}
	for (const track of finishing.captionTracks) result.add(track.sequenceId);
	return result;
}

function createVisualCommands(
	project: FramescaperProjectFinishing,
	pasted: FramescaperFinishingClipboardPasteV11,
	clipboard: ReturnType<typeof normalizeFramescaperSessionClipboardV11>,
	paste: DataRecord,
): FramescaperProjectCommandFinishing[] {
	const commands: FramescaperProjectCommandFinishing[] = [];
	for (const source of pasted.visual.sources) commands.push({
		type: 'video-visual-source/set', sourceId: source.id, expectedSource: null, source,
	});
	for (const mask of pasted.visual.maskMattes) commands.push({
		type: 'video-mask-matte/set', maskMatteId: mask.id, expectedMaskMatte: null, maskMatte: mask,
	});
	const originalById = new Map(clipboard.finishing.visual.clips.map((clip) => [clip.id, clip]));
	const bindingByClipId = new Map(clipboard.clipBindings.map((binding) => [binding.clipId, binding]));
	const clipIdMap = new Map(clipboard.finishing.visual.clips.map((clip, index) => [clip.id, pasted.visual.clips[index]!.id]));
	const trackMap = record(paste.trackMap, 'V11 paste track map');
	for (const clip of pasted.visual.clips) {
		const sourceId = [...clipIdMap].find(([, target]) => target === clip.id)?.[0];
		const original = sourceId === undefined ? undefined : originalById.get(sourceId);
		const binding = sourceId === undefined ? undefined : bindingByClipId.get(sourceId);
		if (!original || !binding) throw new ReferenceError(`V11 visual clip ${clip.id} has no placement binding.`);
		const sourceTrack = clipboard.descriptor.tracks.find((track) => (
			track.clips.some((candidate) => candidate.key === binding.descriptorKey)
		));
		if (!sourceTrack) throw new ReferenceError(`V11 visual clip ${clip.id} has no source track.`);
		const targetTrackId = dataString(trackMap[sourceTrack.sourceTrackId] ?? sourceTrack.sourceTrackId, 'visual target track');
		const descriptorClip = sourceTrack.clips.find(({ key }) => key === binding.descriptorKey);
		if (!descriptorClip) throw new ReferenceError(`V11 visual clip ${clip.id} has no descriptor geometry.`);
		const placedClip = placeVisualClip(project, clip, descriptorClip, clipboard.descriptor, paste, targetTrackId);
		commands.push({ type: 'video-visual-clip/set', clipId: placedClip.id,
			expectedClip: null, expectedPlacement: null, clip: placedClip,
			placement: { scope: 'timeline', trackId: targetTrackId } });
	}
	for (const adjustmentLayer of pasted.visual.adjustmentLayers) commands.push({
		type: 'video-adjustment-layer/set', adjustmentLayerId: adjustmentLayer.id,
		expectedAdjustmentLayer: null, adjustmentLayer,
	});
	for (const preset of pasted.visual.presets) commands.push({
		type: 'video-visual-preset/set', presetId: preset.id, expectedPreset: null, preset,
	});
	for (const fallback of pasted.visual.freezeFallbacks) commands.push({
		type: 'video-freeze-fallback/set', renderedSourceId: fallback.renderedSourceId,
		expectedFreezeFallback: null, freezeFallback: fallback,
	});
	return commands;
}

function placeVisualClip(
	project: FramescaperProjectFinishing,
	clip: FramescaperFinishingClipboardPasteV11['visual']['clips'][number],
	descriptorClip: Readonly<Record<string, unknown>>,
	descriptor: ReturnType<typeof normalizeFramescaperSessionClipboardV11>['descriptor'],
	paste: DataRecord,
	targetTrackId: string,
): FramescaperFinishingClipboardPasteV11['visual']['clips'][number] {
	const sequence = sequenceRecordForTrack(project, targetTrackId);
	const sampleRate = positiveInteger(project.sampleRate, 'V11 destination sample rate');
	const clipboardSampleRate = positiveInteger(descriptor.sampleRate, 'V11 clipboard sample rate');
	const scale = sampleRate / clipboardSampleRate;
	const anchor = sampleFrameToVideoFrame(
		nonNegativeInteger(paste.atFrame, 'V11 paste frame'),
		sequence.rate,
		sampleRate,
		'point',
	);
	const offsetStart = Math.round(nonNegativeInteger(
		descriptorClip.offsetFrame,
		'V11 visual offset',
	) * scale);
	const offsetEnd = Math.round((
		nonNegativeInteger(descriptorClip.offsetFrame, 'V11 visual offset')
		+ positiveInteger(descriptorClip.durationFrames, 'V11 visual duration')
	) * scale);
	const relativeStart = sampleFrameToVideoFrame(offsetStart, sequence.rate, sampleRate, 'point');
	const relativeEnd = sampleFrameToVideoFrame(offsetEnd, sequence.rate, sampleRate, 'point');
	const placement = {
		sequenceId: sequence.id,
		sequenceStartFrame: anchor + relativeStart,
		sequenceFrameCount: Math.max(1, relativeEnd - relativeStart),
	};
	if (clip.kind === 'still') return Object.freeze({ ...clip, ...placement });
	return Object.freeze({
		...clip,
		...placement,
		sourceInFrame: nonNegativeInteger(descriptorClip.sourceInFrame, 'V11 generator source in'),
		sourceFrameCount: positiveInteger(descriptorClip.sourceFrameCount, 'V11 generator source count'),
	});
}

function createFinishingCommands(
	project: FramescaperProjectFinishing,
	pasted: FramescaperFinishingClipboardPasteV11,
): FramescaperProjectCommandFinishing[] {
	const commands: FramescaperProjectCommandFinishing[] = [];
	for (const context of pasted.colorContexts) {
		const expected = project.videoColorContexts.find(({ sequenceId }) => sequenceId === context.sequenceId);
		if (!expected) throw new ReferenceError(`V11 destination color context ${context.sequenceId} is missing.`);
		if (!same(expected, context)) commands.push({ type: 'video-color-context/set', sequenceId: context.sequenceId,
			expectedContext: expected, context });
	}
	for (const interpretation of pasted.sourceColorInterpretations) {
		const expected = project.videoSourceColorInterpretations.find(({ sourceId }) => sourceId === interpretation.sourceId);
		if (!expected) throw new ReferenceError(`V11 destination interpretation ${interpretation.sourceId} is missing.`);
		if (!same(expected, interpretation)) commands.push({ type: 'video-source-color-interpretation/set',
			sourceId: interpretation.sourceId, expectedInterpretation: expected, interpretation });
	}
	for (const stack of pasted.processorStacks) commands.push({ type: 'video-processor-stack/set',
		processorStackId: stack.id, expectedProcessorStack: null, processorStack: stack });
	for (const analysis of pasted.motionAnalyses) commands.push({ type: 'video-motion-analysis/set',
		motionAnalysisId: analysis.id, expectedMotionAnalysis: null, motionAnalysis: analysis });
	for (const presentation of pasted.visualPresentations) commands.push({ type: 'video-visual-presentation/set',
		presentationId: presentation.id, expectedPresentation: null, presentation });
	for (const preset of pasted.finishingPresets) commands.push({ type: 'video-finishing-preset/set',
		finishingPresetId: preset.id, expectedFinishingPreset: null, finishingPreset: preset });
	for (const track of pasted.captionTracks) commands.push({ type: 'video-caption-track/set',
		captionTrackId: track.id, expectedCaptionTrack: null, captionTrack: track });
	return commands;
}

function pastedEffectTargets(
	clipboard: ReturnType<typeof normalizeFramescaperSessionClipboardV11>,
	paste: DataRecord,
): ReadonlyMap<string, string> {
	const targets = new Map<string, string>();
	const idsByKey = record(paste.videoEffectIds, 'V11 pasted effect IDs');
	for (const track of clipboard.descriptor.tracks) for (const clip of track.clips) {
		if (!Array.isArray(clip.videoEffects) || clip.videoEffects.length === 0) continue;
		const clipKey = dataString(clip.key, 'V11 clipboard clip key');
		const values = idsByKey[clipKey];
		if (!Array.isArray(values) || values.length !== clip.videoEffects.length) {
			throw new ReferenceError(`V11 pasted effects for ${String(clip.key)} are incomplete.`);
		}
		for (const [index, effect] of clip.videoEffects.entries()) {
			const oldId = dataString(record(effect, 'V11 clipboard effect').id, 'clipboard effect ID');
			targets.set(oldId, dataString(values[index], 'pasted effect ID'));
		}
	}
	return targets;
}

function findPasteCommand(command: unknown): DataRecord {
	const matches: DataRecord[] = [];
	const visit = (value: unknown): void => {
		const candidate = record(value, 'V11 foundation paste command');
		if (candidate.type === 'clipboard/paste') matches.push(candidate);
		else if (candidate.type === 'batch') {
			if (!Array.isArray(candidate.commands)) throw new TypeError('V11 foundation batch commands must be an array.');
			for (const child of candidate.commands) visit(child);
		}
	};
	visit(command);
	if (matches.length !== 1) throw new RangeError('V11 paste requires exactly one foundation clipboard/paste command.');
	return matches[0]!;
}

function sequenceForTrack(project: FramescaperProjectFinishing, trackId: string): string {
	return sequenceRecordForTrack(project, trackId).id;
}

function sequenceRecordForTrack(
	project: FramescaperProjectFinishing,
	trackId: string,
): Readonly<{ id: string; rate: RationalRate }> {
	for (const sequenceValue of records(project.sequences, 'V11 destination sequences')) {
		const sequence = sequenceValue as unknown as DataRecord;
		if ((Array.isArray(sequence.trackIds) && sequence.trackIds.includes(trackId))
			|| (Array.isArray(sequence.trackNodes) && sequence.trackNodes.some((node) => (
				record(node, 'V11 sequence track node').id === trackId
			)))) {
			const rate = record(sequence.rate, 'V11 destination sequence rate');
			return Object.freeze({
				id: dataString(sequence.id, 'destination sequence ID'),
				rate: Object.freeze({
					num: positiveInteger(rate.num, 'V11 sequence rate numerator'),
					den: positiveInteger(rate.den, 'V11 sequence rate denominator'),
				}),
			});
		}
	}
	throw new ReferenceError(`V11 destination track ${trackId} has no sequence.`);
}

function freshId(createId: IdFactory, prefix: string, occupied: Set<string>): string {
	const value = dataString(createId(prefix), `fresh ${prefix} ID`);
	if (occupied.has(value)) throw new RangeError(`V11 fresh ${prefix} ID collides with existing state.`);
	occupied.add(value);
	return value;
}

function collectStrings(value: unknown): Set<string> {
	const result = new Set<string>();
	const pending = [value];
	const visited = new Set<object>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (typeof current === 'string') result.add(current);
		else if (current && typeof current === 'object' && !visited.has(current)) {
			visited.add(current);
			pending.push(...(Array.isArray(current) ? current : Object.values(current as DataRecord)));
		}
	}
	return result;
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function dataStringOrNull(value: unknown): string | null {
	return value === undefined ? null : dataString(value, 'V11 mapped identity');
}

function dataString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable identity.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function records(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
