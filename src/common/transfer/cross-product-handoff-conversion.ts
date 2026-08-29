/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalJsonSha256 } from '../canonical-json-sha256.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from '../editor/project-schema-identity.ts';
import {
	admitCrossProductHandoffLaunchIntent,
	type CrossProductHandoffLaunchIntentV1,
	type CrossProductHandoffProjectRef,
} from '../cross-product-handoff-intent.ts';
import { validateSoundscaperProject } from '../../soundscaper/editor-project-validation.ts';
import { createSoundscaperProject } from '../../soundscaper/editor-project.ts';
import { createFramescaperProject, validateFramescaperProject } from '../../framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../../framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from
	'../../framescaper/editor-domain-runtime-profile.ts';
import { materializeFramescaperNestedPlaybackFoundationSequence } from
	'../../framescaper/editor-project-sequence-nested-playback.ts';
import { crossProductHandoffRootNames } from './cross-product-handoff-root-contract.ts';
import {
	crossProductHandoffDestinationAuthorityRefusals,
	crossProductHandoffSourceAuthorityRefusals,
} from './cross-product-handoff-authority-preflight.ts';
import {
	CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY,
	crossProductHandoffProvenanceMatchesReport,
	crossProductHandoffReportClaimsSha256,
	createCrossProductHandoffProvenance,
	readCrossProductHandoffProvenance,
} from './cross-product-handoff-provenance.ts';

const MAXIMUM_REASON_LENGTH = 512;
const PROVISIONAL_REPORT_CLAIMS_SHA256 = '0'.repeat(64);

export type CrossProductHandoffDisposition =
	| 'copy'
	| 'materialize-fallback'
	| 'omit-with-report'
	| 'refuse';

export interface CrossProductHandoffRootPolicy {
	readonly root: string;
	readonly disposition: CrossProductHandoffDisposition;
	readonly reason: string;
}

export interface CrossProductHandoffRootReport extends CrossProductHandoffRootPolicy {
	readonly sourceRef: string;
	readonly destinationRef: string | null;
	readonly sourceSha256: string;
	readonly destinationSha256: string | null;
}

export interface CrossProductHandoffConversionReportV1 {
	readonly kind: 'cross-product-editable-copy-report';
	readonly version: 1;
	readonly invocationId: string;
	readonly refused: boolean;
	readonly source: Readonly<CrossProductHandoffProjectRef & { readonly sha256: string }>;
	readonly destination: Readonly<CrossProductHandoffProjectRef & { readonly sha256: string }> | null;
	readonly roots: readonly Readonly<CrossProductHandoffRootReport>[];
}

export interface CrossProductEditableCopyResult {
	readonly project: Readonly<Record<string, unknown> & { readonly id: string }>;
	readonly report: Readonly<CrossProductHandoffConversionReportV1>;
}

export class CrossProductHandoffRefusalError extends Error {
	readonly code = 'CROSS_PRODUCT_HANDOFF_REFUSED' as const;
	readonly report: Readonly<CrossProductHandoffConversionReportV1>;

	constructor(message: string, report: Readonly<CrossProductHandoffConversionReportV1>, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'CrossProductHandoffRefusalError';
		this.report = report;
	}
}

export interface ConvertCrossProductEditableCopyRequest {
	readonly intent: unknown;
	readonly sourceProject: unknown;
}

/** Static closure: every persisted root has one declared default treatment. */
export function crossProductHandoffRootPolicy(
	family: ProjectSchemaFamily,
): readonly Readonly<CrossProductHandoffRootPolicy>[] {
	if (family === SOUNDSCAPER_PROJECT_SCHEMA_FAMILY) return SOUNDSCAPER_ROOT_POLICY;
	if (family === FRAMESCAPER_PROJECT_SCHEMA_FAMILY) return FRAMESCAPER_ROOT_POLICY;
	throw new RangeError(`Unsupported cross-product handoff family: ${String(family)}.`);
}

/**
 * Produce a detached destination-family v1 root or refuse before any archive/store mutation.
 * The intent owns the destination identity, so retrying one invocation is idempotent while a
 * later invocation remains an independently identified copy.
 */
export function convertCrossProductEditableCopy(
	request: ConvertCrossProductEditableCopyRequest,
): Readonly<CrossProductEditableCopyResult> {
	if (!request || typeof request !== 'object') {
		throw new TypeError('A cross-product editable-copy request must be a record.');
	}
	const intent = admitCrossProductHandoffLaunchIntent(request.intent);
	const source = record(request.sourceProject, 'Cross-product handoff source project');
	const identity = readProjectSchemaIdentity(source);
	if (identity.schemaFamily !== intent.source.schemaFamily
		|| identity.schemaVersion !== intent.source.schemaVersion
		|| source.id !== intent.source.projectId
		|| source.revision !== intent.sourceRevision) {
		throw new RangeError('The cross-product handoff source does not match its exact launch intent revision.');
	}
	try {
		validateOwningProject(identity.schemaFamily, source);
	} catch (error) {
		throw new TypeError(
			`The ${identity.schemaFamily} source failed owning validation before refusal-ledger hashing.`,
			{ cause: error },
		);
	}
	let decisions = classifyRoots(identity.schemaFamily, source);
	const initialRefusals = decisions.filter(({ disposition }) => disposition === 'refuse');
	if (initialRefusals.length > 0) {
		throw refusal(intent, source, decisions, initialRefusals.map(({ reason }) => reason).join(' '));
	}
	decisions = applyAuthorityRefusals(
		decisions,
		crossProductHandoffSourceAuthorityRefusals(identity.schemaFamily, source),
	);
	const sourceAuthorityRefusals = decisions.filter(({ disposition }) => disposition === 'refuse');
	if (sourceAuthorityRefusals.length > 0) {
		throw refusal(
			intent, source, decisions, sourceAuthorityRefusals.map(({ reason }) => reason).join(' '),
		);
	}
	let destination: Readonly<Record<string, unknown> & { readonly id: string }>;
	let recordedDecisions: readonly Readonly<CrossProductHandoffRootPolicy>[];
	try {
		const provisionalDestination = constructDestination(
			identity.schemaFamily, source, intent, PROVISIONAL_REPORT_CLAIMS_SHA256,
		);
		recordedDecisions = replaceDecision(
			decisions,
			'opaqueExtensions',
			'materialize-fallback',
			'The destination records a closed invocation identity so exact retries remain recognizable after import remapping.',
		);
		const provisionalReport = conversionReport(
			intent,
			source,
			provisionalDestination,
			reconcileConvertedRoots(source, provisionalDestination, recordedDecisions),
			false,
		);
		destination = constructDestination(
			identity.schemaFamily,
			source,
			intent,
			crossProductHandoffReportClaimsSha256(provisionalReport),
		);
	} catch (error) {
		if (error instanceof CrossProductHandoffRefusalError) throw error;
		const root = activeMaterializationRoot(identity.schemaFamily, source) ?? 'schemaFamily';
		const refused = replaceDecision(decisions, root, 'refuse',
			`The destination copy could not be materialized safely: ${describe(error)}`);
		throw refusal(intent, source, refused, refused.find((item) => item.root === root)!.reason, error);
	}
	decisions = applyAuthorityRefusals(
		decisions,
		crossProductHandoffDestinationAuthorityRefusals(
			intent.destination.schemaFamily,
			destination,
		),
	);
	const incompatibleDestination = decisions.filter(({ disposition }) => disposition === 'refuse');
	if (incompatibleDestination.length > 0) {
		throw refusal(
			intent, source, decisions, incompatibleDestination.map(({ reason }) => reason).join(' '),
		);
	}
	const report = conversionReport(
		intent,
		source,
		destination,
		reconcileConvertedRoots(source, destination, recordedDecisions),
		false,
	);
	if (!crossProductHandoffProvenanceMatchesReport(
		readCrossProductHandoffProvenance(destination),
		report,
	)) {
		const refused = replaceDecision(
			decisions,
			'opaqueExtensions',
			'refuse',
			'The destination invocation marker did not commit to the exact conversion report claims.',
		);
		throw refusal(intent, source, refused, refused.find(({ root }) => root === 'opaqueExtensions')!.reason);
	}
	return Object.freeze({ project: destination, report });
}

function constructDestination(
	sourceFamily: ProjectSchemaFamily,
	source: Record<string, unknown>,
	intent: Readonly<CrossProductHandoffLaunchIntentV1>,
	reportClaimsSha256: string,
): Readonly<Record<string, unknown> & { readonly id: string }> {
	return sourceFamily === SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
		? soundscaperToFramescaper(source, intent, reportClaimsSha256)
		: framescaperToSoundscaper(source, intent, reportClaimsSha256);
}

function soundscaperToFramescaper(
	source: Record<string, unknown>,
	intent: Readonly<CrossProductHandoffLaunchIntentV1>,
	reportClaimsSha256: string,
): Readonly<Record<string, unknown> & { readonly id: string }> {
	return createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		...sharedConstructorOptions(source, intent, source, reportClaimsSha256),
		takeGroups: [],
		finishing: {
			automationLanes: clone(source.automationLanes),
			mixer: clone(source.mixer),
		},
		assistanceAssets: clone(source.assistanceAssets),
	} as never) as unknown as Readonly<Record<string, unknown> & { readonly id: string }>;
}

function framescaperToSoundscaper(
	source: Record<string, unknown>,
	intent: Readonly<CrossProductHandoffLaunchIntentV1>,
	reportClaimsSha256: string,
): Readonly<Record<string, unknown> & { readonly id: string }> {
	const projected = framescaperSoundProjection(source);
	return createSoundscaperProject({
		...sharedConstructorOptions(projected, intent, source, reportClaimsSha256),
		masteringSequences: [],
		nativePluginStates: [],
		assistanceAssets: clone(projected.assistanceAssets ?? []),
	} as never) as unknown as Readonly<Record<string, unknown> & { readonly id: string }>;
}

/** The maximum safe authenticated Framescaper subset currently available in-repository. */
function framescaperSoundProjection(source: Record<string, unknown>): Record<string, unknown> {
	const hasNested = nonempty(source.subsequences) || nonempty(source.multicameraGroups);
	const materialized = hasNested
		? materializeFramescaperNestedPlaybackFoundationSequence(
			FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
			source,
		) as unknown as Record<string, unknown>
		: source;
	const sources = records(materialized.sources, 'Framescaper sources');
	const clips = records(materialized.clips, 'Framescaper clips');
	const tracks = records(materialized.tracks, 'Framescaper tracks');
	const audioClips: Record<string, unknown>[] = clips.filter(({ kind }) => kind === 'audio')
		.map((clip) => ({ ...clone(clip), avLinkId: null } as Record<string, unknown>));
	const retainedClipIds = new Set(audioClips.map(({ id }) => String(id)));
	const retainedTracks: Record<string, unknown>[] = tracks
		.filter(({ type }) => type === 'audio' || type === 'label')
		.map((track) => ({
			...clone(track),
			...(track.type === 'audio' ? { laneGroupId: null } : {}),
			clipIds: stringsOrEmpty(track.clipIds).filter((id) => retainedClipIds.has(id)),
		} as Record<string, unknown>));
	const retainedTrackIds = new Set(retainedTracks.map(({ id }) => String(id)));
	const sequences = records(materialized.sequences, 'Framescaper sequences').map((sequence) => ({
		...clone(sequence),
		trackIds: stringsOrEmpty(sequence.trackIds).filter((id) => retainedTrackIds.has(id)),
		trackNodes: stringsOrEmpty(sequence.trackIds).filter((id) => retainedTrackIds.has(id)).map((id) => ({
			kind: 'track', id, parentFolderId: null,
		})),
	}));
	const binClips = records(record(source.projectBin, 'Framescaper Project Bin').clips,
		'Framescaper Project Bin clips').filter(({ kind }) => kind === 'audio');
	const retainedSourceIds = new Set([...audioClips, ...binClips].map(({ sourceId }) => String(sourceId)));
	const retainedSources = sources.filter(({ kind, id }) => kind === 'audio' && retainedSourceIds.has(String(id)));
	const assistanceAssets = records(source.assistanceAssets, 'Framescaper assistance assets')
		.filter(({ sourceId }) => retainedSourceIds.has(String(sourceId)));
	return {
		...materialized,
		sources: retainedSources,
		clips: audioClips,
		tracks: retainedTracks,
		projectBin: { ...clone(record(source.projectBin, 'Framescaper Project Bin')), clips: binClips },
		sequences,
		trackFolders: [],
		takeGroups: clone(materialized.takeGroups),
		mixer: clone(materialized.mixer),
		automationLanes: clone(materialized.automationLanes),
		assistanceAssets,
	};
}

function sharedConstructorOptions(
	source: Record<string, unknown>,
	intent: Readonly<CrossProductHandoffLaunchIntentV1>,
	provenanceSource: Record<string, unknown>,
	reportClaimsSha256: string,
): Record<string, unknown> {
	return {
		id: intent.destination.projectId,
		title: source.title,
		revision: 0,
		createdAt: source.updatedAt,
		updatedAt: source.updatedAt,
		sampleRate: source.sampleRate,
		masterChannels: source.masterChannels,
		tempo: clone(source.tempo),
		snap: clone(source.snap),
		timeDisplay: clone(source.timeDisplay),
		metadata: clone(source.metadata),
		sources: clone(source.sources),
		clips: clone(source.clips),
		tracks: clone(source.tracks),
		master: clone(source.master),
		...(source.mixer === undefined ? {} : { mixer: clone(source.mixer) }),
		opaqueExtensions: {
			[CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY]: createCrossProductHandoffProvenance({
				invocationId: intent.invocationId,
				source: { ...intent.source, sha256: canonicalJsonSha256(provenanceSource) },
				destination: intent.destination,
				reportClaimsSha256,
			}),
		},
		projectBin: clone(source.projectBin),
		sequences: clone(source.sequences),
		primarySequenceId: source.primarySequenceId,
		tempoMap: clone(source.tempoMap),
		signatureMap: clone(source.signatureMap),
		timelineAnnotations: clone(source.timelineAnnotations),
		trackFolders: clone(source.trackFolders),
		takeGroups: clone(source.takeGroups),
		automationLanes: clone(source.automationLanes),
	};
}

function classifyRoots(
	family: ProjectSchemaFamily,
	source: Record<string, unknown>,
): readonly Readonly<CrossProductHandoffRootPolicy>[] {
	return Object.freeze(crossProductHandoffRootPolicy(family).map((policy) => {
		const value = source[policy.root];
		if (policy.root === 'opaqueExtensions' && hasOnlyPriorHandoffProvenance(source)) {
			return Object.freeze({
				...policy,
				disposition: 'omit-with-report' as const,
				reason: 'The prior editable-copy invocation identity is replaced by this invocation.',
			});
		}
		if (policy.disposition === 'refuse' && empty(value)) return Object.freeze({
			...policy, disposition: 'omit-with-report' as const,
			reason: `${policy.root} is empty; no unsupported authority is carried into the copy.`,
		});
		if (policy.disposition === 'materialize-fallback' && empty(value)) return Object.freeze({
			...policy, disposition: 'omit-with-report' as const,
			reason: `${policy.root} is empty; no fallback needs to be materialized.`,
		});
		if (family === SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
			&& policy.disposition === 'materialize-fallback') return Object.freeze({
			...policy, disposition: 'refuse' as const,
			reason: `${policy.reason} No authenticated repository-owned materializer is available, so the copy is refused.`,
		});
		return policy;
	}));
}

function hasOnlyPriorHandoffProvenance(source: Record<string, unknown>): boolean {
	try {
		const extensions = record(source.opaqueExtensions, 'Cross-product source opaqueExtensions');
		return Reflect.ownKeys(extensions).length === 1
			&& Object.hasOwn(extensions, CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY)
			&& readCrossProductHandoffProvenance(source) !== null;
	} catch {
		return false;
	}
}

function conversionReport(
	intent: Readonly<CrossProductHandoffLaunchIntentV1>,
	source: Record<string, unknown>,
	destination: Readonly<Record<string, unknown> & { readonly id: string }> | null,
	decisions: readonly Readonly<CrossProductHandoffRootPolicy>[],
	refused: boolean,
): Readonly<CrossProductHandoffConversionReportV1> {
	const destinationRef = destination === null ? null : intent.destination;
	const roots = decisions.map((decision) => {
		const destinationOwnsRoot = destination !== null && Object.hasOwn(destination, decision.root);
		return Object.freeze({
			...decision,
			reason: boundedReason(decision.reason),
			sourceRef: projectRootRef(intent.source, decision.root),
			destinationRef: destinationOwnsRoot && destinationRef !== null
				? projectRootRef(destinationRef, decision.root) : null,
			sourceSha256: canonicalJsonSha256(source[decision.root]),
			destinationSha256: destinationOwnsRoot && destination !== null
				? canonicalJsonSha256(destination[decision.root]) : null,
		});
	});
	return Object.freeze({
		kind: 'cross-product-editable-copy-report' as const,
		version: 1 as const,
		invocationId: intent.invocationId,
		refused,
		source: Object.freeze({ ...intent.source, sha256: canonicalJsonSha256(source) }),
		destination: destination === null ? null : Object.freeze({
			...intent.destination, sha256: canonicalJsonSha256(destination),
		}),
		roots: Object.freeze(roots),
	});
}

function refusal(
	intent: Readonly<CrossProductHandoffLaunchIntentV1>,
	source: Record<string, unknown>,
	decisions: readonly Readonly<CrossProductHandoffRootPolicy>[],
	message: string,
	cause?: unknown,
): CrossProductHandoffRefusalError {
	return new CrossProductHandoffRefusalError(
		boundedReason(message), conversionReport(intent, source, null, decisions, true), cause,
	);
}

function replaceDecision(
	decisions: readonly Readonly<CrossProductHandoffRootPolicy>[],
	root: string,
	disposition: CrossProductHandoffDisposition,
	reason: string,
): readonly Readonly<CrossProductHandoffRootPolicy>[] {
	return Object.freeze(decisions.map((item) => item.root === root
		? Object.freeze({ root, disposition, reason: boundedReason(reason) }) : item));
}

function applyAuthorityRefusals(
	decisions: readonly Readonly<CrossProductHandoffRootPolicy>[],
	refusals: readonly Readonly<{ readonly root: string; readonly reason: string }>[],
): readonly Readonly<CrossProductHandoffRootPolicy>[] {
	return refusals.reduce(
		(result, item) => replaceDecision(result, item.root, 'refuse', item.reason),
		decisions,
	);
}

/** A declared copy may become a projection after the destination constructor normalizes it. */
function reconcileConvertedRoots(
	source: Record<string, unknown>,
	destination: Readonly<Record<string, unknown> & { readonly id: string }>,
	decisions: readonly Readonly<CrossProductHandoffRootPolicy>[],
): readonly Readonly<CrossProductHandoffRootPolicy>[] {
	return Object.freeze(decisions.map((decision) => {
		if (decision.disposition !== 'copy') return decision;
		const sourceValue = source[decision.root];
		const destinationOwnsRoot = Object.hasOwn(destination, decision.root);
		const destinationValue = destinationOwnsRoot ? destination[decision.root] : undefined;
		if (destinationOwnsRoot
			&& canonicalJsonSha256(sourceValue) === canonicalJsonSha256(destinationValue)) return decision;
		if (nonempty(sourceValue) && empty(destinationValue)) return Object.freeze({
			...decision,
			disposition: 'omit-with-report' as const,
			reason: 'The source root has no destination-supported editable members and is omitted.',
		});
		return Object.freeze({
			...decision,
			disposition: 'materialize-fallback' as const,
			reason: 'The destination owner projected this root to its supported editable semantics.',
		});
	}));
}

function activeMaterializationRoot(family: ProjectSchemaFamily, source: Record<string, unknown>): string | null {
	if (family === SOUNDSCAPER_PROJECT_SCHEMA_FAMILY) {
		return ['takeGroups', 'masteringSequences', 'nativePluginStates']
			.find((root) => nonempty(source[root])) ?? null;
	}
	return ['subsequences', 'multicameraGroups'].find((root) => nonempty(source[root])) ?? null;
}

function validateOwningProject(family: ProjectSchemaFamily, source: unknown): void {
	if (family === SOUNDSCAPER_PROJECT_SCHEMA_FAMILY) validateSoundscaperProject(source);
	else validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, source);
}

function projectRootRef(ref: CrossProductHandoffProjectRef, root: string): string {
	return `${ref.schemaFamily}:${ref.projectId}#/${root}`;
}

function empty(value: unknown): boolean {
	if (Array.isArray(value)) return value.length === 0;
	if (value === null || value === undefined) return true;
	if (typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return (prototype === Object.prototype || prototype === null)
		&& Reflect.ownKeys(value).length === 0;
}

function nonempty(value: unknown): boolean { return !empty(value); }

function boundedReason(value: unknown): string {
	const reason = String(value ?? '').replace(/\s+/gu, ' ').trim();
	return (reason || 'No reason was reported.').slice(0, MAXIMUM_REASON_LENGTH);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message || error.name : String(error);
}

function clone<Value>(value: Value): Value { return structuredClone(value); }

function stringsOrEmpty(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new TypeError('Cross-product project identity lists must be arrays.');
	return value.map(String);
}

function records(value: unknown, label: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
	return value.map((item, index) => record(item, `${label}[${String(index)}]`));
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

const SHARED_COPY_ROOTS = new Set([
	'schemaVersion', 'title', 'sampleRate', 'masterChannels', 'tempo', 'snap', 'timeDisplay',
	'metadata', 'sources', 'clips', 'tracks', 'master', 'mixer', 'projectBin', 'sequences',
	'primarySequenceId', 'tempoMap', 'signatureMap', 'timelineAnnotations', 'trackFolders',
	'takeGroups', 'automationLanes', 'assistanceAssets',
]);

function rootPolicy(
	fields: readonly string[],
	overrides: Readonly<Record<string, Readonly<Omit<CrossProductHandoffRootPolicy, 'root'>>>>,
): readonly Readonly<CrossProductHandoffRootPolicy>[] {
	return Object.freeze(fields.map((root) => Object.freeze({
		root,
		...(overrides[root] ?? (SHARED_COPY_ROOTS.has(root)
			? { disposition: 'copy' as const, reason: 'Shared family-v1 semantic authority is copied.' }
			: { disposition: 'omit-with-report' as const, reason: 'Destination-owned identity or operational state is rebuilt.' })),
	})));
}

const SOUNDSCAPER_ROOT_POLICY = rootPolicy(crossProductHandoffRootNames('soundscaper'), {
	schemaFamily: { disposition: 'omit-with-report', reason: 'The destination constructor owns its family.' },
	id: { disposition: 'omit-with-report', reason: 'The invocation owns a newly minted destination identity.' },
	revision: { disposition: 'omit-with-report', reason: 'The independent destination copy starts at revision zero.' },
	createdAt: { disposition: 'omit-with-report', reason: 'The destination copy owns its creation metadata.' },
	updatedAt: { disposition: 'omit-with-report', reason: 'The destination copy owns its update metadata.' },
	selection: { disposition: 'omit-with-report', reason: 'Ephemeral selection state is not copied.' },
	loop: { disposition: 'omit-with-report', reason: 'Ephemeral transport loop state is not copied.' },
	view: { disposition: 'omit-with-report', reason: 'UI view state is not copied.' },
	opaqueExtensions: { disposition: 'refuse', reason: 'Unknown opaque authority cannot be converted safely.' },
	featureRequirements: { disposition: 'omit-with-report', reason: 'The destination owner reconciles its own requirements.' },
	takeGroups: { disposition: 'materialize-fallback', reason: 'Take/comp audio requires an authenticated ordinary-audio fallback.' },
	masteringSequences: { disposition: 'materialize-fallback', reason: 'Mastering output requires authenticated ordinary audio.' },
	nativePluginStates: { disposition: 'materialize-fallback', reason: 'Native plug-in output requires authenticated ordinary audio.' },
});

const FRAMESCAPER_ROOT_POLICY = rootPolicy(crossProductHandoffRootNames('framescaper'), {
	schemaFamily: { disposition: 'omit-with-report', reason: 'The destination constructor owns its family.' },
	id: { disposition: 'omit-with-report', reason: 'The invocation owns a newly minted destination identity.' },
	revision: { disposition: 'omit-with-report', reason: 'The independent destination copy starts at revision zero.' },
	createdAt: { disposition: 'omit-with-report', reason: 'The destination copy owns its creation metadata.' },
	updatedAt: { disposition: 'omit-with-report', reason: 'The destination copy owns its update metadata.' },
	selection: { disposition: 'omit-with-report', reason: 'Ephemeral selection state is not copied.' },
	loop: { disposition: 'omit-with-report', reason: 'Ephemeral transport loop state is not copied.' },
	view: { disposition: 'omit-with-report', reason: 'UI view state is not copied.' },
	opaqueExtensions: { disposition: 'refuse', reason: 'Unknown opaque authority cannot be converted safely.' },
	featureRequirements: { disposition: 'omit-with-report', reason: 'The destination owner reconciles its own requirements.' },
	subsequences: { disposition: 'materialize-fallback', reason: 'Nested audible occurrences are flattened exactly when representable.' },
	multicameraGroups: { disposition: 'materialize-fallback', reason: 'Active multicamera audible occurrences are flattened exactly when representable.' },
	videoAdjustmentLayers: { disposition: 'omit-with-report', reason: 'Visual-only adjustment layers are omitted.' },
	videoVisualPresets: { disposition: 'omit-with-report', reason: 'Visual-only presets are omitted.' },
	videoMaskMattes: { disposition: 'omit-with-report', reason: 'Visual-only mattes are omitted.' },
	videoFreezeFallbacks: { disposition: 'omit-with-report', reason: 'Visual-only frozen pictures are omitted.' },
	videoColorContexts: { disposition: 'omit-with-report', reason: 'Visual-only colour state is omitted.' },
	videoSourceColorInterpretations: { disposition: 'omit-with-report', reason: 'Visual-only colour interpretation is omitted.' },
	videoVisualPresentations: { disposition: 'omit-with-report', reason: 'Visual-only presentation state is omitted.' },
	videoProcessorStacks: { disposition: 'omit-with-report', reason: 'Visual-only processor stacks are omitted.' },
	videoMotionAnalyses: { disposition: 'omit-with-report', reason: 'Visual-only motion analysis is omitted.' },
	videoFinishingPresets: { disposition: 'omit-with-report', reason: 'Visual-only finishing presets are omitted.' },
	videoCaptionTracks: { disposition: 'omit-with-report', reason: 'Picture caption presentation is omitted.' },
	ofxEffects: { disposition: 'omit-with-report', reason: 'Visual-only OpenFX state is omitted.' },
});
