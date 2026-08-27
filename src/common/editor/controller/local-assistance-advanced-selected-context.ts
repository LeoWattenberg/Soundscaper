/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selection-bound transcript context and primitive visual routing for Advanced workflows. */

import {
	ASSISTANCE_OPERATIONS,
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import {
	ASSISTANCE_EDITORIAL_GENERATION_MAXIMUM_OUTPUT_BYTES,
} from '../assistance/editorial-generation-v1.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	prepareLocalAssistanceGuidedEditorialContext,
	prepareLocalAssistanceGuidedTranscriptInput,
} from './local-assistance-guided-transcript-context.ts';
import { enumValue, exactRecord, id, text } from './local-assistance-prepared-media.ts';

const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const MEDIA_KINDS = Object.freeze([
	'audio', 'video', 'frame-pack', 'transcript', 'text', 'editorial-context',
] as const);

interface AdvancedInventorySource {
	readonly sourceId: string;
	readonly label: string;
	readonly mediaKind: typeof MEDIA_KINDS[number];
	readonly operations: readonly AssistanceOperation[];
}

interface AdvancedInventory {
	readonly sources: readonly AdvancedInventorySource[];
}

interface SelectedPreparationPort {
	listSelectedMedia(): Promise<unknown>;
	prepareSelectedMedia(request: Readonly<{
		sourceId: string;
		operation: AssistanceOperation;
		shotDetectionMode?: 'fast' | 'accurate';
		inputRole?: 'video' | 'frame-pack';
		signal?: AbortSignal;
	}>): Promise<unknown>;
	readonly [key: string]: unknown;
}

export interface LocalAssistanceAdvancedSelectedContextDependencies {
	readonly getProject: () => unknown;
	readonly selectionFenceForSource: (sourceId: string) => unknown;
	readonly loadTranscriptBody?: (
		storageKey: string,
		signal: AbortSignal,
	) => PromiseLike<unknown> | unknown;
	readonly selected: SelectedPreparationPort;
}

/** A typed refusal used when a previously listed transcript disappears before staging. */
export class LocalAssistanceAdvancedContextUnavailableError extends Error {
	constructor() {
		super('The selected Advanced operation no longer has its required local context.');
		this.name = 'LocalAssistanceAdvancedContextUnavailableError';
	}
}

/**
 * Enrich selected-media inventory only after required project-local context is authenticated.
 * The wrapper also composes that context into the exact primitive operation input contract.
 */
export function createLocalAssistanceAdvancedSelectedContextPreparation<
	Selected extends SelectedPreparationPort,
>(
	dependencies: LocalAssistanceAdvancedSelectedContextDependencies & Readonly<{ selected: Selected }>,
): Readonly<Selected> {
	assertDependencies(dependencies);

	async function listSelectedMedia(): Promise<AdvancedInventory> {
		const inventory = normalizeInventory(
			await dependencies.selected.listSelectedMedia(),
		);
		const contexts = new Map<string, Exclude<Awaited<ReturnType<typeof readContext>>, null>>();
		await Promise.all(inventory.sources.map(async ({ sourceId }) => {
			let context: Awaited<ReturnType<typeof readContext>>;
			try { context = await readContext(inventory, sourceId, new AbortController().signal); }
			catch (error) {
				if (error instanceof LocalAssistanceAdvancedContextUnavailableError) return;
				throw error;
			}
			if (context !== null) contexts.set(sourceId, context);
		}));
		return Object.freeze({ sources: Object.freeze(inventory.sources.map((source) => {
			const admitted = new Set(source.operations);
			admitted.delete('word-alignment');
			admitted.delete('text-embedding');
			admitted.delete('editorial-generation');
			const context = contexts.get(source.sourceId) ?? null;
			if (context !== null) {
				if (context.transcript !== null) {
					admitted.add('text-embedding');
					if (source.mediaKind === 'audio'
						&& source.operations.includes('word-alignment')) admitted.add('word-alignment');
				}
				if (context.editorial !== null) admitted.add('editorial-generation');
			}
			return Object.freeze({ ...source,
				operations: Object.freeze(ASSISTANCE_OPERATIONS.filter((operation) => admitted.has(operation))),
			});
		})) });
	}

	async function prepareSelectedMedia(
		request: Parameters<Selected['prepareSelectedMedia']>[0],
	): Promise<unknown> {
		if (!request || typeof request !== 'object') {
			throw new TypeError('Advanced context preparation requires one selected-media request.');
		}
		if (request.operation !== 'word-alignment' && request.operation !== 'text-embedding'
			&& request.operation !== 'editorial-generation') {
			return dependencies.selected.prepareSelectedMedia(request);
		}
		const signal = request.signal ?? new AbortController().signal;
		if (!(signal instanceof AbortSignal)) {
			throw new TypeError('Advanced context preparation requires a valid cancellation signal.');
		}
		signal.throwIfAborted();
		const inventory = normalizeInventory(
			await dependencies.selected.listSelectedMedia(),
		);
		const context = await readContext(inventory, request.sourceId, signal);
		if (context === null) {
			throw new LocalAssistanceAdvancedContextUnavailableError();
		}
		if (request.operation === 'word-alignment') {
			if (context.transcript === null) throw new LocalAssistanceAdvancedContextUnavailableError();
			const base = dataRecord(await dependencies.selected.prepareSelectedMedia(request),
				'Advanced alignment audio preparation');
			if (!Array.isArray(base.inputs)
				|| base.inputs.some((input) => dataRecord(input, 'Advanced alignment input').role === 'transcript')) {
				throw new TypeError('Advanced alignment requires one uncomposed selected-audio preparation.');
			}
			return Object.freeze({ ...base, inputs: Object.freeze([...base.inputs, Object.freeze({
				role: 'transcript' as const, mediaType: context.transcript.mediaType,
				bytes: context.transcript.bytes,
			})]) });
		}
		const input = request.operation === 'text-embedding' ? context.transcript : context.editorial;
		if (input === null) throw new LocalAssistanceAdvancedContextUnavailableError();
		return Object.freeze({ sourceId: request.sourceId, operation: request.operation,
			selectionFence: context.fence,
			inputs: Object.freeze([Object.freeze({ role: request.operation === 'text-embedding'
				? 'transcript' as const : 'editorial-context' as const,
			mediaType: input.mediaType, bytes: input.bytes })]),
			outputs: Object.freeze([Object.freeze(request.operation === 'text-embedding'
				? { role: 'embeddings' as const,
					mediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
					maximumByteLength: MAXIMUM_OUTPUT_BYTES }
				: { role: 'editorial-proposal' as const,
					mediaType: 'application/vnd.soundscaper.editorial-proposal+json',
					maximumByteLength: ASSISTANCE_EDITORIAL_GENERATION_MAXIMUM_OUTPUT_BYTES })]),
		});
	}

	async function readContext(
		inventory: AdvancedInventory,
		sourceId: string,
		signal: AbortSignal,
	): Promise<Readonly<{
		sourceId: string;
		fence: AssistanceSelectionFence;
		transcript: Awaited<ReturnType<typeof prepareLocalAssistanceGuidedTranscriptInput>>;
		editorial: Awaited<ReturnType<typeof prepareLocalAssistanceGuidedEditorialContext>>;
	}> | null> {
		if (!dependencies.loadTranscriptBody) return null;
		let fence: AssistanceSelectionFence;
		try { fence = validateAssistanceSelectionFence(dependencies.selectionFenceForSource(sourceId)); }
		catch { return null; }
		if (fence.sourceId !== sourceId) return null;
		if (inventory.sources.filter(({ sourceId }) => sourceId === fence.sourceId).length !== 1) return null;
		const project = dataRecord(dependencies.getProject(), 'Advanced selected project');
		const options = Object.freeze({ project, inventory: inventory.sources, fence,
			loadTranscriptBody: dependencies.loadTranscriptBody, signal });
		const [transcript, editorial] = await Promise.all([
			prepareLocalAssistanceGuidedTranscriptInput(options),
			prepareLocalAssistanceGuidedEditorialContext(options),
		]);
		if (transcript === null && editorial === null) return null;
		return Object.freeze({ sourceId: fence.sourceId, fence, transcript, editorial });
	}

	return Object.freeze({ ...dependencies.selected, listSelectedMedia, prepareSelectedMedia }) as
		Readonly<Selected>;
}

function assertDependencies(
	value: LocalAssistanceAdvancedSelectedContextDependencies,
): void {
	if (!value || typeof value !== 'object' || typeof value.getProject !== 'function'
		|| typeof value.selectionFenceForSource !== 'function'
		|| (value.loadTranscriptBody !== undefined && typeof value.loadTranscriptBody !== 'function')
		|| !value.selected || typeof value.selected.listSelectedMedia !== 'function'
		|| typeof value.selected.prepareSelectedMedia !== 'function') {
		throw new TypeError('Advanced context preparation requires exact project and selected-media ports.');
	}
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function normalizeInventory(value: unknown): AdvancedInventory {
	const root = exactRecord(value, ['sources'], 'Advanced selected-media inventory');
	if (!Array.isArray(root.sources) || root.sources.length > 128) {
		throw new TypeError('The Advanced selected-media source inventory is invalid.');
	}
	const seen = new Set<string>();
	const sources = root.sources.map((value) => {
		const source = exactRecord(value, ['sourceId', 'label', 'mediaKind', 'operations'],
			'Advanced selected-media source');
		const sourceId = id(source.sourceId);
		if (seen.has(sourceId)) throw new TypeError('An Advanced selected-media source is repeated.');
		seen.add(sourceId);
		if (!Array.isArray(source.operations) || source.operations.length < 1
			|| source.operations.length > ASSISTANCE_OPERATIONS.length) {
			throw new TypeError('An Advanced selected-media operation inventory is invalid.');
		}
		const operations = Object.freeze(source.operations.map(normalizeAssistanceOperation));
		if (new Set(operations).size !== operations.length) {
			throw new TypeError('An Advanced selected-media source repeats an operation.');
		}
		return Object.freeze({ sourceId, label: text(source.label, 160, 'source label'),
			mediaKind: enumValue(source.mediaKind, MEDIA_KINDS, 'media kind'), operations });
	});
	return Object.freeze({ sources: Object.freeze(sources) });
}
