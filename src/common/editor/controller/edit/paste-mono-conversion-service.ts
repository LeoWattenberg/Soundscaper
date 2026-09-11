/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddSourceCommand } from '../../commands/factories.ts';
import type {
	AudioEditorClipboardTrack,
	AudioEditorCommand,
	CommandObject,
} from '../../commands/protocol.ts';
import {
	findControllerSource,
	type ControllerProject,
	type ControllerSource,
	type ControllerSourceInventory,
	type DerivedSourceRecord,
} from '../track-audio/track-domain-types.ts';
import {
	downmixStereoPasteSource,
	planPasteMonoConversion,
	type PasteMonoConversionPlan,
} from './paste-mono-conversion-policy.ts';

type PasteCommand = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
type SourceAddCommand = Extract<AudioEditorCommand, { readonly type: 'source/add' }>;
type PasteMonoProject = Pick<ControllerProject, 'id' | 'sources' | 'tracks' | 'clips'>;

export interface PasteMonoConfirmationDecision {
	readonly accepted: boolean;
	readonly dontShowAgain: boolean;
}

/** The three existing derived-source operations needed by paste conversion. */
export interface PasteMonoDerivedSourcesPort {
	sourceChannelsForEdit(source: ControllerSource): Promise<Float32Array[]>;
	persistDerivedSource(
		template: ControllerSource,
		channels: Float32Array[],
		name: string,
		idPrefix?: string,
	): Promise<DerivedSourceRecord>;
	rollbackDerivedSources(records: readonly Pick<DerivedSourceRecord, 'source'>[]): Promise<void>;
}

export interface MonoConvertingPasteRequest {
	readonly command: AudioEditorCommand;
	readonly project: PasteMonoProject;
	readonly alwaysConvertToMono: boolean;
	readonly derivedSources: PasteMonoDerivedSourcesPort;
	confirmConversion(
		plan: Readonly<PasteMonoConversionPlan>,
	): PromiseLike<PasteMonoConfirmationDecision> | PasteMonoConfirmationDecision;
	preflightStorage(bytes: number, category: 'effect'): Promise<unknown>;
	updateAlwaysConvertToMono(value: true): PromiseLike<void> | void;
}

export interface MonoConvertingPasteResult {
	readonly command: AudioEditorCommand;
	/**
	 * Persistence ownership transfers to the caller with a successful result.
	 * The caller must roll these records back if committing `command` fails.
	 */
	readonly derivedRecords: readonly DerivedSourceRecord[];
}

export interface CommittedMonoConvertingPasteRequest extends MonoConvertingPasteRequest {
	assertCurrent(): void;
	commit(command: AudioEditorCommand): PromiseLike<unknown> | unknown;
}

interface PlannedMonoConvertingPaste {
	readonly additions: ReadonlyMap<string, CommandObject>;
	readonly paste: PasteCommand;
	readonly plan: Readonly<PasteMonoConversionPlan>;
}

/**
 * Commit a prepared conversion and reclaim its persisted sources on any late failure.
 * Compatible paste commands deliberately retain the editor's synchronous commit path.
 */
export function commitMonoConvertingPasteCommand(
	request: CommittedMonoConvertingPasteRequest,
): PromiseLike<unknown | null> | unknown | null {
	const planned = planMonoConvertingPaste(request);
	if (planned.plan.disposition === 'preserve') {
		request.assertCurrent();
		return request.commit(request.command);
	}
	return commitConversion();

	async function commitConversion(): Promise<unknown | null> {
		const result = await preparePlannedMonoConvertingPasteCommand(request, planned);
		if (!result) return null;
		try {
			request.assertCurrent();
			return await request.commit(result.command);
		} catch (error) {
			return rollbackAfterFailure(request.derivedSources, result.derivedRecords, error);
		}
	}
}

/**
 * Prepare one paste command tree for Audacity-compatible stereo-to-mono transfer.
 *
 * This owns every derived record until it returns successfully. It therefore
 * confirms and preflights before persistence, rolls completed records back on
 * every failure, and publishes their source/add commands in the same batch as
 * the rewritten paste. It never changes the supplied command or project.
 */
export async function prepareMonoConvertingPasteCommand(
	request: MonoConvertingPasteRequest,
): Promise<Readonly<MonoConvertingPasteResult> | null> {
	return preparePlannedMonoConvertingPasteCommand(request, planMonoConvertingPaste(request));
}

async function preparePlannedMonoConvertingPasteCommand(
	request: MonoConvertingPasteRequest,
	planned: PlannedMonoConvertingPaste,
): Promise<Readonly<MonoConvertingPasteResult> | null> {
	const { additions, paste, plan } = planned;
	if (plan.disposition === 'preserve') {
		return Object.freeze({ command: request.command, derivedRecords: Object.freeze([]) });
	}
	if (plan.disposition === 'confirm') {
		const decision = confirmationDecision(await request.confirmConversion(plan));
		if (!decision.accepted) return null;
		if (decision.dontShowAgain) await request.updateAlwaysConvertToMono(true);
	}

	const sourceIds = uniqueConversionSourceIds(plan);
	const sources = sourceIds.map((sourceId) => resolveAudioSource(request.project, additions, sourceId));
	const derivedRecords: DerivedSourceRecord[] = [];
	try {
		await request.preflightStorage(estimatedMonoBytes(sources), 'effect');
		const replacementIds = new Map<string, string>();
		const reservedIds = new Set([
			...request.project.sources.map(({ id }) => id),
			...additions.keys(),
		]);
		for (const source of sources) {
			const channels = await request.derivedSources.sourceChannelsForEdit(source);
			const mono = downmixStereoPasteSource(channels);
			const record = await request.derivedSources.persistDerivedSource(
				source,
				[mono],
				source.name,
				'mono-paste-source',
			);
			derivedRecords.push(record);
			const derivedId = nonEmptyId(record.source?.id, 'derived paste source');
			if (reservedIds.has(derivedId)) {
				throw new RangeError(`Derived paste source ID ${derivedId} collides with another source.`);
			}
			reservedIds.add(derivedId);
			replacementIds.set(source.id, derivedId);
		}

		const rewrittenPaste = rewritePasteSources(paste, plan, replacementIds);
		const referenceTree = rewriteCommandTree(
			request.command,
			paste,
			rewrittenPaste,
			new Set(),
		);
		if (!referenceTree) throw new Error('Mono paste conversion removed the prepared command tree.');
		const stillUsedSourceIds = collectCommandSourceIds(referenceTree);
		const removableSourceIds = new Set(sourceIds.filter((sourceId) => (
			additions.has(sourceId) && !stillUsedSourceIds.has(sourceId)
		)));
		const rewritten = rewriteCommandTree(
			request.command,
			paste,
			rewrittenPaste,
			removableSourceIds,
		);
		if (!rewritten) throw new Error('Mono paste conversion removed the prepared command tree.');
		const commands = [
			...derivedRecords.map(({ source }) => createAddSourceCommand(source)),
			...(rewritten.type === 'batch' ? rewritten.commands : [rewritten]),
		];
		return Object.freeze({
			command: Object.freeze({ type: 'batch', commands: Object.freeze(commands) }),
			derivedRecords: Object.freeze(derivedRecords.slice()),
		});
	} catch (error) {
		return rollbackAfterFailure(request.derivedSources, derivedRecords, error);
	}
}

function planMonoConvertingPaste(request: MonoConvertingPasteRequest): PlannedMonoConvertingPaste {
	const discovered = discoverPasteCommands(request.command);
	if (discovered.pastes.length !== 1) {
		throw new RangeError('A mono-converting paste command tree must contain exactly one clipboard/paste command.');
	}
	const paste = discovered.pastes[0]!;
	const additions = sourceAdditionsById(discovered.sourceAdds);
	const plan = planPasteMonoConversion({
		clipboard: paste.clipboard,
		project: planningProject(request.project),
		transferredSources: [...additions.values()].filter(hasChannelMetadata),
		trackMap: paste.trackMap,
		alwaysConvertToMono: request.alwaysConvertToMono,
	});
	return { additions, paste, plan };
}

function discoverPasteCommands(command: AudioEditorCommand): Readonly<{
	readonly pastes: readonly PasteCommand[];
	readonly sourceAdds: readonly SourceAddCommand[];
}> {
	const pastes: PasteCommand[] = [];
	const sourceAdds: SourceAddCommand[] = [];
	visit(command);
	return { pastes, sourceAdds };

	function visit(candidate: AudioEditorCommand): void {
		if (candidate.type === 'clipboard/paste') pastes.push(candidate);
		if (candidate.type === 'source/add') sourceAdds.push(candidate);
		if (candidate.type === 'batch') candidate.commands.forEach(visit);
	}
}

function sourceAdditionsById(commands: readonly SourceAddCommand[]): ReadonlyMap<string, CommandObject> {
	const result = new Map<string, CommandObject>();
	for (const command of commands) {
		const id = nonEmptyId(command.source.id, 'transferred paste source');
		if (result.has(id)) throw new RangeError(`Transferred paste source ID ${id} is added more than once.`);
		result.set(id, command.source);
	}
	return result;
}

function planningProject(project: PasteMonoProject): PasteMonoProject {
	return {
		...project,
		// Video and image inventory has no PCM channelCount and cannot affect this policy.
		sources: project.sources.filter(hasChannelMetadata),
	};
}

function hasChannelMetadata(value: Readonly<Record<string, unknown>>): boolean {
	return value.channelCount !== undefined;
}

function uniqueConversionSourceIds(plan: Readonly<PasteMonoConversionPlan>): readonly string[] {
	return [...new Set(plan.targets.flatMap(({ stereoSourceIds }) => stereoSourceIds))];
}

function resolveAudioSource(
	project: PasteMonoProject,
	additions: ReadonlyMap<string, CommandObject>,
	sourceId: string,
): ControllerSource {
	const added = additions.get(sourceId);
	const inventory: readonly ControllerSourceInventory[] = added
		? [added as ControllerSourceInventory]
		: project.sources;
	const source = findControllerSource({ sources: inventory }, sourceId);
	if (!source || source.channelCount !== 2) {
		throw new TypeError(`Stereo paste source ${sourceId} has no editable PCM metadata.`);
	}
	return source;
}

function estimatedMonoBytes(sources: readonly ControllerSource[]): number {
	let result = 0;
	for (const source of sources) {
		const bytes = source.frameCount * Float32Array.BYTES_PER_ELEMENT;
		if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(result + bytes)) {
			throw new RangeError('Mono paste storage estimate exceeds the safe integer range.');
		}
		result += bytes;
	}
	return result;
}

function confirmationDecision(value: unknown): PasteMonoConfirmationDecision {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Mono paste confirmation must return a decision object.');
	}
	const decision = value as Readonly<Record<string, unknown>>;
	if (typeof decision.accepted !== 'boolean' || typeof decision.dontShowAgain !== 'boolean') {
		throw new TypeError('Mono paste confirmation decision fields must be boolean.');
	}
	return { accepted: decision.accepted, dontShowAgain: decision.dontShowAgain };
}

/** Retain a transferred root while any sibling command or clipboard carrier still names it. */
function collectCommandSourceIds(command: AudioEditorCommand): ReadonlySet<string> {
	const result = new Set<string>();
	const visited = new WeakSet<object>();
	visit(command);
	return result;

	function visit(value: unknown, key = ''): void {
		if (typeof value === 'string' && key.toLowerCase().endsWith('sourceid')) {
			result.add(value);
			return;
		}
		if (!value || typeof value !== 'object') return;
		if (visited.has(value)) return;
		visited.add(value);
		if (Array.isArray(value)) {
			if (key.toLowerCase().endsWith('sourceids')) {
				value.forEach((candidate) => {
					if (typeof candidate === 'string') result.add(candidate);
				});
			}
			value.forEach((candidate) => { visit(candidate); });
			return;
		}
		for (const [field, candidate] of Object.entries(value)) visit(candidate, field);
	}
}

function rewritePasteSources(
	paste: PasteCommand,
	plan: Readonly<PasteMonoConversionPlan>,
	replacementIds: ReadonlyMap<string, string>,
): PasteCommand {
	const sourcesByTrack = new Map<string, ReadonlySet<string>>();
	for (const target of plan.targets) {
		const current = sourcesByTrack.get(target.sourceTrackId) ?? new Set<string>();
		const combined = new Set(current);
		target.stereoSourceIds.forEach((sourceId) => { combined.add(sourceId); });
		sourcesByTrack.set(target.sourceTrackId, combined);
	}
	const tracks = paste.clipboard.tracks.map((track) => rewriteClipboardTrack(
		track,
		sourcesByTrack.get(track.sourceTrackId),
		replacementIds,
	));
	return Object.freeze({
		...paste,
		clipboard: Object.freeze({ ...paste.clipboard, tracks: Object.freeze(tracks) }),
	});
}

function rewriteClipboardTrack(
	track: AudioEditorClipboardTrack,
	affectedSourceIds: ReadonlySet<string> | undefined,
	replacementIds: ReadonlyMap<string, string>,
): AudioEditorClipboardTrack {
	if (!affectedSourceIds?.size) return track;
	let changed = false;
	const clips = track.clips.map((clip) => {
		const sourceId = typeof clip.sourceId === 'string' ? clip.sourceId : '';
		if (!affectedSourceIds.has(sourceId)) return clip;
		const replacementId = replacementIds.get(sourceId);
		if (!replacementId) throw new ReferenceError(`Mono paste source ${sourceId} has no derived replacement.`);
		changed = true;
		return Object.freeze({ ...clip, sourceId: replacementId });
	});
	return changed ? Object.freeze({ ...track, clips: Object.freeze(clips) }) : track;
}

function rewriteCommandTree(
	command: AudioEditorCommand,
	paste: PasteCommand,
	rewrittenPaste: PasteCommand,
	removableSourceIds: ReadonlySet<string>,
): AudioEditorCommand | null {
	if (command === paste) return rewrittenPaste;
	if (command.type === 'source/add'
		&& removableSourceIds.has(nonEmptyId(command.source.id, 'transferred paste source'))) return null;
	if (command.type !== 'batch') return command;
	const commands = command.commands.flatMap((child) => {
		const rewritten = rewriteCommandTree(child, paste, rewrittenPaste, removableSourceIds);
		return rewritten ? [rewritten] : [];
	});
	return commands.length
		? Object.freeze({ type: 'batch', commands: Object.freeze(commands) })
		: null;
}

async function rollbackAfterFailure(
	derivedSources: PasteMonoDerivedSourcesPort,
	records: readonly DerivedSourceRecord[],
	error: unknown,
): Promise<never> {
	if (!records.length) throw error;
	try {
		await derivedSources.rollbackDerivedSources(records);
	} catch (rollbackError) {
		throw new AggregateError(
			[error, rollbackError],
			'Mono paste conversion and derived-source rollback both failed.',
			{ cause: rollbackError },
		);
	}
	throw error;
}

function nonEmptyId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${label} ID must be a non-empty string.`);
	return value;
}
