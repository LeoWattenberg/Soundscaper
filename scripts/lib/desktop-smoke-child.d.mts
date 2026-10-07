/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ChildProcess, SpawnOptions } from 'node:child_process';

export function runBoundedSmokeChild(command: string, args: readonly string[], options: {
	readonly cwd: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly outputLimit: number;
	readonly timeout: number;
	readonly label: string;
	readonly errorEvent: 'on' | 'once';
	readonly signal?: AbortSignal;
}, dependencies?: {
	readonly spawnChild?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
	readonly platform?: string;
	readonly killGroup?: typeof process.kill;
}): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
