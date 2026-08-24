/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	exportVideoCaptionTrackV1,
	importVideoCaptionTrackV1,
	type VideoCaptionExportResultV1,
	type VideoCaptionImportResultV1,
} from '../video-caption-track-v27.ts';
import type { VideoCaptionInterchangeFormatV1 } from '../video-caption-interchange-contract-v27.ts';
import {
	snapshotFramescaperOwnedFinishingCommandV27,
	type FramescaperOwnedFinishingCommandV27,
} from '../../../framescaper/editor-project-v27-finishing-command.ts';
import { framescaperProjectV27FoundationShapeV28 } from '../../../framescaper/editor-project-v28-foundation.ts';
import type { FramescaperV27FinishingSurface } from './framescaper-v27-finishing-menu.ts';

export interface FramescaperV27FinishingDialogModel {
	readonly surface: FramescaperV27FinishingSurface;
	readonly title: string;
	readonly description: string;
	readonly documentText: string;
	readonly documentEditable: boolean;
}

export type FramescaperV27FinishingDialogCommand = FramescaperOwnedFinishingCommandV27
	| Readonly<{
		readonly type: 'batch';
		readonly commands: readonly FramescaperOwnedFinishingCommandV27[];
	}>;

interface CollectionSpec {
	readonly field: string;
	readonly identity: string;
	readonly type: FramescaperOwnedFinishingCommandV27['type'];
	readonly idField: string;
	readonly expectedField: string;
	readonly valueField: string;
}

const MAXIMUM_DOCUMENT_CHARACTERS = 4 * 1024 * 1024;
const MAXIMUM_COLLECTION_ITEMS = 100_000;

const COLLECTIONS = Object.freeze({
	videoColorContexts: collection('videoColorContexts', 'sequenceId', 'video-color-context/set',
		'sequenceId', 'expectedContext', 'context'),
	videoSourceColorInterpretations: collection('videoSourceColorInterpretations', 'sourceId',
		'video-source-color-interpretation/set', 'sourceId', 'expectedInterpretation', 'interpretation'),
	videoVisualPresentations: collection('videoVisualPresentations', 'id',
		'video-visual-presentation/set', 'presentationId', 'expectedPresentation', 'presentation'),
	videoProcessorStacks: collection('videoProcessorStacks', 'id',
		'video-processor-stack/set', 'processorStackId', 'expectedProcessorStack', 'processorStack'),
	videoMotionAnalyses: collection('videoMotionAnalyses', 'id',
		'video-motion-analysis/set', 'motionAnalysisId', 'expectedMotionAnalysis', 'motionAnalysis'),
	videoFinishingPresets: collection('videoFinishingPresets', 'id',
		'video-finishing-preset/set', 'finishingPresetId', 'expectedFinishingPreset', 'finishingPreset'),
	videoCaptionTracks: collection('videoCaptionTracks', 'id',
		'video-caption-track/set', 'captionTrackId', 'expectedCaptionTrack', 'captionTrack'),
	automationLanes: collection('automationLanes', 'id',
		'automation-lane/set', 'laneId', 'expected', 'lane'),
} as const);

const SURFACE_COPY = Object.freeze({
	'visual-inspector': Object.freeze({
		title: 'Selected Visual Inspector',
		description: 'Edit the selected still or built-in generator through exact V27 presentation state.',
	}),
	'color-management': Object.freeze({
		title: 'Managed Color & Source Interpretation',
		description: 'Inspect disclosed source assumptions, override them explicitly, and select deterministic sRGB or Rec.709 output.',
	}),
	'grading-presets': Object.freeze({
		title: 'Grading & Finishing Presets',
		description: 'Author managed-SDR grades, presentations, and reusable visual finishing presets.',
	}),
	'motion-tracking': Object.freeze({
		title: 'Motion Tracking',
		description: 'Configure deterministic built-in tracking and its digest-bound analysis references.',
	}),
	stabilization: Object.freeze({
		title: 'Similarity Stabilization',
		description: 'Configure similarity stabilization with optical flow used only as its motion provider.',
	}),
	denoise: Object.freeze({
		title: 'Spatial & Temporal Denoise',
		description: 'Configure deterministic spatial and temporal denoise with CPU/WebGL2 parity.',
	}),
	captions: Object.freeze({
		title: 'Caption Tracks',
		description: 'Author explicit caption tracks or import/export strict SRT, WebVTT, and IMSC 1.1 sidecars.',
	}),
	automation: Object.freeze({
		title: 'Automation Lanes',
		description: 'Edit shared V21 automation-lane documents for Framescaper audio strips.',
	}),
	mixer: Object.freeze({
		title: 'Mixer & Routing',
		description: 'Edit the shared V21 mixer graph used by Framescaper audio finishing.',
	}),
	'dialogue-chain': Object.freeze({
		title: 'Dialogue Chain',
		description: 'Apply the deterministic Framescaper dialogue chain to the selected audio track.',
	}),
});

export function createFramescaperV27FinishingDialogModel(input: Readonly<{
	readonly surface: FramescaperV27FinishingSurface;
	readonly project: unknown;
}>): FramescaperV27FinishingDialogModel {
	const project = projectRecord(input.project);
	const copy = SURFACE_COPY[input.surface];
	const document = finishingDocument(input.surface, project);
	return Object.freeze({
		surface: input.surface,
		title: copy.title,
		description: copy.description,
		documentText: document === null ? '' : JSON.stringify(document, null, '\t'),
		documentEditable: document !== null,
	});
}

export function createFramescaperV27FinishingCommand(
	surface: FramescaperV27FinishingSurface,
	projectValue: unknown,
	documentText: string,
): FramescaperV27FinishingDialogCommand {
	const project = projectRecord(projectValue);
	if (surface === 'dialogue-chain' || surface === 'visual-inspector') {
		throw new RangeError('The dialogue chain uses its dedicated deterministic action.');
	}
	const parsed = parseDocument(documentText);
	const commands = surfaceCommands(surface, project, parsed);
	if (commands.length === 0) throw new RangeError('The finishing document contains no changes.');
	if (commands.length === 1) return commands[0]!;
	return Object.freeze({ type: 'batch', commands: Object.freeze(commands) });
}

export function importFramescaperV27CaptionSidecar(input: Readonly<{
	readonly project: unknown;
	readonly format: VideoCaptionInterchangeFormatV1;
	readonly text: string;
	readonly trackId: string;
	readonly sequenceId: string;
	readonly trackName: string;
	readonly language: string;
}>): Readonly<{
	readonly result: VideoCaptionImportResultV1;
	readonly command: FramescaperOwnedFinishingCommandV27;
}> {
	const project = projectRecord(input.project);
	const result = importVideoCaptionTrackV1(input.text, {
		format: input.format,
		sampleRate: positiveInteger(project.sampleRate, 'project sample rate'),
		trackId: input.trackId,
		sequenceId: input.sequenceId,
		trackName: input.trackName,
		language: input.language,
	});
	const tracks = records(project.videoCaptionTracks, 'videoCaptionTracks');
	const expected = tracks.find(({ id }) => id === result.track.id) ?? null;
	const command = snapshotFramescaperOwnedFinishingCommandV27({
		type: 'video-caption-track/set', captionTrackId: result.track.id,
		expectedCaptionTrack: expected, captionTrack: result.track,
	});
	return Object.freeze({ result, command });
}

export function exportFramescaperV27CaptionSidecar(input: Readonly<{
	readonly project: unknown;
	readonly trackId: string;
	readonly format: VideoCaptionInterchangeFormatV1;
}>): VideoCaptionExportResultV1 {
	const project = projectRecord(input.project);
	const track = records(project.videoCaptionTracks, 'videoCaptionTracks')
		.find(({ id }) => id === input.trackId);
	if (!track) throw new ReferenceError(`Caption track ${input.trackId} is unavailable.`);
	return exportVideoCaptionTrackV1(track, {
		format: input.format,
		sampleRate: positiveInteger(project.sampleRate, 'project sample rate'),
	});
}

function finishingDocument(
	surface: FramescaperV27FinishingSurface,
	project: Record<string, unknown>,
): unknown {
	if (surface === 'color-management') return {
		videoColorContexts: project.videoColorContexts,
		videoSourceColorInterpretations: project.videoSourceColorInterpretations,
	};
	if (surface === 'grading-presets') return {
		videoVisualPresentations: project.videoVisualPresentations,
		videoFinishingPresets: project.videoFinishingPresets,
	};
	if (surface === 'motion-tracking' || surface === 'stabilization' || surface === 'denoise') return {
		videoProcessorStacks: project.videoProcessorStacks,
		videoMotionAnalyses: project.videoMotionAnalyses,
	};
	if (surface === 'captions') return project.videoCaptionTracks;
	if (surface === 'automation') return project.automationLanes;
	if (surface === 'mixer') return project.mixer;
	return null;
}

function surfaceCommands(
	surface: Exclude<FramescaperV27FinishingSurface, 'dialogue-chain' | 'visual-inspector'>,
	project: Record<string, unknown>,
	draft: unknown,
): FramescaperOwnedFinishingCommandV27[] {
	if (surface === 'color-management') return documentCollections(project, draft, [
		COLLECTIONS.videoColorContexts, COLLECTIONS.videoSourceColorInterpretations,
	]);
	if (surface === 'grading-presets') return documentCollections(project, draft, [
		COLLECTIONS.videoVisualPresentations, COLLECTIONS.videoFinishingPresets,
	]);
	if (surface === 'motion-tracking' || surface === 'stabilization' || surface === 'denoise') {
		return documentCollections(project, draft, [
			COLLECTIONS.videoProcessorStacks, COLLECTIONS.videoMotionAnalyses,
		]);
	}
	if (surface === 'captions') return collectionCommands(project, draft, COLLECTIONS.videoCaptionTracks);
	if (surface === 'automation') return collectionCommands(project, draft, COLLECTIONS.automationLanes);
	return [snapshotFramescaperOwnedFinishingCommandV27({
		type: 'mixer-graph/set', expected: project.mixer, mixer: draft,
	})];
}

function documentCollections(
	project: Record<string, unknown>,
	draftValue: unknown,
	specs: readonly CollectionSpec[],
): FramescaperOwnedFinishingCommandV27[] {
	const draft = exactDocument(draftValue, specs.map(({ field }) => field));
	return specs.flatMap((entry) => collectionCommands(project, draft[entry.field], entry));
}

function collectionCommands(
	project: Record<string, unknown>,
	draftValue: unknown,
	entry: CollectionSpec,
): FramescaperOwnedFinishingCommandV27[] {
	const current = indexed(records(project[entry.field], entry.field), entry);
	const draft = indexed(records(draftValue, `${entry.field} draft`), entry);
	const ids = [...current.keys(), ...[...draft.keys()].filter((id) => !current.has(id))];
	return ids.flatMap((id) => {
		const expected = current.get(id) ?? null;
		const replacement = draft.get(id) ?? null;
		if (same(expected, replacement)) return [];
		return [snapshotFramescaperOwnedFinishingCommandV27({
			type: entry.type,
			[entry.idField]: id,
			[entry.expectedField]: expected,
			[entry.valueField]: replacement,
		})];
	});
}

function indexed(
	values: readonly Record<string, unknown>[],
	entry: CollectionSpec,
): Map<string, Record<string, unknown>> {
	if (values.length > MAXIMUM_COLLECTION_ITEMS) {
		throw new RangeError(`${entry.field} exceeds its finishing-dialog item limit.`);
	}
	const result = new Map<string, Record<string, unknown>>();
	for (const value of values) {
		const id = value[entry.identity];
		if (typeof id !== 'string' || !id) throw new TypeError(`${entry.field}.${entry.identity} is required.`);
		if (result.has(id)) throw new RangeError(`${entry.field} identity ${id} is duplicated.`);
		result.set(id, value);
	}
	return result;
}

function collection(
	field: string,
	identity: string,
	type: FramescaperOwnedFinishingCommandV27['type'],
	idField: string,
	expectedField: string,
	valueField: string,
): CollectionSpec {
	return Object.freeze({ field, identity, type, idField, expectedField, valueField });
}

function parseDocument(value: string): unknown {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_DOCUMENT_CHARACTERS) {
		throw new RangeError('The finishing document is empty or exceeds its size limit.');
	}
	try {
		return JSON.parse(value) as unknown;
	} catch (error) {
		throw new SyntaxError('The finishing document must be valid JSON.', { cause: error });
	}
}

function exactDocument(value: unknown, fields: readonly string[]): Record<string, unknown> {
	const result = record(value, 'finishing document');
	const keys = Reflect.ownKeys(result);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('The finishing document must contain only its owned collections.');
	}
	return result;
}

function projectRecord(value: unknown): Record<string, unknown> {
	const input = record(value, 'Framescaper V27 or V28 project');
	if (input.schemaVersion !== 27 && input.schemaVersion !== 28) {
		throw new RangeError('The selected Framescaper V27 or V28 project is required.');
	}
	return input.schemaVersion === 28
		? record(framescaperProjectV27FoundationShapeV28(input), 'Framescaper V28 finishing foundation')
		: input;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
