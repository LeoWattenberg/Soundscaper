/* SPDX-License-Identifier: AGPL-3.0-only */

/** Grant-scoped Windows AppContainer authority for an authenticated native child. */

import { createHash } from 'node:crypto';

interface NativeChildWindowsFileIdentity {
	readonly dev: number;
	readonly ino: number;
}

interface NativeChildWindowsAuthorityArtifact {
	readonly sha256: string;
	readonly identity: NativeChildWindowsFileIdentity;
}

interface NativeChildWindowsAuthorityGrant {
	readonly kind: 'file' | 'directory';
	readonly identity: NativeChildWindowsFileIdentity;
}

export interface NativeChildWindowsAuthorityProfileInput {
	readonly brand: string;
	readonly target: string;
	readonly launcherId: string;
	readonly launcherSha256: string;
	readonly sandboxProfileSha256: string;
	readonly brokerPolicySha256: string;
	readonly executable: NativeChildWindowsAuthorityArtifact;
	readonly reviewedPayload: NativeChildWindowsAuthorityArtifact;
	readonly runtimeClosure: readonly NativeChildWindowsAuthorityArtifact[];
	readonly readOnly: readonly NativeChildWindowsAuthorityGrant[];
	readonly readExecute: readonly NativeChildWindowsAuthorityGrant[];
	readonly writeOnly: readonly NativeChildWindowsAuthorityGrant[];
}

export function createNativeChildWindowsAuthorityProfile(
	input: NativeChildWindowsAuthorityProfileInput,
): string {
	const binding = JSON.stringify({
		schemaVersion: 2,
		brand: input.brand,
		target: input.target,
		launcherId: input.launcherId,
		launcherSha256: input.launcherSha256,
		sandboxProfileSha256: input.sandboxProfileSha256,
		brokerPolicySha256: input.brokerPolicySha256,
		executable: artifactBinding(input.executable),
		reviewedPayload: artifactBinding(input.reviewedPayload),
		runtimeClosure: sortedBindings(input.runtimeClosure.map(artifactBinding)),
		readOnly: sortedBindings(input.readOnly.map(grantBinding)),
		readExecute: sortedBindings(input.readExecute.map(grantBinding)),
		writeOnly: sortedBindings(input.writeOnly.map(grantBinding)),
	});
	return `${input.brand}:${createHash('sha256').update(binding).digest('hex')}`;
}

function artifactBinding(value: NativeChildWindowsAuthorityArtifact): string {
	return `${value.identity.dev}:${value.identity.ino}:${value.sha256}`;
}

function grantBinding(value: NativeChildWindowsAuthorityGrant): string {
	return `${value.kind}:${value.identity.dev}:${value.identity.ino}`;
}

function sortedBindings(values: readonly string[]): readonly string[] {
	return Object.freeze([...values].sort());
}
