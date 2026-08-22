/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import type { ProjectDocument, ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import {
	createFramescaperCandidateAuthoringActionSubsetRuntime,
	type FramescaperCandidateAuthoringActionRuntime,
	type FramescaperCandidateAuthoringSurface,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	createFramescaperProjectHistoryV22,
	executeFramescaperProjectCommandV22,
	redoFramescaperProjectCommandV22,
	undoFramescaperProjectCommandV22,
} from './editor-project-v22-history.ts';
import {
	createFramescaperProjectHistoryV24,
	executeFramescaperProjectCommandV24,
	redoFramescaperProjectCommandV24,
	undoFramescaperProjectCommandV24,
} from './editor-project-v24-history.ts';
import {
	createFramescaperProjectHistoryV25,
	executeFramescaperProjectCommandV25,
	redoFramescaperProjectCommandV25,
	undoFramescaperProjectCommandV25,
} from './editor-project-v25-history.ts';
import {
	createFramescaperProjectHistoryV26,
	executeFramescaperProjectCommandV26,
	redoFramescaperProjectCommandV26,
	undoFramescaperProjectCommandV26,
} from './editor-project-v26-history.ts';
import type { FramescaperProjectV22 } from './editor-project-v22.ts';
import type { FramescaperProjectV24 } from './editor-project-v24.ts';
import type { FramescaperProjectV25 } from './editor-project-v25.ts';
import type { FramescaperProjectV26 } from './editor-project-v26.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;
export type FramescaperDormantAuthoringGeneration = 22 | 24 | 25 | 26;
type CandidateProject = FramescaperProjectV22 | FramescaperProjectV24
	| FramescaperProjectV25 | FramescaperProjectV26;
type CandidateHistory = Readonly<{
	present: CandidateProject;
	undoStack: readonly unknown[];
	redoStack: readonly unknown[];
}>;

const TRANSITION_SURFACES = Object.freeze([
	'video-transition', 'video-transition-dissolve',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);
const VISUAL_SURFACES = Object.freeze([
	...TRANSITION_SURFACES,
	'video-still', 'video-title', 'video-shape', 'video-solid',
	'video-external-generator', 'video-adjustment-layer', 'video-mask-matte', 'video-freeze',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);
const MAXIMUM_AUTHORING_COMMANDS = 4_096;

export interface FramescaperDormantAuthoringPort {
	open(
		surface: FramescaperCandidateAuthoringSurface,
		project: CandidateProject,
	): Awaitable<unknown | null | undefined>;
}

export interface FramescaperDormantCandidateAuthoringController {
	readonly runtime: FramescaperCandidateAuthoringActionRuntime;
	undo(): Promise<boolean>;
	redo(): Promise<boolean>;
}

export function createFramescaperDormantCandidateAuthoringController(options: Readonly<{
	readonly generation: FramescaperDormantAuthoringGeneration;
	readonly profile: unknown;
	readonly repository: ProjectRepositoryPort;
	readonly project: CandidateProject;
	readonly port: FramescaperDormantAuthoringPort;
	readonly now?: () => Date | string;
}>): FramescaperDormantCandidateAuthoringController {
	assertOptions(options);
	const surfaces = options.generation === 22 ? TRANSITION_SURFACES : VISUAL_SURFACES;
	let history = createHistory(options.generation, options.profile, options.project);
	let tail = Promise.resolve();
	const serialized = <Value>(operation: () => Promise<Value>): Promise<Value> => {
		const result = tail.then(operation, operation);
		tail = result.then(() => undefined, () => undefined);
		return result;
	};
	const synchronize = async (): Promise<void> => {
		const loaded = await options.repository.load(String(history.present.id));
		if (loaded === null || Number(loaded.schemaVersion) !== options.generation) {
			throw new Error(`The dormant V${String(options.generation)} authoring project is unavailable.`);
		}
		if (serializeScapeProjectDocument(loaded) !== serializeScapeProjectDocument(history.present)) {
			history = createHistory(
				options.generation, options.profile, loaded as unknown as CandidateProject,
			);
		}
	};
	const persist = async (next: CandidateHistory): Promise<void> => {
		const expected = history.present;
		const saved = await options.repository.saveIfCurrent!(
			expected as unknown as ProjectDocument,
			next.present as unknown as ProjectDocument,
		);
		if (saved === null) throw new Error('The candidate project changed before authoring commit.');
		if (serializeScapeProjectDocument(saved) !== serializeScapeProjectDocument(next.present)) {
			throw new Error('The candidate repository changed the validated authoring result.');
		}
		history = next;
	};
	const actions = Object.fromEntries(surfaces.map((surface) => [surface, () => serialized(async () => {
		await synchronize();
		const command = await options.port.open(surface, structuredClone(history.present));
		if (command === null || command === undefined) return;
		assertSurfaceCommand(surface, command);
		await persist(executeHistory(
			options.generation, options.profile, history, command, options.now?.(),
		));
	})]));
	const restore = (direction: 'undo' | 'redo'): Promise<boolean> => serialized(async () => {
		await synchronize();
		const entries = direction === 'undo' ? history.undoStack : history.redoStack;
		if (entries.length === 0) return false;
		await persist(restoreHistory(
			options.generation, options.profile, history, direction, options.now?.(),
		));
		return true;
	});
	return Object.freeze({
		runtime: createFramescaperCandidateAuthoringActionSubsetRuntime(surfaces, actions),
		undo: () => restore('undo'),
		redo: () => restore('redo'),
	});
}

function createHistory(
	generation: FramescaperDormantAuthoringGeneration,
	profile: unknown,
	project: CandidateProject,
): CandidateHistory {
	if (generation === 22) return createFramescaperProjectHistoryV22(profile, project);
	if (generation === 24) return createFramescaperProjectHistoryV24(profile, project);
	if (generation === 25) return createFramescaperProjectHistoryV25(profile, project);
	return createFramescaperProjectHistoryV26(profile, project);
}

function executeHistory(
	generation: FramescaperDormantAuthoringGeneration,
	profile: unknown,
	history: CandidateHistory,
	command: unknown,
	now: Date | string | undefined,
): CandidateHistory {
	if (generation === 22) return executeFramescaperProjectCommandV22(profile, history, command, { now });
	if (generation === 24) return executeFramescaperProjectCommandV24(profile, history, command, { now });
	if (generation === 25) return executeFramescaperProjectCommandV25(profile, history, command, { now });
	return executeFramescaperProjectCommandV26(profile, history, command, { now });
}

function restoreHistory(
	generation: FramescaperDormantAuthoringGeneration,
	profile: unknown,
	history: CandidateHistory,
	direction: 'undo' | 'redo',
	now: Date | string | undefined,
): CandidateHistory {
	if (generation === 22) return direction === 'undo'
		? undoFramescaperProjectCommandV22(profile, history, { now })
		: redoFramescaperProjectCommandV22(profile, history, { now });
	if (generation === 24) return direction === 'undo'
		? undoFramescaperProjectCommandV24(profile, history, { now })
		: redoFramescaperProjectCommandV24(profile, history, { now });
	if (generation === 25) return direction === 'undo'
		? undoFramescaperProjectCommandV25(profile, history, { now })
		: redoFramescaperProjectCommandV25(profile, history, { now });
	return direction === 'undo'
		? undoFramescaperProjectCommandV26(profile, history, { now })
		: redoFramescaperProjectCommandV26(profile, history, { now });
}

function assertSurfaceCommand(surface: FramescaperCandidateAuthoringSurface, command: unknown): void {
	const commands = flattenCommands(command);
	const hasType = (type: string): boolean => commands.some((candidate) => field(candidate, 'type') === type);
	if (surface === 'video-transition' || surface === 'video-transition-dissolve') {
		const transitionSets = commands.filter((candidate) => field(candidate, 'type') === 'video-transition/set');
		const hasAllocation = commands.some((candidate) => {
			const allocation = optionalField(candidate, 'videoTransitionAllocations');
			return Array.isArray(allocation) && allocation.length > 0;
		});
		if (transitionSets.length === 0 && !hasAllocation) throw mismatch(surface);
		if (surface === 'video-transition-dissolve' && transitionSets.some((candidate) => (
			field(record(field(candidate, 'transition'), 'transition'), 'type') !== 'dissolve'
		))) throw mismatch(surface);
		return;
	}
	if (surface === 'video-adjustment-layer' && hasType('video-adjustment-layer/set')) return;
	if (surface === 'video-mask-matte' && hasType('video-mask-matte/set')) return;
	if (surface === 'video-freeze' && hasType('video-freeze-fallback/set')) return;
	const expectedKind = surface === 'video-still' ? 'still'
		: surface === 'video-title' ? ['title', 'text']
			: surface === 'video-shape' ? 'shape'
				: surface === 'video-solid' ? 'solid'
					: surface === 'video-external-generator' ? 'external-generator' : null;
	if (expectedKind !== null && commands.some((candidate) => sourceKind(candidate, expectedKind))) return;
	throw mismatch(surface);
}

function sourceKind(command: Readonly<Record<string, unknown>>, expected: string | readonly string[]): boolean {
	if (field(command, 'type') !== 'video-visual-source/set') return false;
	const sourceValue = field(command, 'source');
	if (sourceValue === null) return false;
	const source = record(sourceValue, 'visual source');
	const kind = field(source, 'kind');
	if (kind === 'still') return expected === 'still';
	if (kind !== 'generator') return false;
	const generator = record(field(source, 'generator'), 'visual generator');
	const generatorKind = field(generator, 'kind');
	return Array.isArray(expected) ? expected.includes(String(generatorKind)) : generatorKind === expected;
}

function flattenCommands(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	const output: Readonly<Record<string, unknown>>[] = [];
	const visit = (candidate: unknown, depth: number): void => {
		if (depth > 32 || output.length >= MAXIMUM_AUTHORING_COMMANDS) {
			throw new RangeError('The candidate authoring command tree exceeds its bound.');
		}
		const item = record(candidate, 'candidate authoring command');
		output.push(item);
		if (field(item, 'type') !== 'batch') return;
		const children = field(item, 'commands');
		if (!Array.isArray(children) || Reflect.ownKeys(children).length !== children.length + 1) {
			throw new TypeError('A candidate authoring batch must be a dense array.');
		}
		for (const child of children) visit(child, depth + 1);
	};
	visit(value, 0);
	return Object.freeze(output);
}

function assertOptions(value: unknown): void {
	const options = value as Partial<Readonly<{
		generation: unknown; repository: ProjectRepositoryPort; port: FramescaperDormantAuthoringPort;
	}>> | null;
	if (!options || ![22, 24, 25, 26].includes(Number(options.generation))
		|| typeof options.repository?.load !== 'function'
		|| typeof options.repository.saveIfCurrent !== 'function'
		|| typeof options.port?.open !== 'function') {
		throw new TypeError('Dormant candidate authoring requires exact profile, repository, and dialog ports.');
	}
}

function optionalField(recordValue: Readonly<Record<string, unknown>>, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(recordValue, name);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Candidate authoring command.${name} must be an own data property.`);
	}
	return descriptor.value;
}

function field(recordValue: Readonly<Record<string, unknown>>, name: string): unknown {
	const value = optionalField(recordValue, name);
	if (value === undefined) throw new TypeError(`Candidate authoring command.${name} is required.`);
	return value;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function mismatch(surface: FramescaperCandidateAuthoringSurface): RangeError {
	return new RangeError(`The ${surface} dialog returned a command for another authoring surface.`);
}
