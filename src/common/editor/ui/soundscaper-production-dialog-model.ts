/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isMasteringSequenceProjectSchema,
	isSoundscaperProductionProjectSchema,
} from '../project-schema-version.ts';
import {
	createDocumentMasteringSequenceSnapshot,
	type DocumentMasteringSequenceRegionSnapshot,
	type DocumentMasteringSequenceSnapshot,
} from '../controller/document-mastering-sequence-snapshot.ts';
import {
	effectParameterInventory,
	stripParameterDescriptor,
} from '../effect-parameter-descriptors.ts';
import {
	canonicalParameterAddressKey,
	normalizeParameterAddress,
	type ParameterDescriptor,
} from '../parameter-address.ts';
import {
	SOUNDSCAPER_AUTOMATION_MODES,
	type SoundscaperAutomationMode,
	type SoundscaperProductionMenuCapabilities,
	type SoundscaperProductionSurface,
} from './soundscaper-production-application-menu.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export type SoundscaperProductionDialogBlockReason =
	| 'unsupported'
	| 'wrong-schema'
	| 'read-only'
	| 'busy'
	| 'locked'
	| 'no-selection'
	| null;

export interface SoundscaperProductionDialogLane {
	readonly id: string;
	readonly address: string;
	readonly timebase: string;
	readonly pointCount: number;
	readonly points: readonly SoundscaperProductionDialogLanePoint[];
	readonly segmentKinds: readonly string[];
	readonly parameter: SoundscaperProductionDialogParameter | null;
	readonly documentText: string;
}

export interface SoundscaperProductionDialogLanePoint {
	readonly id: string;
	readonly position: number | Readonly<{ readonly num: number; readonly den: number }>;
	readonly value: number;
}

export interface SoundscaperProductionDialogParameter {
	readonly label: string;
	readonly unit: string;
	readonly minimum: number;
	readonly maximum: number;
	readonly step: number | null;
	readonly taper: 'linear' | 'logarithmic' | 'decibel' | 'discrete';
}

export interface SoundscaperProductionDialogTrack {
	readonly id: string;
	readonly name: string;
	readonly locked: boolean;
	readonly clipCount: number;
}

export interface SoundscaperProductionMixerCounts {
	readonly groups: number;
	readonly sends: number;
	readonly cues: number;
	readonly vcas: number;
	readonly outputs: number;
	readonly edges: number;
}

export interface SoundscaperProductionDialogModel {
	readonly surface: SoundscaperProductionSurface | null;
	readonly surfaces: readonly SoundscaperProductionSurface[];
	readonly selectedTrack: SoundscaperProductionDialogTrack | null;
	readonly automationTarget: string | null;
	readonly automationMode: SoundscaperAutomationMode;
	readonly lanes: readonly SoundscaperProductionDialogLane[];
	readonly selectedLaneId: string | null;
	readonly selectedLaneText: string;
	readonly selectedLaneParameter: SoundscaperProductionDialogParameter | null;
	/** Projection context for converting a lane between the sample and beat timebases. */
	readonly laneTimebase: Readonly<{ sampleRate: unknown; tempoMap: unknown }>;
	readonly mixerGraphText: string;
	readonly mixerCounts: SoundscaperProductionMixerCounts;
	readonly masteringSequences: readonly DocumentMasteringSequenceSnapshot[];
	/** The regions an entry may point at, in timeline order. */
	readonly masteringRegions: readonly DocumentMasteringSequenceRegionSnapshot[];
	readonly operationsBlocked: boolean;
	readonly blockReason: SoundscaperProductionDialogBlockReason;
}

export interface SoundscaperProductionDialogModelInput {
	readonly productId: string;
	readonly capabilities: SoundscaperProductionMenuCapabilities;
	readonly project: unknown;
	readonly selectedTrackId?: string | null;
	readonly selectedAutomationTarget?: unknown;
	readonly selectedLaneId?: string | null;
	readonly requestedSurface: SoundscaperProductionSurface;
	readonly automationMode?: SoundscaperAutomationMode;
	readonly readOnly?: boolean;
	readonly editingBlocked?: boolean;
}

/** Snapshot just enough canonical state for the lazy production overlay. */
export function createSoundscaperProductionDialogModel(
	input: SoundscaperProductionDialogModelInput,
): SoundscaperProductionDialogModel {
	const surfaces = supportedSurfaces(input.productId, input.capabilities);
	const surface = surfaces.includes(input.requestedSurface)
		? input.requestedSurface
		: surfaces[0] ?? null;
	const project = record(input.project);
	const tracks = recordArray(own(project, 'tracks'));
	const track = tracks.find((candidate) => own(candidate, 'id') === input.selectedTrackId) ?? null;
	const selectedAudioTrack = own(track, 'type') === 'audio' ? track : null;
	const selectedTrack = selectedAudioTrack ? Object.freeze({
		id: text(own(selectedAudioTrack, 'id')) ?? '',
		name: text(own(selectedAudioTrack, 'name')) ?? text(own(selectedAudioTrack, 'id')) ?? '',
		locked: own(selectedAudioTrack, 'locked') === true,
		clipCount: arrayLength(own(selectedAudioTrack, 'clipIds')),
	}) : null;
	const automationTarget = normalizeAutomationTarget(
		input.selectedAutomationTarget ?? (selectedTrack
			? Object.freeze({ kind: 'track', id: selectedTrack.id })
			: null),
	);
	const lanes = automationLanes(project, automationTarget?.key ?? null);
	const selectedLane = lanes.find(({ id }) => id === input.selectedLaneId) ?? lanes[0] ?? null;
	const mixer = record(own(project, 'mixer'));
	const mixerCounts = mixerCollectionCounts(mixer);
	const masteringSequenceSnapshot = createDocumentMasteringSequenceSnapshot(input.project);
	const blockReason = resolveBlockReason({
		input, surface, project, selectedTrack,
	});
	const mode = SOUNDSCAPER_AUTOMATION_MODES.includes(input.automationMode ?? 'read')
		? input.automationMode ?? 'read'
		: 'read';
	return Object.freeze({
		surface,
		surfaces,
		selectedTrack,
		automationTarget: automationTarget?.label ?? null,
		automationMode: mode,
		lanes,
		selectedLaneId: selectedLane?.id ?? null,
		selectedLaneText: selectedLane?.documentText ?? '',
		selectedLaneParameter: selectedLane?.parameter ?? null,
		// The automation editor converts lane positions between timebases, which is a
		// tempo-map projection rather than a reinterpretation of the same number.
		laneTimebase: Object.freeze({
			sampleRate: Number(own(project, 'sampleRate')),
			tempoMap: own(project, 'tempoMap'),
		}),
		mixerGraphText: safeDocumentText(mixer),
		mixerCounts,
		masteringSequences: masteringSequenceSnapshot.sequences,
		masteringRegions: masteringSequenceSnapshot.regions,
		operationsBlocked: blockReason !== null,
		blockReason,
	});
}

function supportedSurfaces(
	productId: string,
	capabilities: SoundscaperProductionMenuCapabilities,
): readonly SoundscaperProductionSurface[] {
	if (productId !== 'soundscaper') return Object.freeze([]);
	const surfaces: SoundscaperProductionSurface[] = [];
	if (capabilities.audioAutomation === true) surfaces.push('automation');
	if (capabilities.audioMixerGraph === true) surfaces.push('routing');
	if (capabilities.audioEffects === true) surfaces.push('restoration');
	if (capabilities.audioAnalysis === true) surfaces.push('metering');
	if (capabilities.masteringSequences === true) surfaces.push('mastering-sequences');
	if (capabilities.audioEffects === true && (
		capabilities.reviewedWebEffectPackages === true
		|| capabilities.reviewedEffectPackages === true
	)) surfaces.push('reviewed-effects');
	return Object.freeze(surfaces);
}

function automationLanes(
	project: DataRecord | null,
	targetKey: string | null,
): readonly SoundscaperProductionDialogLane[] {
	const lanes = recordArray(own(project, 'automationLanes'));
	return Object.freeze(lanes
		.filter((lane) => targetKey !== null && laneTargetKey(lane) === targetKey)
		.map((lane) => {
			const id = text(own(lane, 'id')) ?? '';
			const descriptor = automationDescriptor(project, lane);
			return Object.freeze({
				id,
				address: describeAddress(record(own(lane, 'address'))),
				timebase: text(own(lane, 'timebase')) ?? '',
				pointCount: arrayLength(own(lane, 'points')),
				points: lanePoints(lane),
				segmentKinds: Object.freeze(recordArray(own(lane, 'segments'))
					.map((segment) => text(own(segment, 'kind')) ?? '')),
				parameter: descriptor ? parameterView(descriptor) : null,
				documentText: safeDocumentText(lane),
			});
		}));
}

function automationDescriptor(project: DataRecord | null, lane: DataRecord): ParameterDescriptor | null {
	try {
		const address = normalizeParameterAddress(own(lane, 'address'));
		if (address.kind !== 'effect') return stripParameterDescriptor(address);
		const effect = stripEffects(project, address.strip).find(({ id }) => id === address.effectId);
		if (!effect) return null;
		const inventory = effectParameterInventory(address.strip, effect, {
			sampleRate: Number(own(project, 'sampleRate')),
		});
		const key = canonicalParameterAddressKey(address);
		return inventory.descriptors.find(({ id }) => id === key) ?? null;
	} catch {
		return null;
	}
}

function stripEffects(
	project: DataRecord | null,
	strip: Readonly<{ readonly kind: string; readonly id?: string }>,
): readonly DataRecord[] {
	if (strip.kind === 'master') return recordArray(own(record(own(project, 'master')), 'effects'));
	if (strip.kind === 'track') {
		const track = recordArray(own(project, 'tracks')).find(({ id }) => id === strip.id) ?? null;
		return recordArray(own(track, 'effects'));
	}
	const mixer = record(own(project, 'mixer'));
	for (const collection of ['groups', 'sends', 'cues']) {
		const node = recordArray(own(mixer, collection)).find(({ id }) => id === strip.id) ?? null;
		if (node) return recordArray(own(node, 'effects'));
	}
	return Object.freeze([]);
}

function parameterView(descriptor: ParameterDescriptor): SoundscaperProductionDialogParameter {
	return Object.freeze({
		label: parameterLabel(descriptor.address.parameterId),
		unit: descriptor.unit,
		minimum: descriptor.minimum,
		maximum: descriptor.maximum,
		step: descriptor.step,
		taper: descriptor.taper,
	});
}

function parameterLabel(parameterId: string): string {
	return parameterId.replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
		.replace(/[-_]+/gu, ' ')
		.replace(/^./u, (value) => value.toUpperCase());
}

function lanePoints(lane: DataRecord): readonly SoundscaperProductionDialogLanePoint[] {
	return Object.freeze(recordArray(own(lane, 'points')).flatMap((point) => {
		const id = text(own(point, 'id'));
		const value = finite(own(point, 'value'));
		const positionValue = own(point, 'position');
		const positionRecord = record(positionValue);
		const num = finite(own(positionRecord, 'num'));
		const den = finite(own(positionRecord, 'den'));
		const position = Number.isSafeInteger(positionValue)
			? Number(positionValue)
			: Number.isSafeInteger(num) && Number.isSafeInteger(den)
				? Object.freeze({ num: Number(num), den: Number(den) })
				: null;
		return id && value !== null && position !== null
			? [Object.freeze({ id, position, value })]
			: [];
	}));
}

function laneTargetKey(lane: DataRecord): string | null {
	const address = record(own(lane, 'address'));
	if (own(address, 'kind') === 'edge') {
		const edgeId = text(own(address, 'edgeId'));
		return edgeId ? `edge:${edgeId}` : null;
	}
	const strip = record(own(address, 'strip'));
	const kind = own(strip, 'kind');
	if (kind === 'master') return 'strip:master';
	if (kind !== 'track' && kind !== 'mixer-node') return null;
	const id = text(own(strip, 'id'));
	return id ? `strip:${kind}:${id}` : null;
}

function describeAddress(address: DataRecord | null): string {
	if (!address) return '';
	const kind = text(own(address, 'kind')) ?? 'parameter';
	const parameterId = text(own(address, 'parameterId')) ?? '';
	const effectId = text(own(address, 'effectId'));
	const strip = record(own(address, 'strip'));
	const stripId = text(own(strip, 'id')) ?? String(own(strip, 'kind') ?? '');
	return [stripId, effectId, parameterId || kind].filter(Boolean).join(' / ');
}

function mixerCollectionCounts(mixer: DataRecord | null): SoundscaperProductionMixerCounts {
	return Object.freeze({
		groups: arrayLength(own(mixer, 'groups')),
		sends: arrayLength(own(mixer, 'sends')),
		cues: arrayLength(own(mixer, 'cues')),
		vcas: arrayLength(own(mixer, 'vcas')),
		outputs: arrayLength(own(mixer, 'outputs')),
		edges: arrayLength(own(mixer, 'edges')),
	});
}

function resolveBlockReason(value: Readonly<{
	input: SoundscaperProductionDialogModelInput;
	surface: SoundscaperProductionSurface | null;
	project: DataRecord | null;
	selectedTrack: SoundscaperProductionDialogTrack | null;
}>): SoundscaperProductionDialogBlockReason {
	if (value.surface === null || value.project === null) return 'unsupported';
	if ((value.surface === 'automation' || value.surface === 'routing')
		&& !isSoundscaperProductionProjectSchema(own(value.project, 'schemaVersion'))) return 'wrong-schema';
	// Narrower than the production authority: a V21 document carries that but has
	// nowhere to put a sequence, so every edit this surface offers would fail.
	if (value.surface === 'mastering-sequences'
		&& !isMasteringSequenceProjectSchema(own(value.project, 'schemaVersion'))) return 'wrong-schema';
	if (value.input.readOnly === true) return 'read-only';
	if (value.input.editingBlocked === true) return 'busy';
	const automationTarget = normalizeAutomationTarget(
		value.input.selectedAutomationTarget ?? (value.selectedTrack
			? Object.freeze({ kind: 'track', id: value.selectedTrack.id })
			: null),
	);
	if (value.surface === 'automation' && (
		automationTarget === null || !automationTargetExists(value.project, automationTarget)
	)) return 'no-selection';
	if (value.surface === 'automation' && automationTarget?.kind === 'track') {
		const targetTrack = recordArray(own(value.project, 'tracks')).find((track) => (
			own(track, 'type') === 'audio' && own(track, 'id') === automationTarget.id
		));
		if (own(targetTrack ?? null, 'locked') === true) return 'locked';
	}
	const trackRequired = value.surface === 'restoration'
		|| value.surface === 'reviewed-effects';
	if (trackRequired && value.selectedTrack === null) return 'no-selection';
	if (trackRequired && value.selectedTrack?.locked === true) return 'locked';
	return null;
}

function safeDocumentText(value: unknown): string {
	if (value === null || value === undefined) return '';
	try {
		return JSON.stringify(value, null, '\t');
	} catch {
		return '';
	}
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: null;
}

function recordArray(value: unknown): readonly DataRecord[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return Object.freeze(value.map(record).filter((item): item is DataRecord => item !== null));
}

function own(value: DataRecord | null, key: string): unknown {
	if (!value) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
		? descriptor.value
		: undefined;
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function finite(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0) ? value : null;
}

interface NormalizedAutomationTarget {
	readonly key: string;
	readonly label: string;
	readonly kind: 'track' | 'mixer-node' | 'master' | 'edge';
	readonly id?: string;
}

function normalizeAutomationTarget(value: unknown): Readonly<NormalizedAutomationTarget> | null {
	const target = record(value);
	const kind = own(target, 'kind');
	if (kind === 'master') return Object.freeze({ key: 'strip:master', label: 'Master', kind });
	if (kind === 'track' || kind === 'mixer-node') {
		const id = text(own(target, 'id'));
		return id ? Object.freeze({ key: `strip:${kind}:${id}`, label: id, kind, id }) : null;
	}
	if (kind === 'edge') {
		const id = text(own(target, 'edgeId')) ?? text(own(target, 'id'));
		return id ? Object.freeze({ key: `edge:${id}`, label: id, kind, id }) : null;
	}
	return null;
}

function automationTargetExists(
	project: DataRecord,
	target: Readonly<NormalizedAutomationTarget>,
): boolean {
	if (target.kind === 'master') return true;
	if (target.kind === 'track') return recordArray(own(project, 'tracks')).some((track) => (
		own(track, 'type') === 'audio' && own(track, 'id') === target.id
	));
	const mixer = record(own(project, 'mixer'));
	if (target.kind === 'edge') return recordArray(own(mixer, 'edges')).some((edge) => (
		own(edge, 'id') === target.id
	));
	return ['groups', 'sends', 'cues'].some((collection) => (
		recordArray(own(mixer, collection)).some((node) => own(node, 'id') === target.id)
	));
}
