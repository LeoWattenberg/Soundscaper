/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DesktopNightlyTestsEnvironment,
	DesktopNightlyTestsItemProgress,
	DesktopNightlyTestsPlaywrightPlan,
} from './desktop-nightly-tests-runtime.mjs';

export interface DesktopNightlyTestsTauriPrototype {
	readonly executable: string;
	readonly executablePath: string;
	readonly sourceRevision: string;
	readonly target: { readonly platform: 'win' | 'mac' | 'linux'; readonly arch: 'x64' | 'arm64' };
	readonly byteLength: number;
	readonly sha256: string;
}

export interface DesktopNightlyTestsTauriOptions {
	readonly payloadRoot: string;
	readonly runRoot: string;
	readonly platform: string;
	readonly arch: string;
	readonly environment?: DesktopNightlyTestsEnvironment;
	readonly tauriPrototype: DesktopNightlyTestsTauriPrototype;
}

export const TAURI_ARTIFACT_PATHS: Readonly<{
	tauriConsoleLog: 'tauri/console.log';
	tauriSmokeReport: 'tauri/smoke-report.json';
	tauriSummary: 'tauri/summary.json';
}>;

export function resolveDesktopNightlyTestsTauriPrototype(options: {
	readonly payloadRoot: string;
	readonly sourceRevision: string | null;
	readonly platform: string;
	readonly arch: string;
}): Promise<DesktopNightlyTestsTauriPrototype | null>;

export function createDesktopNightlyTestsTauriPlan(options: DesktopNightlyTestsTauriOptions): DesktopNightlyTestsPlaywrightPlan;

export function runDesktopNightlyTestsTauriPhase(options: DesktopNightlyTestsTauriOptions, dependencies?: {
	readonly onItems?: (progress: DesktopNightlyTestsItemProgress) => void;
	readonly runChild?: (command: string, args: readonly string[], options: {
		readonly cwd: string;
		readonly environment: DesktopNightlyTestsEnvironment;
		readonly outputLimit: number;
		readonly timeout: number;
		readonly label: string;
		readonly errorEvent: 'once';
		readonly signal: AbortSignal;
	}) => Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
}): Promise<{
	readonly child: { readonly code: number | null; readonly signal: string | null };
	readonly diagnostics: { readonly passed: boolean };
}>;

export function runDesktopNightlyTestsTauriSmokeCLI(argv: readonly string[], dependencies?: {
	readonly platform?: string;
	readonly arch?: string;
	readonly runPhase?: typeof runDesktopNightlyTestsTauriPhase;
}): Promise<number>;
