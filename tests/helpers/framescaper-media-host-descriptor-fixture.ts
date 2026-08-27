/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperMediaHostDescriptor } from '../../desktop/framescaper-media-host-payload.ts';

export function framescaperMediaHostDescriptorFixture(
	base: Omit<FramescaperMediaHostDescriptor, 'isolation' | 'm9ReleaseReview'>,
): FramescaperMediaHostDescriptor {
	const artifact = (name: string, byte: string, ino: number) => Object.freeze({
		path: `/synthetic/media-isolation/${name}`,
		byteLength: 1,
		sha256: byte.repeat(32),
		identity: Object.freeze({ dev: 1, ino }),
	});
	return Object.freeze({
		...base,
		isolation: Object.freeze({
			launcher: artifact('launcher', '11', 31),
			sandboxProfile: artifact('profile.json', '22', 32),
			brokerPolicy: artifact('broker.json', '33', 33),
			runtimeLibraries: Object.freeze([]),
		}),
		m9ReleaseReview: Object.freeze({
			scope: 'stable-1.0-release' as const,
			status: 'complete' as const,
			evidence: Object.freeze({
			schemaVersion: 1,
			kind: 'framescaper-media-host-production-readiness',
			target: base.target,
			mediaHostSha256: base.sha256,
			runtimeLibraries: Object.freeze([]),
			launcher: Object.freeze({
				schemaVersion: 1,
				target: base.target,
				launcherId: base.target.startsWith('linux-')
					? 'framescaper-linux-landlock-seccomp-namespaces-v1'
					: base.target === 'mac-arm64'
						? 'framescaper-macos-seatbelt-broker-v1'
						: 'framescaper-windows-appcontainer-job-v1',
				launcherPayloadSha256: '11'.repeat(32),
				sandboxProfileSha256: '22'.repeat(32),
				brokerPolicySha256: '33'.repeat(32),
				filesystem: 'broker-grant-only',
				network: 'denied',
				childProcesses: 'denied',
				dynamicCode: 'denied',
			}),
			ffmpegVersion: '9.0.1',
			osIsolationAttested: true,
			hostileMediaDenialAttested: true,
			dualStreamFdRemapAttested: true,
			twoHourContinuityAttested: true,
			reviewedAt: '2026-08-24',
			reviewer: 'synthetic media fixture',
			}),
		}),
	});
}
