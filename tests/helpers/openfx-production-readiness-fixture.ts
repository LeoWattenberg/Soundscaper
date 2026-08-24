/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OpenFxProductionReadinessEvidenceV1 } from '../../desktop/openfx-production-readiness.ts';

export function openFxProductionReadinessFixture(
	scannerSha256: string,
	runtimeHostSha256: string,
	runtimeLibraries: readonly Readonly<{ name: string; byteLength: number; sha256: string }>[] = [],
	qualifiedGpuBackends: readonly ('opengl' | 'opencl' | 'cuda')[] = ['opengl', 'opencl', 'cuda'],
): OpenFxProductionReadinessEvidenceV1 {
	return Object.freeze({
		schemaVersion: 1,
		kind: 'framescaper-openfx-production-readiness',
		target: 'linux-x64',
		scannerSha256,
		runtimeHostSha256,
		qualifiedGpuBackends: Object.freeze([...qualifiedGpuBackends]),
		runtimeLibraries: Object.freeze(runtimeLibraries.map((library) => Object.freeze({ ...library }))),
		launcher: Object.freeze({
			schemaVersion: 1,
			target: 'linux-x64',
			launcherId: 'framescaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: '11'.repeat(32),
			sandboxProfileSha256: '22'.repeat(32),
			brokerPolicySha256: '33'.repeat(32),
			filesystem: 'broker-only',
			network: 'denied',
			childProcesses: 'denied',
			dynamicCode: 'admitted-plugin-only',
		}),
		openfxVersion: '1.5.1',
		osIsolationAttested: true,
		hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true,
		reviewedAt: '2026-08-22',
		reviewer: 'synthetic-test-reviewer',
	});
}
