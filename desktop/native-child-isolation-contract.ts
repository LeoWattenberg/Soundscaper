/* SPDX-License-Identifier: AGPL-3.0-only */

/** Public request and result contracts for authenticated native-child isolation. */

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Writable } from 'node:stream';

import type {
	NativeChildFramedControl,
	NativeChildFramedControlBinding,
} from './native-child-framed-control.ts';

export type NativeChildIsolationTarget =
	| 'linux-x64'
	| 'linux-arm64'
	| 'mac-arm64'
	| 'win-x64'
	| 'win-arm64';

export interface NativeChildIsolationArtifactDescriptor {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<{ readonly dev: number; readonly ino: number }>;
}

export interface NativeChildIsolationPathGrant {
	readonly path: string;
	readonly kind: 'file' | 'directory';
	readonly identity: Readonly<{ readonly dev: number; readonly ino: number }>;
}

export interface NativeChildIsolationLaunchRequest {
	readonly executable: NativeChildIsolationArtifactDescriptor;
	readonly arguments: readonly string[];
	readonly readOnly: readonly NativeChildIsolationPathGrant[];
	readonly readExecute: readonly NativeChildIsolationPathGrant[];
	readonly writeOnly: readonly NativeChildIsolationPathGrant[];
	readonly runtimeClosure?: readonly NativeChildIsolationArtifactDescriptor[];
	readonly workloadPayload?: NativeChildIsolationArtifactDescriptor;
	readonly stdin?: 'ignore' | 'pipe';
	readonly extraInput?: Readonly<{ readonly childFd: 3 }> | null;
	readonly framedControl: NativeChildFramedControlBinding | null;
	readonly resourcePolicy: Readonly<{
		readonly maximumJobDurationMs: number;
		readonly maximumRssBytes: number;
	}>;
}

export interface NativeChildIsolationCompletion {
	readonly exitCode: number;
	readonly signal: NodeJS.Signals | null;
	readonly stdout: string;
	readonly stderr: string;
}

export interface EnforcedNativeChildLaunch {
	readonly schemaVersion: 1;
	readonly kind: 'native-child-os-isolation-enforced';
	readonly target: NativeChildIsolationTarget;
	readonly launcherId: string;
	readonly pid: number;
}

export interface NativeChildIsolationLaunch {
	readonly enforcement: EnforcedNativeChildLaunch;
	readonly stdin: Writable | null;
	readonly extraInput: Readonly<{ readonly childFd: 3; readonly sink: Writable }> | null;
	readonly control: NativeChildFramedControl | null;
	readonly completion: Promise<NativeChildIsolationCompletion>;
	kill(signal?: NodeJS.Signals): boolean;
}

export type NativeChildIsolationSpawn = (
	command: string,
	arguments_: readonly string[],
	options: SpawnOptions,
) => ChildProcess;

export interface NativeChildIsolationLauncherOptions {
	readonly target: NativeChildIsolationTarget;
	/** Machine authority derived from exact payload and runtime-closure descriptors. */
	readonly machineWorkload: NativeChildMachineWorkload;
	readonly artifacts: Readonly<{
		readonly launcher: NativeChildIsolationArtifactDescriptor;
		readonly sandboxProfile: NativeChildIsolationArtifactDescriptor;
		readonly brokerPolicy: NativeChildIsolationArtifactDescriptor;
	}>;
	readonly spawn?: NativeChildIsolationSpawn;
	readonly enforcementTimeoutMs?: number;
}

export type NativeChildMachineWorkload =
	| Readonly<{
		readonly kind: 'soundscaper';
		readonly payloads: readonly NativeChildIsolationArtifactDescriptor[];
		readonly runtimeClosure: readonly NativeChildIsolationArtifactDescriptor[];
	}>
	| Readonly<{
		readonly kind: 'media' | 'openfx';
		readonly payloads: readonly NativeChildIsolationArtifactDescriptor[];
		readonly runtimeLibraries: readonly NativeChildIsolationArtifactDescriptor[];
	}>;
