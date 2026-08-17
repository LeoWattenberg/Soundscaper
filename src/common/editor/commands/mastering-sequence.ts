/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';

/**
 * The mastering-sequence command domain.
 *
 * The namespace is `mastering-sequence/` and is deliberately not shortened. The
 * capability gate and the product apply branch both match on the prefix, so a
 * shorter `mastering/` would later become a prefix of this one and a `sequence/`
 * namespace is already taken by sequence timing. Picking it once is the whole
 * decision.
 *
 * This file declares the discriminants and their payloads and imports no runtime
 * value from `protocol.ts`, because protocol spreads this list — the dependency
 * runs one way only.
 */

export const MASTERING_SEQUENCE_COMMAND_TYPES = [
	'mastering-sequence/add',
	'mastering-sequence/remove',
	'mastering-sequence/rename',
	'mastering-sequence/entry-add',
	'mastering-sequence/entry-remove',
	'mastering-sequence/entry-reorder',
	'mastering-sequence/entry-retitle',
	'mastering-sequence/entry-metadata',
	'mastering-sequence/entry-timing',
] as const;

export type MasteringSequenceCommandType = typeof MASTERING_SEQUENCE_COMMAND_TYPES[number];

export interface MasteringSequenceCommandPayloads {
	readonly 'mastering-sequence/add': {
		readonly sequence: Readonly<Record<string, unknown>>;
	};
	readonly 'mastering-sequence/remove': {
		readonly sequenceId: string;
	};
	readonly 'mastering-sequence/rename': {
		readonly sequenceId: string;
		readonly name: string;
	};
	readonly 'mastering-sequence/entry-add': {
		readonly sequenceId: string;
		readonly entry: Readonly<Record<string, unknown>>;
		readonly index?: number;
	};
	readonly 'mastering-sequence/entry-remove': {
		readonly sequenceId: string;
		readonly entryId: string;
	};
	readonly 'mastering-sequence/entry-reorder': {
		readonly sequenceId: string;
		readonly entryId: string;
		readonly toIndex: number;
	};
	readonly 'mastering-sequence/entry-retitle': {
		readonly sequenceId: string;
		readonly entryId: string;
		readonly title: string | null;
	};
	readonly 'mastering-sequence/entry-metadata': {
		readonly sequenceId: string;
		readonly entryId: string;
		readonly metadata: Readonly<Record<string, string>>;
	};
	readonly 'mastering-sequence/entry-timing': {
		readonly sequenceId: string;
		readonly entryId: string;
		readonly gapBeforeFrames?: number;
		readonly fadeInFrames?: number;
		readonly fadeOutFrames?: number;
	};
}

export type MasteringSequenceCommandHandlers = DomainCommandHandlerRegistry<
	typeof MASTERING_SEQUENCE_COMMAND_TYPES
>;

export function defineMasteringSequenceCommandHandlers(
	handlers: MasteringSequenceCommandHandlers,
): Readonly<MasteringSequenceCommandHandlers> {
	return defineDomainCommandHandlerRegistry(
		'mastering sequence',
		MASTERING_SEQUENCE_COMMAND_TYPES,
		handlers,
	);
}
