/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	commitAudioTrackFreezeCandidateV21,
	installAudioTrackFreezeCandidateV21,
	removeAudioTrackFreezeCandidateV21,
} from './audio-track-freeze-lifecycle-v21.ts';
import {
	AUDIO_TRACK_FREEZE_CAPTURE_POSITION_V1,
	computeAudioTrackFreezeDigestsV1,
	normalizeAudioTrackFreezeV1,
	type AudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from './audio-track-freeze-v21.ts';
import type { AudioProductionCommandPayloads } from './commands/audio-production.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type Awaitable<Value> = Value | Promise<Value>;

export type AudioTrackFreezeCoordinatorCommandV21 =
	| (Readonly<{ type: 'audio-freeze/install' }> & AudioProductionCommandPayloads['audio-freeze/install'])
	| (Readonly<{ type: 'audio-freeze/remove' }> & AudioProductionCommandPayloads['audio-freeze/remove'])
	| (Readonly<{ type: 'audio-freeze/commit' }> & AudioProductionCommandPayloads['audio-freeze/commit']);

export interface AudioTrackFreezeControllerCaptureV21<Project, Ticket> {
	readonly project: Project;
	readonly ticket: Ticket;
}

/**
 * The controller port owns writability/capability/lock admission and the final
 * exact-state CAS. A rejected executeIfCurrent must mean no command installed.
 */
export interface AudioTrackFreezeControllerPortV21<Project, Ticket> {
	readonly capture: (request: Readonly<{
		readonly trackId: string;
		readonly signal?: AbortSignal;
	}>) => Awaitable<AudioTrackFreezeControllerCaptureV21<Project, Ticket>>;
	readonly assertCurrent: (ticket: Ticket) => void;
	readonly executeIfCurrent: (
		ticket: Ticket,
		command: AudioTrackFreezeCoordinatorCommandV21,
		options: Readonly<{ readonly signal?: AbortSignal }>,
	) => Awaitable<Project>;
}

export interface AudioTrackFreezeRenderResultV21<Body> {
	readonly body: Body;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly channelCount: number;
}

export interface AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage extends object> {
	readonly controller: AudioTrackFreezeControllerPortV21<Project, Ticket>;
	readonly planRenderRange?: (request: Readonly<{
		readonly project: Project;
		readonly trackId: string;
	}>) => Readonly<{ readonly renderStartFrame: number; readonly renderFrameCount: number }>;
	readonly allocateDerivedSourceId: (request: Readonly<{
		readonly project: Project;
		readonly trackId: string;
		readonly expectedFreeze: AudioTrackFreezeV1 | null;
	}>) => string;
	/** Hashes one exact persisted source generation; it must honor the task signal. */
	readonly hashSourceContent: (request: Readonly<{
		readonly project: Project;
		readonly trackId: string;
		readonly source: DataRecord;
		readonly signal?: AbortSignal;
	}>) => Promise<string>;
	readonly render: (request: Readonly<{
		readonly project: Project;
		readonly trackId: string;
		readonly renderStartFrame: number;
		readonly renderFrameCount: number;
		readonly sampleRate: number;
		readonly digests: AudioTrackFreezeDigestsV1;
		readonly signal?: AbortSignal;
	}>) => Promise<AudioTrackFreezeRenderResultV21<Body>>;
	readonly hashRenderedBody: (request: Readonly<{
		readonly body: Body;
		readonly signal?: AbortSignal;
	}>) => Promise<string>;
	readonly stageDerivedSource: (request: Readonly<{
		readonly sourceId: string;
		readonly contentSha256: string;
		readonly frameCount: number;
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly body: Body;
		readonly signal?: AbortSignal;
	}>) => Promise<Stage>;
	readonly verifyStagedSource: (request: Readonly<{
		readonly stage: Stage;
		readonly sourceId: string;
		readonly contentSha256: string;
		readonly signal?: AbortSignal;
	}>) => Promise<unknown>;
	/** Register verified transient playback authority before the synchronous command publication. */
	readonly admitVerifiedFreeze?: (request: Readonly<{
		readonly project: Project;
		readonly trackId: string;
		readonly freeze: AudioTrackFreezeV1;
		readonly derivedSource: DataRecord;
		readonly sourceContentIdentities: readonly Readonly<{
			readonly sourceId: string;
			readonly contentSha256: string;
		}>[];
	}>) => void;
	/** Publish is reversible until executeIfCurrent succeeds. */
	readonly publishStagedSource: (request: Readonly<{
		readonly stage: Stage;
		readonly signal?: AbortSignal;
	}>) => Promise<void>;
	/** Cleanup is deliberately uncancelled and must affect only this operation. */
	readonly rollbackStagedSource: (request: Readonly<{ readonly stage: Stage }>) => Promise<void>;
}

export interface FreezeAudioTrackRequestV21 {
	readonly trackId: string;
	readonly renderStartFrame?: number;
	readonly renderFrameCount?: number;
	readonly signal?: AbortSignal;
}

export interface UnfreezeAudioTrackRequestV21 {
	readonly trackId: string;
	readonly signal?: AbortSignal;
}

export interface CommitAudioTrackFreezeRequestV21 {
	readonly trackId: string;
	readonly derivedClip: unknown;
	readonly signal?: AbortSignal;
}

export interface AudioTrackFreezeCoordinatorV21<Project> {
	readonly freeze: (request: FreezeAudioTrackRequestV21) => Promise<Readonly<{
		readonly mode: 'install' | 'refresh';
		readonly project: Project;
		readonly freeze: AudioTrackFreezeV1;
	}>>;
	readonly unfreeze: (request: UnfreezeAudioTrackRequestV21) => Promise<Readonly<{
		readonly project: Project;
		readonly removedFreeze: AudioTrackFreezeV1;
	}>>;
	readonly commit: (request: CommitAudioTrackFreezeRequestV21) => Promise<Readonly<{
		readonly project: Project;
		readonly committedFreeze: AudioTrackFreezeV1;
	}>>;
}

/**
 * Coordinate transient render bytes and durable staging around the exact V21
 * command boundary. No rendered body is ever placed in a document command.
 */
export function createAudioTrackFreezeCoordinatorV21<
	Project extends object,
	Ticket,
	Body,
	Stage extends object,
>(
	portsValue: AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage>,
): Readonly<AudioTrackFreezeCoordinatorV21<Project>> {
	const ports = assertPorts(portsValue);
	return Object.freeze({
		freeze: async (request: FreezeAudioTrackRequestV21) => freeze(ports, request),
		unfreeze: async (request: UnfreezeAudioTrackRequestV21) => unfreeze(ports, request),
		commit: async (request: CommitAudioTrackFreezeRequestV21) => commit(ports, request),
	});
}

async function freeze<Project extends object, Ticket, Body, Stage extends object>(
	ports: AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage>,
	request: FreezeAudioTrackRequestV21,
): Promise<Readonly<{
	readonly mode: 'install' | 'refresh';
	readonly project: Project;
	readonly freeze: AudioTrackFreezeV1;
}>> {
	const trackId = stableId(request.trackId, 'audio freeze track');
	const signal = optionalSignal(request.signal);
	const capture = await ports.controller.capture({ trackId, ...signalOption(signal) });
	guardCurrent(ports.controller, capture.ticket, signal);
	const project = dataRecord(capture.project, 'captured audio freeze project');
	const track = exactTrack(project, trackId);
	const expectedFreeze = Object.hasOwn(track, 'audioFreeze')
		? normalizeAudioTrackFreezeV1(track.audioFreeze)
		: null;
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const plannedRange = request.renderStartFrame === undefined && request.renderFrameCount === undefined
		? ports.planRenderRange?.({ project: capture.project, trackId })
		: request;
	if (!plannedRange) throw new TypeError('The audio freeze render range or planner is required.');
	if ((request.renderStartFrame === undefined) !== (request.renderFrameCount === undefined)) {
		throw new TypeError('The audio freeze render range must provide both frame fields.');
	}
	const renderStartFrame = nonNegativeSafeInteger(plannedRange.renderStartFrame, 'freeze renderStartFrame');
	const renderFrameCount = positiveSafeInteger(plannedRange.renderFrameCount, 'freeze renderFrameCount');
	if (!Number.isSafeInteger(renderStartFrame + renderFrameCount)) {
		throw new RangeError('The audio freeze render range must end at a safe integer.');
	}
	const identities = await sourceContentIdentities(
		ports, capture, track, trackId, signal,
	);
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate, renderStartFrame, renderFrameCount, track,
		clips: dataArray(project.clips, 'project.clips'),
		sourceContentIdentities: identities,
		automationLanes: dataArray(project.automationLanes, 'project.automationLanes'),
		tempoMap: project.tempoMap ?? null,
	});
	const derivedSourceId = stableId(ports.allocateDerivedSourceId({
		project: capture.project, trackId, expectedFreeze,
	}), 'derived source');
	const replacementFreeze = normalizeAudioTrackFreezeV1({
		schemaVersion: 1,
		derivedSourceId,
		...digests,
		renderStartFrame,
		renderFrameCount,
		capturePosition: AUDIO_TRACK_FREEZE_CAPTURE_POSITION_V1,
	});
	let stage: Stage | null = null;
	let installed = false;
	try {
		const rendered = await ports.render({
			project: capture.project, trackId, renderStartFrame, renderFrameCount,
			sampleRate, digests, ...signalOption(signal),
		});
		guardCurrent(ports.controller, capture.ticket, signal);
		const channelCount = validateRenderedGeometry(rendered, renderFrameCount, sampleRate);
		const contentSha256 = digest(await ports.hashRenderedBody({
			body: rendered.body, ...signalOption(signal),
		}), 'rendered freeze body');
		guardCurrent(ports.controller, capture.ticket, signal);
		stage = await ports.stageDerivedSource({
			sourceId: derivedSourceId, contentSha256, frameCount: renderFrameCount,
			sampleRate, channelCount, body: rendered.body, ...signalOption(signal),
		});
		guardCurrent(ports.controller, capture.ticket, signal);
		const derivedSource = dataRecord(await ports.verifyStagedSource({
			stage, sourceId: derivedSourceId, contentSha256, ...signalOption(signal),
		}), 'verified freeze derived source');
		guardCurrent(ports.controller, capture.ticket, signal);
		installAudioTrackFreezeCandidateV21(project, {
			trackId, expectedFreeze, replacementFreeze, derivedSource,
			sourceContentIdentities: identities,
		});
		ports.admitVerifiedFreeze?.({
			project: capture.project,
			trackId,
			freeze: replacementFreeze,
			derivedSource,
			sourceContentIdentities: identities,
		});
		await ports.publishStagedSource({ stage, ...signalOption(signal) });
		guardCurrent(ports.controller, capture.ticket, signal);
		const command = Object.freeze({
			type: 'audio-freeze/install' as const,
			trackId, expectedFreeze, replacementFreeze, derivedSource,
			sourceContentIdentities: identities,
		});
		const next = await ports.controller.executeIfCurrent(
			capture.ticket, command, signalOption(signal),
		);
		installed = true;
		return Object.freeze({
			mode: expectedFreeze === null ? 'install' as const : 'refresh' as const,
			project: next,
			freeze: replacementFreeze,
		});
	} catch (error) {
		if (stage !== null && !installed) await rollbackOrAggregate(ports, stage, error);
		throw error;
	}
}

async function unfreeze<Project extends object, Ticket, Body, Stage extends object>(
	ports: AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage>,
	request: UnfreezeAudioTrackRequestV21,
): Promise<Readonly<{ readonly project: Project; readonly removedFreeze: AudioTrackFreezeV1 }>> {
	const trackId = stableId(request.trackId, 'audio unfreeze track');
	const signal = optionalSignal(request.signal);
	const capture = await ports.controller.capture({ trackId, ...signalOption(signal) });
	guardCurrent(ports.controller, capture.ticket, signal);
	const project = dataRecord(capture.project, 'captured audio unfreeze project');
	const track = exactTrack(project, trackId);
	if (!Object.hasOwn(track, 'audioFreeze')) throw new RangeError(`Audio track ${trackId} is not frozen.`);
	const expectedFreeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
	removeAudioTrackFreezeCandidateV21(project, { trackId, expectedFreeze });
	const command = Object.freeze({ type: 'audio-freeze/remove' as const, trackId, expectedFreeze });
	throwIfAborted(signal);
	const next = await ports.controller.executeIfCurrent(capture.ticket, command, signalOption(signal));
	return Object.freeze({ project: next, removedFreeze: expectedFreeze });
}

async function commit<Project extends object, Ticket, Body, Stage extends object>(
	ports: AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage>,
	request: CommitAudioTrackFreezeRequestV21,
): Promise<Readonly<{ readonly project: Project; readonly committedFreeze: AudioTrackFreezeV1 }>> {
	const trackId = stableId(request.trackId, 'audio freeze commit track');
	const signal = optionalSignal(request.signal);
	const capture = await ports.controller.capture({ trackId, ...signalOption(signal) });
	guardCurrent(ports.controller, capture.ticket, signal);
	const project = dataRecord(capture.project, 'captured audio freeze commit project');
	const track = exactTrack(project, trackId);
	if (!Object.hasOwn(track, 'audioFreeze')) throw new RangeError(`Audio track ${trackId} is not frozen.`);
	const expectedFreeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const identities = await sourceContentIdentities(ports, capture, track, trackId, signal);
	const operationDigests = computeAudioTrackFreezeDigestsV1({
		sampleRate,
		renderStartFrame: expectedFreeze.renderStartFrame,
		renderFrameCount: expectedFreeze.renderFrameCount,
		track,
		clips: dataArray(project.clips, 'project.clips'),
		sourceContentIdentities: identities,
		automationLanes: dataArray(project.automationLanes, 'project.automationLanes'),
		tempoMap: project.tempoMap ?? null,
	});
	const derivedSource = exactSource(project, expectedFreeze.derivedSourceId);
	const derivedSourceContentSha256 = digest(await ports.hashSourceContent({
		project: capture.project, trackId, source: derivedSource, ...signalOption(signal),
	}), 'derived source body');
	guardCurrent(ports.controller, capture.ticket, signal);
	if (derivedSource.contentSha256 !== derivedSourceContentSha256) {
		throw new Error('The persisted freeze body no longer matches its source descriptor.');
	}
	const candidate = {
		trackId, expectedFreeze, operationDigests, derivedSourceContentSha256,
		derivedClip: dataRecord(request.derivedClip, 'committed freeze clip'),
	};
	commitAudioTrackFreezeCandidateV21(project, candidate);
	const command = Object.freeze({ type: 'audio-freeze/commit' as const, ...candidate });
	throwIfAborted(signal);
	const next = await ports.controller.executeIfCurrent(capture.ticket, command, signalOption(signal));
	return Object.freeze({ project: next, committedFreeze: expectedFreeze });
}

async function sourceContentIdentities<Project extends object, Ticket, Body, Stage extends object>(
	ports: AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage>,
	capture: AudioTrackFreezeControllerCaptureV21<Project, Ticket>,
	track: DataRecord,
	trackId: string,
	signal: AbortSignal | undefined,
): Promise<readonly Readonly<{ sourceId: string; contentSha256: string }>[]> {
	const project = dataRecord(capture.project, 'captured audio freeze project');
	const clips = dataArray(project.clips, 'project.clips');
	const clipIds = stringArray(track.clipIds, `audio track ${trackId}.clipIds`, 1);
	const sources: DataRecord[] = [];
	const seen = new Set<string>();
	for (const clipId of clipIds) {
		const clip = exactRecordById(clips, clipId, 'project clip');
		const sourceId = stableId(clip.sourceId, `project clip ${clipId} source`);
		if (seen.has(sourceId)) continue;
		seen.add(sourceId);
		sources.push(exactSource(project, sourceId));
	}
	const identities: Readonly<{ sourceId: string; contentSha256: string }>[] = [];
	for (const source of sources) {
		const sourceId = stableId(source.id, 'audio source');
		const contentSha256 = digest(await ports.hashSourceContent({
			project: capture.project, trackId, source, ...signalOption(signal),
		}), `audio source ${sourceId}`);
		guardCurrent(ports.controller, capture.ticket, signal);
		if (Object.hasOwn(source, 'contentSha256') && source.contentSha256 !== contentSha256) {
			throw new Error(`Audio source ${sourceId} content changed from its descriptor.`);
		}
		identities.push(Object.freeze({ sourceId, contentSha256 }));
	}
	return Object.freeze(identities);
}

async function rollbackOrAggregate<Project, Ticket, Body, Stage extends object>(
	ports: AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage>,
	stage: Stage,
	primary: unknown,
): Promise<void> {
	try {
		await ports.rollbackStagedSource({ stage });
	} catch (cleanup) {
		throw new AggregateError(
			[primary, cleanup],
			'Audio freeze operation and determinate staging rollback both failed.',
			{ cause: primary },
		);
	}
}

function assertPorts<Project, Ticket, Body, Stage extends object>(
	value: AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage>,
): AudioTrackFreezeCoordinatorPortsV21<Project, Ticket, Body, Stage> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Audio freeze coordinator ports must be an object.');
	}
	const functions = [
		'allocateDerivedSourceId', 'hashSourceContent', 'render', 'hashRenderedBody',
		'stageDerivedSource', 'verifyStagedSource', 'publishStagedSource', 'rollbackStagedSource',
	] as const;
	for (const name of functions) {
		if (typeof value[name] !== 'function') throw new TypeError(`Audio freeze coordinator ${name} port is required.`);
	}
	if (value.admitVerifiedFreeze !== undefined && typeof value.admitVerifiedFreeze !== 'function') {
		throw new TypeError('Audio freeze coordinator admitVerifiedFreeze port must be a function.');
	}
	if (value.planRenderRange !== undefined && typeof value.planRenderRange !== 'function') {
		throw new TypeError('Audio freeze coordinator planRenderRange port must be a function.');
	}
	if (!value.controller || typeof value.controller !== 'object') {
		throw new TypeError('Audio freeze coordinator controller port is required.');
	}
	for (const name of ['capture', 'assertCurrent', 'executeIfCurrent'] as const) {
		if (typeof value.controller[name] !== 'function') {
			throw new TypeError(`Audio freeze coordinator controller.${name} port is required.`);
		}
	}
	return value;
}

function guardCurrent<Ticket>(
	controller: AudioTrackFreezeControllerPortV21<unknown, Ticket>,
	ticket: Ticket,
	signal: AbortSignal | undefined,
): void {
	throwIfAborted(signal);
	controller.assertCurrent(ticket);
}

function validateRenderedGeometry<Body>(
	value: AudioTrackFreezeRenderResultV21<Body>,
	frameCount: number,
	sampleRate: number,
): number {
	if (!value || typeof value !== 'object') throw new TypeError('Audio freeze renderer returned no result.');
	if (value.frameCount !== frameCount || value.sampleRate !== sampleRate) {
		throw new RangeError('Audio freeze render geometry changed from the admitted range.');
	}
	return positiveSafeInteger(value.channelCount, 'audio freeze render channelCount');
}

function exactTrack(project: DataRecord, trackId: string): DataRecord {
	const track = exactRecordById(dataArray(project.tracks, 'project.tracks'), trackId, 'project track');
	if (track.type !== 'audio') throw new RangeError(`Track ${trackId} is not audio.`);
	return track;
}

function exactSource(project: DataRecord, sourceId: string): DataRecord {
	return exactRecordById(dataArray(project.sources, 'project.sources'), sourceId, 'project source');
}

function exactRecordById(values: readonly unknown[], id: string, name: string): DataRecord {
	const matches = values.map((candidate, index) => dataRecord(candidate, `${name} ${String(index)}`))
		.filter((candidate) => candidate.id === id);
	if (matches.length !== 1) throw new ReferenceError(`${name} ${id} must exist exactly once.`);
	return matches[0]!;
}

function dataArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function stringArray(value: unknown, name: string, minimum: number): readonly string[] {
	if (!Array.isArray(value) || value.length < minimum) throw new RangeError(`${name} is incomplete.`);
	return value.map((candidate, index) => stableId(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function optionalSignal(value: AbortSignal | undefined): AbortSignal | undefined {
	if (value !== undefined && !(value instanceof AbortSignal)) {
		throw new TypeError('Audio freeze operation signal must be an AbortSignal.');
	}
	return value;
}

function signalOption(signal: AbortSignal | undefined): Readonly<{ signal?: AbortSignal }> {
	return signal ? { signal } : {};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The audio freeze operation was aborted.', 'AbortError');
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a nonnegative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
