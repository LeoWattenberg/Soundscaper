/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_CAPTURE_ORIGIN_PROTECTED_CODE =
	'FRAMESCAPER_CAPTURE_ORIGIN_PROTECTED' as const;

export type FramescaperCaptureOriginProtectedAction =
	'edit' | 'close' | 'delete' | 'handoff';
export type FramescaperCaptureOriginReleaseOutcome = 'stopped' | 'discarded';

export interface FramescaperCaptureOriginBinding {
	readonly projectId: string;
	readonly baseRevision: number;
	readonly baseSha256: string;
	readonly sequenceId: string;
	readonly playheadMicroseconds: number;
}

export interface FramescaperCaptureOriginAuthority {
	readonly kind: 'framescaper-capture-origin-authority';
	readonly generation: number;
}

export interface FramescaperCaptureOriginGuardSnapshot {
	readonly active: boolean;
	readonly generation: number | null;
	readonly origin: Readonly<FramescaperCaptureOriginBinding> | null;
	readonly activeProjectId: string | null;
	readonly activeProjectIsOrigin: boolean;
	readonly editBlocked: boolean;
	readonly closeBlocked: boolean;
	readonly deleteBlocked: boolean;
	readonly handoffBlocked: boolean;
}

export interface FramescaperCaptureOriginGuard {
	bind(
		origin: Readonly<FramescaperCaptureOriginBinding>,
	): Readonly<FramescaperCaptureOriginAuthority>;
	release(
		authority: Readonly<FramescaperCaptureOriginAuthority>,
		outcome: FramescaperCaptureOriginReleaseOutcome,
	): boolean;
	isOriginProject(projectId: string): boolean;
	assertEditAllowed(projectId: string): void;
	assertCloseAllowed(projectId: string): void;
	assertDeleteAllowed(projectId: string): void;
	assertHandoffAllowed(projectId: string): void;
	snapshot(activeProjectId?: string | null): Readonly<FramescaperCaptureOriginGuardSnapshot>;
}

export class FramescaperCaptureOriginProtectedError extends Error {
	readonly code = FRAMESCAPER_CAPTURE_ORIGIN_PROTECTED_CODE;

	constructor(
		readonly action: FramescaperCaptureOriginProtectedAction,
		readonly projectId: string,
		readonly generation: number,
	) {
		super(`Framescaper capture protects ${projectId} from ${action} until stop or discard.`);
		this.name = 'FramescaperCaptureOriginProtectedError';
	}
}

interface ActiveOrigin {
	readonly binding: Readonly<FramescaperCaptureOriginBinding>;
	readonly authority: Readonly<FramescaperCaptureOriginAuthority>;
}

/**
 * Owns the small cross-project fence for one live capture. Project activation
 * is intentionally outside this guard: only the exact origin is protected.
 */
export function createFramescaperCaptureOriginGuard(): FramescaperCaptureOriginGuard {
	let generation = 0;
	let active: ActiveOrigin | null = null;

	function bind(
		originValue: Readonly<FramescaperCaptureOriginBinding>,
	): Readonly<FramescaperCaptureOriginAuthority> {
		if (active !== null) {
			throw new Error(
				`Framescaper capture already protects ${active.binding.projectId}.`,
			);
		}
		const binding = normalizeOrigin(originValue);
		generation += 1;
		if (!Number.isSafeInteger(generation)) {
			throw new RangeError('Framescaper capture origin generation is exhausted.');
		}
		const authority = Object.freeze({
			kind: 'framescaper-capture-origin-authority' as const,
			generation,
		});
		active = Object.freeze({ binding, authority });
		return authority;
	}

	function release(
		authority: Readonly<FramescaperCaptureOriginAuthority>,
		outcome: FramescaperCaptureOriginReleaseOutcome,
	): boolean {
		if (outcome !== 'stopped' && outcome !== 'discarded') {
			throw new TypeError('Framescaper capture origin can release only after stop or discard.');
		}
		if (active === null || authority !== active.authority) return false;
		active = null;
		return true;
	}

	function isOriginProject(projectIdValue: string): boolean {
		const projectId = stableId(projectIdValue, 'projectId');
		return active?.binding.projectId === projectId;
	}

	function assertAllowed(
		action: FramescaperCaptureOriginProtectedAction,
		projectIdValue: string,
	): void {
		const projectId = stableId(projectIdValue, 'projectId');
		if (active?.binding.projectId !== projectId) return;
		throw new FramescaperCaptureOriginProtectedError(
			action,
			projectId,
			active.authority.generation,
		);
	}

	function snapshot(
		activeProjectIdValue: string | null = null,
	): Readonly<FramescaperCaptureOriginGuardSnapshot> {
		const activeProjectId = activeProjectIdValue === null
			? null
			: stableId(activeProjectIdValue, 'active projectId');
		const activeProjectIsOrigin = active !== null
			&& active.binding.projectId === activeProjectId;
		return Object.freeze({
			active: active !== null,
			generation: active?.authority.generation ?? null,
			origin: active?.binding ?? null,
			activeProjectId,
			activeProjectIsOrigin,
			editBlocked: activeProjectIsOrigin,
			closeBlocked: activeProjectIsOrigin,
			deleteBlocked: activeProjectIsOrigin,
			handoffBlocked: activeProjectIsOrigin,
		});
	}

	return Object.freeze({
		bind,
		release,
		isOriginProject,
		assertEditAllowed: (projectId: string) => assertAllowed('edit', projectId),
		assertCloseAllowed: (projectId: string) => assertAllowed('close', projectId),
		assertDeleteAllowed: (projectId: string) => assertAllowed('delete', projectId),
		assertHandoffAllowed: (projectId: string) => assertAllowed('handoff', projectId),
		snapshot,
	});
}

function normalizeOrigin(value: unknown): Readonly<FramescaperCaptureOriginBinding> {
	const origin = closedDataRecord(value, 'Framescaper capture origin', [
		'projectId', 'baseRevision', 'baseSha256', 'sequenceId', 'playheadMicroseconds',
	]);
	const baseRevision = nonNegativeInteger(
		origin.baseRevision,
		'Framescaper capture base revision',
	);
	const baseSha256 = origin.baseSha256;
	if (typeof baseSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(baseSha256)) {
		throw new TypeError('Framescaper capture base SHA-256 is invalid.');
	}
	return Object.freeze({
		projectId: stableId(origin.projectId, 'Framescaper capture projectId'),
		baseRevision,
		baseSha256,
		sequenceId: stableId(origin.sequenceId, 'Framescaper capture sequenceId'),
		playheadMicroseconds: nonNegativeInteger(
			origin.playheadMicroseconds,
			'Framescaper capture playhead',
		),
	});
}

function closedDataRecord(
	value: unknown,
	name: string,
	keys: readonly string[],
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const source = value as Record<PropertyKey, unknown>;
	const actualKeys = Reflect.ownKeys(source);
	const allowed = new Set(keys);
	if (actualKeys.length !== keys.length
		|| actualKeys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| keys.some((key) => !Object.hasOwn(source, key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}
