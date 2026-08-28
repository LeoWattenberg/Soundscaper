/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21, type AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import { readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { normalizeMixerGraphV21, type MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import { normalizeVideoCaptionTrackV1, type VideoCaptionTrackV1 } from '../common/editor/video-caption-track-v27.ts';
import {
	normalizeVideoColorContextV1,
	normalizeVideoSourceColorInterpretationV1,
	type VideoColorContextV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
} from '../common/editor/video-motion-model-v27.ts';
import {
	normalizeVideoFinishingPresetV1,
	normalizeVideoVisualPresentationV1,
	type VideoFinishingPresetV1,
	type VideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import {
	normalizeFramescaperDialogueChainAddCommandFinishing,
	type FramescaperDialogueChainAddCommandFinishing,
} from './editor-audio-dialogue-chain-finishing.ts';

export type FramescaperOwnedFinishingCommand = FramescaperOwnedFinishingCommandFinishing;
export const snapshotFramescaperOwnedFinishingCommand = snapshotFramescaperOwnedFinishingCommandFinishing;

export interface FramescaperVideoColorContextSetCommandFinishing {
	readonly type: 'video-color-context/set';
	readonly sequenceId: string;
	readonly expectedContext: VideoColorContextV1;
	readonly context: VideoColorContextV1;
}

export interface FramescaperVideoSourceColorInterpretationSetCommandFinishing {
	readonly type: 'video-source-color-interpretation/set';
	readonly sourceId: string;
	readonly expectedInterpretation: VideoSourceColorInterpretationV1;
	readonly interpretation: VideoSourceColorInterpretationV1;
}

export interface FramescaperVideoVisualPresentationSetCommandFinishing {
	readonly type: 'video-visual-presentation/set';
	readonly presentationId: string;
	readonly expectedPresentation: VideoVisualPresentationV1 | null;
	readonly presentation: VideoVisualPresentationV1 | null;
}

export interface FramescaperVideoProcessorStackSetCommandFinishing {
	readonly type: 'video-processor-stack/set';
	readonly processorStackId: string;
	readonly expectedProcessorStack: VideoProcessorStackV1 | null;
	readonly processorStack: VideoProcessorStackV1 | null;
}

export interface FramescaperVideoMotionAnalysisSetCommandFinishing {
	readonly type: 'video-motion-analysis/set';
	readonly motionAnalysisId: string;
	readonly expectedMotionAnalysis: VideoMotionAnalysisReferenceV1 | null;
	readonly motionAnalysis: VideoMotionAnalysisReferenceV1 | null;
}

export interface FramescaperVideoFinishingPresetSetCommandFinishing {
	readonly type: 'video-finishing-preset/set';
	readonly finishingPresetId: string;
	readonly expectedFinishingPreset: VideoFinishingPresetV1 | null;
	readonly finishingPreset: VideoFinishingPresetV1 | null;
}

export interface FramescaperVideoCaptionTrackSetCommandFinishing {
	readonly type: 'video-caption-track/set';
	readonly captionTrackId: string;
	readonly expectedCaptionTrack: VideoCaptionTrackV1 | null;
	readonly captionTrack: VideoCaptionTrackV1 | null;
}

export interface FramescaperAutomationLaneSetCommandFinishing {
	readonly type: 'automation-lane/set';
	readonly laneId: string;
	readonly expected: AutomationLaneV21 | null;
	readonly lane: AutomationLaneV21 | null;
}

export interface FramescaperMixerGraphSetCommandFinishing {
	readonly type: 'mixer-graph/set';
	readonly expected: MixerGraphV21;
	readonly mixer: MixerGraphV21;
}

export type FramescaperOwnedFinishingCommandFinishing =
	| FramescaperDialogueChainAddCommandFinishing
	| FramescaperVideoColorContextSetCommandFinishing
	| FramescaperVideoSourceColorInterpretationSetCommandFinishing
	| FramescaperVideoVisualPresentationSetCommandFinishing
	| FramescaperVideoProcessorStackSetCommandFinishing
	| FramescaperVideoMotionAnalysisSetCommandFinishing
	| FramescaperVideoFinishingPresetSetCommandFinishing
	| FramescaperVideoCaptionTrackSetCommandFinishing
	| FramescaperAutomationLaneSetCommandFinishing
	| FramescaperMixerGraphSetCommandFinishing;

interface CollectionCommandSpec {
	readonly projectField: string;
	readonly idField: string;
	readonly expectedField: string;
	readonly valueField: string;
	readonly identityField: string;
	readonly nullable: boolean;
	readonly label: string;
	readonly normalize: (value: unknown) => Readonly<Record<string, unknown>>;
}

const COLLECTION_SPECS = Object.freeze({
	'video-color-context/set': spec('videoColorContexts', 'sequenceId', 'expectedContext', 'context',
		'sequenceId', false, 'color context', normalizeVideoColorContextV1),
	'video-source-color-interpretation/set': spec('videoSourceColorInterpretations', 'sourceId',
		'expectedInterpretation', 'interpretation', 'sourceId', false, 'source color interpretation',
		normalizeVideoSourceColorInterpretationV1),
	'video-visual-presentation/set': spec('videoVisualPresentations', 'presentationId',
		'expectedPresentation', 'presentation', 'id', true, 'visual presentation',
		normalizeVideoVisualPresentationV1),
	'video-processor-stack/set': spec('videoProcessorStacks', 'processorStackId',
		'expectedProcessorStack', 'processorStack', 'id', true, 'processor stack',
		normalizeVideoProcessorStackV1),
	'video-motion-analysis/set': spec('videoMotionAnalyses', 'motionAnalysisId',
		'expectedMotionAnalysis', 'motionAnalysis', 'id', true, 'motion analysis',
		normalizeVideoMotionAnalysisReferenceV1),
	'video-finishing-preset/set': spec('videoFinishingPresets', 'finishingPresetId',
		'expectedFinishingPreset', 'finishingPreset', 'id', true, 'finishing preset',
		normalizeVideoFinishingPresetV1),
	'video-caption-track/set': spec('videoCaptionTracks', 'captionTrackId',
		'expectedCaptionTrack', 'captionTrack', 'id', true, 'caption track',
		normalizeVideoCaptionTrackV1),
	'automation-lane/set': spec('automationLanes', 'laneId',
		'expected', 'lane', 'id', true, 'automation lane',
		normalizeAutomationLaneV21),
} as const);

type CollectionCommandType = keyof typeof COLLECTION_SPECS;
const DIALOGUE_CHAIN_ADD = 'framescaper/audio-dialogue-chain-add';
const TYPES = new Set<string>([
	...Object.keys(COLLECTION_SPECS), 'mixer-graph/set', DIALOGUE_CHAIN_ADD,
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export function isFramescaperOwnedFinishingCommandTypeFinishing(type: string): boolean {
	return TYPES.has(type);
}

export function snapshotFramescaperOwnedFinishingCommandFinishing(
	value: unknown,
): FramescaperOwnedFinishingCommandFinishing {
	const type = commandType(value);
	if (type === DIALOGUE_CHAIN_ADD) return normalizeFramescaperDialogueChainAddCommandFinishing(value);
	if (type === 'mixer-graph/set') return snapshotMixer(value);
	const commandSpec = COLLECTION_SPECS[type as CollectionCommandType];
	if (!commandSpec) throw new RangeError('Framescaper finishing finishing command type is unsupported.');
	const command = readClosedDomainRecord(value, `Framescaper finishing ${commandSpec.label} command`, [
		'type', commandSpec.idField, commandSpec.expectedField, commandSpec.valueField,
	]);
	const identity = stableId(field(command, commandSpec.idField), commandSpec.idField);
	const expected = optionalNormalized(field(command, commandSpec.expectedField), commandSpec);
	const replacement = optionalNormalized(field(command, commandSpec.valueField), commandSpec);
	assertMutation(expected, replacement, commandSpec.label);
	assertIdentity(identity, expected, replacement, commandSpec);
	return Object.freeze({ type, [commandSpec.idField]: identity,
		[commandSpec.expectedField]: expected, [commandSpec.valueField]: replacement,
	}) as unknown as FramescaperOwnedFinishingCommandFinishing;
}

export function applyFramescaperOwnedFinishingCommandFinishing(
	project: Record<string, unknown>,
	commandValue: FramescaperOwnedFinishingCommandFinishing,
): void {
	const command = snapshotFramescaperOwnedFinishingCommandFinishing(commandValue);
	if (command.type === DIALOGUE_CHAIN_ADD) {
		applyDialogueChain(project, command);
		return;
	}
	if (command.type === 'mixer-graph/set') {
		if (!same(project.mixer, command.expected)) {
			throw new Error('The expected finishing mixer graph is stale.');
		}
		project.mixer = command.mixer;
		return;
	}
	const commandSpec = COLLECTION_SPECS[command.type];
	const values = records(project[commandSpec.projectField], commandSpec.projectField);
	const item = command as unknown as Readonly<Record<string, unknown>>;
	const identity = String(item[commandSpec.idField]);
	const index = values.findIndex((value) => value[commandSpec.identityField] === identity);
	const current = index < 0 ? null : values[index]!;
	const expected = item[commandSpec.expectedField] ?? null;
	const replacement = item[commandSpec.valueField] ?? null;
	if (!same(current, expected)) throw new Error(`The expected finishing ${commandSpec.label} is stale.`);
	if (replacement === null) values.splice(index, 1);
	else if (index < 0) values.push(replacement as Record<string, unknown>);
	else values[index] = replacement as Record<string, unknown>;
	project[commandSpec.projectField] = values;
}

function applyDialogueChain(
	project: Record<string, unknown>,
	command: FramescaperDialogueChainAddCommandFinishing,
): void {
	if (command.chain.sampleRate !== project.sampleRate) {
		throw new RangeError('The dialogue-chain sample rate must match the finishing project.');
	}
	const tracks = records(project.tracks, 'tracks');
	const track = tracks.find(({ id }) => id === command.trackId);
	if (!track || track.type !== 'audio') {
		throw new ReferenceError('The dialogue-chain target must be an existing audio track.');
	}
	const effects = records(track.effects, 'audio track effects');
	const index = command.startIndex ?? effects.length;
	if (index > effects.length) throw new RangeError('The dialogue-chain insertion index exceeds the audio rack.');
	if (effects.length + command.chain.effects.length > 256) {
		throw new RangeError('The dialogue chain would exceed the audio rack effect limit.');
	}
	const identities = new Set(effects.map(({ id }) => id));
	if (command.chain.effects.some(({ id }) => identities.has(id))) {
		throw new Error('The dialogue chain effect identities already exist in the target rack.');
	}
	effects.splice(index, 0, ...command.chain.effects.map((effect) => (
		effect as unknown as Record<string, unknown>
	)));
	track.effects = effects;
}

function snapshotMixer(value: unknown): FramescaperMixerGraphSetCommandFinishing {
	const command = readClosedDomainRecord(value, 'Framescaper finishing mixer command', [
		'type', 'expected', 'mixer',
	]);
	const expected = normalizeMixerGraphV21(field(command, 'expected'));
	const mixer = normalizeMixerGraphV21(field(command, 'mixer'));
	assertMutation(expected, mixer, 'mixer graph');
	return Object.freeze({ type: 'mixer-graph/set', expected, mixer });
}

function spec<T>(
	projectField: string,
	idField: string,
	expectedField: string,
	valueField: string,
	identityField: string,
	nullable: boolean,
	label: string,
	normalize: (value: unknown) => T,
): CollectionCommandSpec {
	return Object.freeze({ projectField, idField, expectedField, valueField, identityField,
		nullable, label, normalize: normalize as (value: unknown) => Readonly<Record<string, unknown>> });
}

function optionalNormalized(
	value: unknown,
	commandSpec: CollectionCommandSpec,
): Readonly<Record<string, unknown>> | null {
	if (value === null) {
		if (!commandSpec.nullable) throw new RangeError(`A finishing ${commandSpec.label} cannot be removed.`);
		return null;
	}
	return commandSpec.normalize(value);
}

function assertIdentity(
	identity: string,
	expected: Readonly<Record<string, unknown>> | null,
	replacement: Readonly<Record<string, unknown>> | null,
	commandSpec: CollectionCommandSpec,
): void {
	for (const value of [expected, replacement]) {
		if (value !== null && value[commandSpec.identityField] !== identity) {
			throw new RangeError(`A finishing ${commandSpec.label} command cannot change identity.`);
		}
	}
}

function assertMutation(expected: unknown, replacement: unknown, label: string): void {
	if (same(expected, replacement)) throw new RangeError(`A finishing ${label} command must mutate state; no-op commands are unsupported.`);
}

function commandType(value: unknown): string {
	const command = record(value, 'Framescaper finishing finishing command');
	const type = field(command, 'type');
	if (typeof type !== 'string' || !TYPES.has(type)) {
		throw new RangeError('Framescaper finishing finishing command type is unsupported.');
	}
	return type;
}

function field(value: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(value, name, 'Framescaper finishing finishing command');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) {
		throw new TypeError(`Framescaper finishing ${name} must be a stable ID.`);
	}
	return value;
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
