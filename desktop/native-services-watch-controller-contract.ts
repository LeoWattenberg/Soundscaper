/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID,
} from '../src/common/editor/native-watch-target.ts';
import type { WatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';

export interface FramescaperNativeWatchProjection {
	readonly ruleId: string;
	readonly grantId: string;
	readonly projectId: string;
	readonly binId: string | null;
	readonly extensions: readonly string[];
	readonly importMode: 'link' | 'copy';
	readonly generateProxies: boolean;
	readonly enabled: boolean;
}

export interface FramescaperNativeWatchProjectState {
	readonly open: boolean;
	readonly writable: boolean;
	/** Absent retains the historical V20 null-bin/no-proxy contract. */
	readonly schemaVersion?: 20 | 28;
	readonly binId?: string | null;
}

export function framescaperNativeWatchProjection(
	rule: Pick<WatchRuleV1, 'ruleId' | 'grantId' | 'projectId' | 'binId' | 'extensions'
		| 'importMode' | 'generateProxies' | 'enabled'>,
): FramescaperNativeWatchProjection {
	return Object.freeze({
		ruleId: rule.ruleId, grantId: rule.grantId, projectId: rule.projectId,
		binId: rule.binId, extensions: Object.freeze([...rule.extensions]),
		importMode: rule.importMode, generateProxies: rule.generateProxies, enabled: rule.enabled,
	});
}

export function assertFramescaperNativeWatchTarget(
	state: FramescaperNativeWatchProjectState,
	rule: Readonly<{ readonly binId: string | null; readonly generateProxies: boolean }>,
): void {
	if (state.schemaVersion === 28) {
		if (state.binId !== FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID
			|| rule.binId !== FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID) {
			throw new Error('Selected V28 watch folders require the exact writable project bin.');
		}
		return;
	}
	if (rule.generateProxies) {
		throw new Error('Framescaper V20 watch-folder proxy generation is unavailable.');
	}
	if (rule.binId !== null) {
		throw new Error('Framescaper V20 watch-folder destination bins are unavailable.');
	}
}

export function assertFramescaperNativeWatchProjection(
	value: unknown,
): asserts value is FramescaperNativeWatchProjection {
	const fields = [
		'ruleId', 'grantId', 'projectId', 'binId', 'extensions',
		'importMode', 'generateProxies', 'enabled',
	] as const;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('A native watch projection must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as typeof fields[number]))) {
		throw new TypeError('A native watch projection has missing or unsupported fields.');
	}
	const rule = value as Record<typeof fields[number], unknown>;
	for (const key of ['ruleId', 'grantId', 'projectId'] as const) text(rule[key], key);
	if (rule.binId !== null) text(rule.binId, 'bin id');
	if (!Array.isArray(rule.extensions) || rule.extensions.length > 32) {
		throw new TypeError('A native watch projection has invalid extensions.');
	}
	rule.extensions.forEach((extension) => text(extension, 'extension'));
	if (rule.importMode !== 'link' && rule.importMode !== 'copy') {
		throw new TypeError('A native watch import mode is invalid.');
	}
	if (typeof rule.generateProxies !== 'boolean' || typeof rule.enabled !== 'boolean') {
		throw new TypeError('A native watch projection flag is invalid.');
	}
}

function text(value: unknown, label: string): void {
	if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`A native watch projection ${label} is invalid.`);
	}
}
