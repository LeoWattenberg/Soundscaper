/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import { snapshotInertEditorCommand } from '../commands/editor-command-snapshot.ts';
import {
	isAudioEditorCommandType,
	type AudioEditorCommand,
} from '../commands/protocol.ts';
import { AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../project-validation-budget.ts';
import {
	createAssistanceAssetReferenceV1,
	normalizeAssistanceAssetReferencesV1,
	type AssistanceAssetReferenceV1,
} from './assistance-asset-reference-v1.ts';

export const ASSISTANCE_ASSET_UPSERT_COMMAND_TYPE_V1 = 'assistance-asset/upsert' as const;

export interface AssistanceAssetUpsertCommandDiscriminantV1 {
	readonly type: typeof ASSISTANCE_ASSET_UPSERT_COMMAND_TYPE_V1;
}

export interface AssistanceAssetUpsertCommandV1 extends AssistanceAssetUpsertCommandDiscriminantV1 {
	/** Null asserts that the identity is not already present. */
	readonly expectedReference: Readonly<AssistanceAssetReferenceV1> | null;
	readonly reference: Readonly<AssistanceAssetReferenceV1>;
	/** Ordinary inherited edits published atomically with the reference. */
	readonly commands: readonly AudioEditorCommand[];
}

const COMMAND_FIELDS = Object.freeze(['type', 'expectedReference', 'reference', 'commands'] as const);
const REQUIRED_COMMAND_FIELDS = Object.freeze(['type', 'expectedReference', 'reference'] as const);

/** Identify the product-owned command without invoking caller-owned properties. */
export function hasAssistanceAssetUpsertCommandTypeV1(
	value: unknown,
): value is AssistanceAssetUpsertCommandDiscriminantV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& descriptor.value === ASSISTANCE_ASSET_UPSERT_COMMAND_TYPE_V1);
}

/** Snapshot the exact pathless transcript-reference command wire. */
export function snapshotAssistanceAssetUpsertCommandV1(
	value: unknown,
): Readonly<AssistanceAssetUpsertCommandV1> {
	const command = readClosedDomainRecord(
		value,
		'assistance asset upsert command',
		COMMAND_FIELDS,
		REQUIRED_COMMAND_FIELDS,
	);
	if (readClosedDomainField(command, 'type', 'assistance asset upsert command')
		!== ASSISTANCE_ASSET_UPSERT_COMMAND_TYPE_V1) {
		throw new RangeError('An assistance asset command must use assistance-asset/upsert.');
	}
	const expectedValue = readClosedDomainField(
		command, 'expectedReference', 'assistance asset upsert command',
	);
	const expectedReference = expectedValue === null
		? null
		: createAssistanceAssetReferenceV1(expectedValue);
	const reference = createAssistanceAssetReferenceV1(readClosedDomainField(
		command, 'reference', 'assistance asset upsert command',
	));
	if (expectedReference !== null && expectedReference.id !== reference.id) {
		throw new RangeError('An assistance asset upsert command cannot change reference identity.');
	}
	if (same(expectedReference, reference)) {
		throw new RangeError('An assistance asset upsert command must mutate its reference.');
	}
	const commands = snapshotOrdinaryCommands(command);
	return Object.freeze({
		type: ASSISTANCE_ASSET_UPSERT_COMMAND_TYPE_V1,
		expectedReference,
		reference,
		commands,
	});
}

/** Replace or append one reference after an optimistic exact-value fence. */
export function applyAssistanceAssetUpsertCommandV1(
	assetsValue: unknown,
	commandValue: unknown,
): readonly Readonly<AssistanceAssetReferenceV1>[] {
	const assets = normalizeAssistanceAssetReferencesV1(assetsValue);
	const command = snapshotAssistanceAssetUpsertCommandV1(commandValue);
	const index = assets.findIndex(({ id }) => id === command.reference.id);
	const current = index < 0 ? null : assets[index]!;
	if (!same(current, command.expectedReference)) {
		throw new Error('The expected assistance asset reference is stale.');
	}
	const next = [...assets];
	if (index < 0) next.push(command.reference);
	else next[index] = command.reference;
	return normalizeAssistanceAssetReferencesV1(next);
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotOrdinaryCommands(
	command: Readonly<Record<string, unknown>>,
): readonly AudioEditorCommand[] {
	const descriptor = Object.getOwnPropertyDescriptor(command, 'commands');
	if (descriptor === undefined) return Object.freeze([]);
	const values = readClosedDomainArray(
		readClosedDomainField(command, 'commands', 'assistance asset upsert command'),
		'assistance asset upsert command.commands',
		0,
		AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes,
	);
	const batch = snapshotInertEditorCommand(
		{ type: 'batch', commands: values },
		'assistance asset inherited commands',
	);
	if (batch.type !== 'batch') throw new TypeError('Assistance asset commands lost their inherited batch.');
	assertOrdinaryCommandTree(batch);
	return Object.freeze([...batch.commands]);
}

function assertOrdinaryCommandTree(command: AudioEditorCommand): void {
	const stack: AudioEditorCommand[] = [command];
	while (stack.length > 0) {
		const candidate = stack.pop()!;
		if (!isAudioEditorCommandType(candidate.type)) {
			throw new RangeError('An assistance asset compound accepts only ordinary editor commands.');
		}
		if (candidate.type === 'batch') stack.push(...candidate.commands);
	}
}
