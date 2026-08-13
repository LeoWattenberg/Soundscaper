/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from './editor-project-environment-v18.ts';
import {
	framescaperProjectStoreAuthorityV18,
} from './editor-project-store-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';

export type FramescaperVideoProxyReattestationMissingCapabilityV18 =
	| 'active-project-task-fence'
	| 'local-media-generation-read-lease'
	| 'linked-original-generation-read-lease'
	| 'trusted-original-timing-view';

export interface FramescaperVideoProxyReattestationMissingPrerequisiteV18 {
	readonly capability: FramescaperVideoProxyReattestationMissingCapabilityV18;
	readonly owner:
		| 'controller-session'
		| 'media-repository'
		| 'linked-video-original-repository'
		| 'video-timing-runtime';
	readonly requiredOperation: string;
}

export interface FramescaperVideoProxyReattestationStorePrerequisiteAuditV18 {
	readonly kind: 'framescaper-video-proxy-reattestation-store-prerequisite-audit';
	readonly version: 1;
	readonly rule: 'exact-private-generation-bound-read-leases-v1';
	readonly status: 'blocked';
	readonly storeAuthorityFields: readonly ['opfs', 'port'];
	readonly missing: readonly Readonly<FramescaperVideoProxyReattestationMissingPrerequisiteV18>[];
}

const EXACT_STORE_AUTHORITY_FIELDS = Object.freeze(['opfs', 'port'] as const);
const MISSING = Object.freeze([
	Object.freeze({
		capability: 'active-project-task-fence' as const,
		owner: 'controller-session' as const,
		requiredOperation: 'capture and synchronously reassert one exact active project/source task generation',
	}),
	Object.freeze({
		capability: 'local-media-generation-read-lease' as const,
		owner: 'media-repository' as const,
		requiredOperation: 'hold full unsanitized row identity and body with assertCurrent and release',
	}),
	Object.freeze({
		capability: 'linked-original-generation-read-lease' as const,
		owner: 'linked-video-original-repository' as const,
		requiredOperation: 'hold exact binding and locator generation with bytes, assertCurrent, and release',
	}),
	Object.freeze({
		capability: 'trusted-original-timing-view' as const,
		owner: 'video-timing-runtime' as const,
		requiredOperation: 'bind current original timing under the same project, source, and media fences',
	}),
]) satisfies readonly Readonly<FramescaperVideoProxyReattestationMissingPrerequisiteV18>[];

const AUDITS = new WeakMap<object, FramescaperVideoProxyReattestationStorePrerequisiteAuditV18>();

/**
 * This typed stop is intentionally product-owned. The exact current store
 * authority exposes only its backend port and OPFS owner; neither surface is a
 * held media-generation read lease, and the environment owns no active task or
 * original timing resolver. Any authority-surface change forces a fresh audit.
 */
export function auditFramescaperVideoProxyReattestationStorePrerequisiteV18(
	environmentValue: unknown,
): Readonly<FramescaperVideoProxyReattestationStorePrerequisiteAuditV18>;
export function auditFramescaperVideoProxyReattestationStorePrerequisiteV18(
	environmentValue: unknown,
	...unexpected: readonly unknown[]
): Readonly<FramescaperVideoProxyReattestationStorePrerequisiteAuditV18> {
	if (unexpected.length !== 0) {
		throw new TypeError('The proxy re-attestation store audit accepts one exact environment and no callback or override injection.');
	}
	const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
	const cached = AUDITS.get(environment);
	if (cached) return cached;
	assertCurrentStoreAuthoritySurface(environment);
	const audit: FramescaperVideoProxyReattestationStorePrerequisiteAuditV18 = Object.freeze({
		kind: 'framescaper-video-proxy-reattestation-store-prerequisite-audit',
		version: 1,
		rule: 'exact-private-generation-bound-read-leases-v1',
		status: 'blocked',
		storeAuthorityFields: EXACT_STORE_AUTHORITY_FIELDS,
		missing: MISSING,
	});
	AUDITS.set(environment, audit);
	return audit;
}

export class FramescaperVideoProxyReattestationStorePrerequisiteErrorV18 extends Error {
	readonly audit: Readonly<FramescaperVideoProxyReattestationStorePrerequisiteAuditV18>;

	constructor(audit: Readonly<FramescaperVideoProxyReattestationStorePrerequisiteAuditV18>) {
		super('Framescaper V18 proxy re-attestation is blocked on private generation-bound repository prerequisites.');
		this.name = 'FramescaperVideoProxyReattestationStorePrerequisiteErrorV18';
		this.audit = audit;
	}
}

/** Always stop until the audited owners expose every closed prerequisite. */
export function assertFramescaperVideoProxyReattestationStorePrerequisiteV18(
	environmentValue: unknown,
): never;
export function assertFramescaperVideoProxyReattestationStorePrerequisiteV18(
	environmentValue: unknown,
	...unexpected: readonly unknown[]
): never {
	if (unexpected.length !== 0) {
		throw new TypeError('The proxy re-attestation prerequisite accepts one exact environment and no callback or override injection.');
	}
	throw new FramescaperVideoProxyReattestationStorePrerequisiteErrorV18(
		auditFramescaperVideoProxyReattestationStorePrerequisiteV18(environmentValue),
	);
}

function assertCurrentStoreAuthoritySurface(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
): void {
	const authority = framescaperProjectStoreAuthorityV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		environment.store,
	);
	const fields = Reflect.ownKeys(authority)
		.map((field) => typeof field === 'string' ? field : '')
		.sort();
	if (fields.length !== EXACT_STORE_AUTHORITY_FIELDS.length
		|| fields.some((field, index) => field !== EXACT_STORE_AUTHORITY_FIELDS[index])) {
		throw new Error('The exact V18 store authority surface changed; proxy re-attestation prerequisites require a new review.');
	}
	for (const field of EXACT_STORE_AUTHORITY_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(authority, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('The exact V18 store authority surface is not stable data.');
		}
	}
}
