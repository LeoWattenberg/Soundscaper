/* SPDX-License-Identifier: AGPL-3.0-only */

/** Product payload authority carried by one reopened isolation review. */

import { basename } from 'node:path';

import { isVerifiedFramescaperMediaProductionReadiness } from './framescaper-media-production-readiness.ts';
import { isVerifiedOpenFxProductionReadiness } from './openfx-production-readiness.ts';
import {
	isVerifiedSoundscaperProfessionalReadiness,
	soundscaperProfessionalRuntimeClosureSha256,
} from './soundscaper-professional-native-readiness.mjs';
import type { NativeChildIsolationArtifactDescriptor } from './native-child-isolation-launcher.ts';

interface RuntimeLibrary { readonly name: string; readonly byteLength: number; readonly sha256: string }
export type NativeChildReviewedWorkload =
	| Readonly<{ kind: 'soundscaper'; payloads: readonly string[]; runtimeClosureSha256: string }>
	| Readonly<{ kind: 'openfx' | 'media'; payloads: readonly string[]; runtimeLibraries: readonly RuntimeLibrary[] }>;

export function projectNativeChildReviewedWorkload(value: unknown): Readonly<{
	launcher: unknown; workload: NativeChildReviewedWorkload;
	}> {
	if (isVerifiedSoundscaperProfessionalReadiness(value)) {
		const launcher = (value as Readonly<{ readonly evidence: Readonly<{ readonly launcher: Readonly<{
			readonly peerPayloadSha256: string; readonly runtimeClosureSha256: string;
		}> }> }>).evidence.launcher;
		return Object.freeze({ launcher, workload: Object.freeze({
			kind: 'soundscaper', payloads: Object.freeze([launcher.peerPayloadSha256]),
			runtimeClosureSha256: launcher.runtimeClosureSha256,
		}) });
	}
	if (isVerifiedFramescaperMediaProductionReadiness(value)) return Object.freeze({
		launcher: value.launcher,
		workload: Object.freeze({ kind: 'media', payloads: Object.freeze([value.mediaHostSha256]),
			runtimeLibraries: copyLibraries(value.runtimeLibraries) }),
	});
	if (isVerifiedOpenFxProductionReadiness(value)) return Object.freeze({
		launcher: value.launcher,
		workload: Object.freeze({ kind: 'openfx',
			payloads: Object.freeze([value.scannerSha256, value.runtimeHostSha256]),
			runtimeLibraries: copyLibraries(value.runtimeLibraries) }),
	});
	throw new TypeError('A branded reopened Ed25519 native-isolation readiness result is required.');
}

export function assertNativeChildReviewedWorkload(
	workload: NativeChildReviewedWorkload,
	request: Readonly<{
		executable: NativeChildIsolationArtifactDescriptor;
		reviewedPayload: NativeChildIsolationArtifactDescriptor;
		runtimeClosure: readonly NativeChildIsolationArtifactDescriptor[];
		arguments: readonly string[];
	}>,
): void {
	if (!workload.payloads.includes(request.reviewedPayload.sha256)) {
		throw new Error('The native child payload is outside its signed workload review.');
	}
	if (request.runtimeClosure.some(({ path }) => path === request.reviewedPayload.path)) {
		throw new Error('The reviewed native child payload cannot also be a runtime-library row.');
	}
	if (workload.kind === 'soundscaper') {
		if (soundscaperProfessionalRuntimeClosureSha256(request.runtimeClosure)
			!== workload.runtimeClosureSha256) throw new Error('The professional runtime closure differs from signed readiness.');
		if (request.executable.sha256 !== request.reviewedPayload.sha256
			&& !request.runtimeClosure.some(({ sha256 }) => sha256 === request.executable.sha256)) {
			throw new Error('The professional runtime loader is outside its signed closure.');
		}
	} else {
		const libraries = request.executable.sha256 === request.reviewedPayload.sha256
			? request.runtimeClosure : [request.executable, ...request.runtimeClosure];
		const observed = libraries.map((entry) => ({
			name: basename(entry.path), byteLength: entry.byteLength, sha256: entry.sha256,
		})).sort((left, right) => left.name.localeCompare(right.name, 'en'));
		if (JSON.stringify(observed) !== JSON.stringify(workload.runtimeLibraries)) {
			throw new Error('The native child runtime libraries differ from signed readiness.');
		}
	}
	if (request.executable.sha256 !== request.reviewedPayload.sha256
		&& request.arguments.filter((value) => value === request.reviewedPayload.path).length !== 1) {
		throw new Error('The authenticated runtime loader does not select the reviewed native child payload.');
	}
}

function copyLibraries(value: readonly RuntimeLibrary[]): readonly RuntimeLibrary[] {
	return Object.freeze(value.map((entry) => Object.freeze({ ...entry })));
}
