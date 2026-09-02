/* SPDX-License-Identifier: AGPL-3.0-only */

import { productStorageKey } from './meter-settings.ts';

/**
 * The one-time "Getting started" record. Only the fact that setup finished is
 * durable; the chosen workspace itself lives in the ordinary preferences, so
 * this record never has to be migrated when presets change.
 */
export const FIRST_LAUNCH_SETUP_STORAGE_KEY = 'soundscaper-first-launch-setup-v1';

export interface FirstLaunchSetupRecord {
	readonly completed: true;
	readonly workspaceId: string | null;
	readonly completedAt: string;
}

export interface FirstLaunchSetupStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function firstLaunchSetupStorageKey(productId: string): string {
	return productStorageKey(FIRST_LAUNCH_SETUP_STORAGE_KEY, productId);
}

/** Corrupt, foreign or unfinished records read as "never completed". */
export function readFirstLaunchSetup(
	productId: string,
	storage: FirstLaunchSetupStorage | null | undefined = defaultStorage(),
): FirstLaunchSetupRecord | null {
	try {
		const raw = storage?.getItem(firstLaunchSetupStorageKey(productId));
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const candidate = parsed as Readonly<Record<string, unknown>>;
		if (candidate.completed !== true) return null;
		return Object.freeze({
			completed: true,
			workspaceId: typeof candidate.workspaceId === 'string' ? candidate.workspaceId : null,
			completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : '',
		});
	} catch {
		return null;
	}
}

export function isFirstLaunchSetupComplete(
	productId: string,
	storage?: FirstLaunchSetupStorage | null,
): boolean {
	return readFirstLaunchSetup(productId, storage) !== null;
}

/** Write failures (private browsing, quota) must never block the editor. */
export function markFirstLaunchSetupComplete(
	productId: string,
	workspaceId: string | null,
	storage: FirstLaunchSetupStorage | null | undefined = defaultStorage(),
	now: () => string = () => new Date().toISOString(),
): void {
	try {
		storage?.setItem(firstLaunchSetupStorageKey(productId), JSON.stringify({
			completed: true,
			workspaceId: workspaceId ?? null,
			completedAt: now(),
		}));
	} catch {
		// Storage that refuses writes simply shows the setup again next time.
	}
}

/** The value browser suites seed so an already-set-up editor boots silently. */
export function firstLaunchSetupSeedValue(workspaceId = 'modern'): string {
	return JSON.stringify({
		completed: true,
		workspaceId,
		completedAt: '1970-01-01T00:00:00.000Z',
	});
}

function defaultStorage(): FirstLaunchSetupStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
