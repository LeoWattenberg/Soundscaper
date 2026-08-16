/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `WatchRuleV1` — a closed, bounded description of one watched folder.
 *
 * Every default is the conservative one. Linking is the default import mode
 * because copying a watch folder silently duplicates a user's media library.
 * Recursion is off by default and bounded when on, because a watch rule pointed
 * at a home directory should not quietly walk it. Proxy generation is opt-in,
 * since it costs real encode time on every arriving file.
 *
 * A directory symlink is never followed. Following one turns a bounded subtree
 * into an unbounded one, and lets a link placed inside the watched folder pull
 * in files from anywhere the user's account can read.
 *
 * A dot-prefixed entry is refused whether it is a file or a directory, and a
 * refused directory is never descended into. Hidden directories on a camera
 * card or a share — `.Trashes`, `.tmp`, an application's staging area — hold
 * deleted or half-written media that happens to carry a watched extension.
 */

import { createNativeValidators } from './native-validation.ts';

export const NATIVE_WATCH_IMPORT_MODES = Object.freeze(['link', 'copy'] as const);

export type NativeWatchImportMode = (typeof NATIVE_WATCH_IMPORT_MODES)[number];

export const NATIVE_WATCH_MAXIMUM_EXTENSIONS = 32;
export const NATIVE_WATCH_MAXIMUM_DEPTH = 8;
export const NATIVE_WATCH_DEFAULT_DEPTH = 4;

export interface WatchRuleV1 {
	readonly ruleId: string;
	readonly grantId: string;
	readonly projectId: string;
	readonly binId: string | null;
	readonly extensions: readonly string[];
	readonly recursive: boolean;
	readonly maximumDepth: number;
	readonly importMode: NativeWatchImportMode;
	readonly generateProxies: boolean;
	readonly enabled: boolean;
	readonly createdAtMs: number;
}

export interface WatchDirectoryEntryV1 {
	readonly name: string;
	readonly depth: number;
	readonly isDirectory: boolean;
	readonly isSymbolicLink: boolean;
}

export const NATIVE_WATCH_ENTRY_REFUSALS = Object.freeze([
	'rule-disabled',
	'symlink-not-followed',
	'depth-exceeded',
	'recursion-disabled',
	'extension-not-watched',
	'hidden-entry',
] as const);

export type NativeWatchEntryRefusal = (typeof NATIVE_WATCH_ENTRY_REFUSALS)[number];

export class NativeWatchRuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeWatchRuleError';
	}
}

const ID_PATTERN = /^[a-f0-9]{16,64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const EXTENSION_PATTERN = /^[a-z0-9][a-z0-9]{0,15}$/u;

const { nonNegativeInteger, pattern } = createNativeValidators({
	subject: 'A watch rule',
	raise: (message: string): never => {
		throw new NativeWatchRuleError(message);
	},
});

export function createWatchRuleV1(input: Readonly<{
	ruleId: string;
	grantId: string;
	projectId: string;
	binId?: string | null;
	extensions: readonly string[];
	recursive?: boolean;
	maximumDepth?: number;
	importMode?: NativeWatchImportMode;
	generateProxies?: boolean;
	enabled?: boolean;
	createdAtMs: number;
}>): WatchRuleV1 {
	const recursive = input.recursive === true;
	const maximumDepth = resolveDepth(input.maximumDepth, recursive);
	return Object.freeze({
		ruleId: pattern(input.ruleId, ID_PATTERN, 'ruleId'),
		grantId: pattern(input.grantId, ID_PATTERN, 'grantId'),
		projectId: pattern(input.projectId, IDENTIFIER_PATTERN, 'projectId'),
		binId: input.binId == null ? null : pattern(input.binId, IDENTIFIER_PATTERN, 'binId'),
		extensions: extensions(input.extensions),
		recursive,
		maximumDepth,
		importMode: importMode(input.importMode),
		generateProxies: input.generateProxies === true,
		enabled: input.enabled !== false,
		createdAtMs: nonNegativeInteger(input.createdAtMs, 'createdAtMs'),
	});
}

/**
 * Whether one directory entry is a candidate this rule would ingest.
 *
 * Refusals are returned rather than thrown: a walk over a real folder meets
 * entries it should ignore constantly, and that is not an error condition.
 */
export function watchRuleEntryRefusal(
	rule: WatchRuleV1,
	entry: WatchDirectoryEntryV1,
): NativeWatchEntryRefusal | null {
	if (!rule.enabled) return 'rule-disabled';
	if (entry.isSymbolicLink && entry.isDirectory) return 'symlink-not-followed';
	if (entry.depth > 0 && !rule.recursive) return 'recursion-disabled';
	if (entry.depth > rule.maximumDepth) return 'depth-exceeded';
	if (entry.name.startsWith('.')) return 'hidden-entry';
	if (entry.isDirectory) return null;
	const extension = entry.name.includes('.')
		? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase()
		: '';
	return rule.extensions.includes(extension) ? null : 'extension-not-watched';
}

export function watchRuleAdmitsEntry(rule: WatchRuleV1, entry: WatchDirectoryEntryV1): boolean {
	return watchRuleEntryRefusal(rule, entry) === null && !entry.isDirectory;
}

/**
 * Whether the walk should descend into this directory entry. A directory the
 * rule refuses is not opened, so the refusals stay the single list of reasons a
 * subtree is left alone.
 */
export function watchRuleDescendsInto(rule: WatchRuleV1, entry: WatchDirectoryEntryV1): boolean {
	if (!entry.isDirectory) return false;
	if (watchRuleEntryRefusal(rule, entry) !== null) return false;
	return entry.depth < rule.maximumDepth;
}

function resolveDepth(value: number | undefined, recursive: boolean): number {
	if (!recursive) return 0;
	const depth = value ?? NATIVE_WATCH_DEFAULT_DEPTH;
	if (!Number.isSafeInteger(depth) || depth < 1 || depth > NATIVE_WATCH_MAXIMUM_DEPTH) {
		throw new NativeWatchRuleError(
			`A recursive watch rule depth must be between 1 and ${String(NATIVE_WATCH_MAXIMUM_DEPTH)}.`,
		);
	}
	return depth;
}

function extensions(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new NativeWatchRuleError('A watch rule must name at least one extension to watch.');
	}
	if (value.length > NATIVE_WATCH_MAXIMUM_EXTENSIONS) {
		throw new NativeWatchRuleError('A watch rule exceeds its extension ceiling.');
	}
	const normalized = (value as readonly unknown[]).map((entry) => {
		if (typeof entry !== 'string') {
			throw new NativeWatchRuleError('A watch rule extension must be text.');
		}
		const lower = entry.replace(/^\./u, '').toLowerCase();
		if (!EXTENSION_PATTERN.test(lower)) {
			throw new NativeWatchRuleError('A watch rule extension must be a short alphanumeric suffix.');
		}
		return lower;
	});
	if (new Set(normalized).size !== normalized.length) {
		throw new NativeWatchRuleError('A watch rule must not list the same extension twice.');
	}
	return Object.freeze(normalized);
}

function importMode(value: unknown): NativeWatchImportMode {
	if (value === undefined) return 'link';
	if (value !== 'link' && value !== 'copy') {
		throw new NativeWatchRuleError('A watch rule import mode is explicitly link or copy.');
	}
	return value;
}
