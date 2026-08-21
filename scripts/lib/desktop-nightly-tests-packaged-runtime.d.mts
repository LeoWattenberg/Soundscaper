import type {
	DesktopNightlyTestsEnvironment,
	DesktopNightlyTestsPlaywrightPlan,
} from './desktop-nightly-tests-runtime.mjs';
import type {
	DesktopNightlyTestsMetricsEvidence,
	DesktopNightlyTestsMetricsExit,
} from './desktop-nightly-tests-metrics.mjs';

export const PACKAGED_RUNTIME_ARTIFACT_PATHS: Readonly<{
	readonly packagedRuntimeConsoleLog: 'packaged-runtime/console.log';
	readonly packagedRuntimeHtmlReport: 'packaged-runtime/playwright-report/index.html';
	readonly packagedRuntimeJsonReport: 'packaged-runtime/results.json';
	readonly packagedRuntimeJunitReport: 'packaged-runtime/junit.xml';
	readonly packagedRuntimeRaw: 'packaged-runtime/raw.json';
	readonly packagedRuntimeSummary: 'packaged-runtime/summary.json';
	readonly packagedRuntimeTestResults: 'packaged-runtime/test-results';
}>;

export function packagedRuntimeChromiumArguments(
	platform: 'win32' | 'darwin' | 'linux',
): readonly string[];

export function resolvePackagedProductExecutable(options: {
	readonly productRoot: string;
	readonly productId: string;
	readonly platform: string;
	readonly arch: string;
}): string;

export interface DesktopNightlyTestsPackagedMetricsOptions {
	readonly executablePath: string;
	readonly payloadRoot: string;
	readonly runRoot: string;
	readonly baseURL: string;
	readonly esbuildBinaryPath?: string | null;
	readonly platform: 'win32' | 'darwin' | 'linux';
	readonly arch: 'x64' | 'arm64';
	readonly environment?: DesktopNightlyTestsEnvironment;
	readonly sourceRevision?: string | null;
}

export function createDesktopNightlyTestsPackagedMetricsPlan(
	options: DesktopNightlyTestsPackagedMetricsOptions,
): DesktopNightlyTestsPlaywrightPlan;

export function runDesktopNightlyTestsPackagedMetricsPhase(
	options: DesktopNightlyTestsPackagedMetricsOptions,
	dependencies: {
		readonly runPlaywright: (plan: DesktopNightlyTestsPlaywrightPlan) => Promise<DesktopNightlyTestsMetricsExit>;
		readonly writeEvidence?: (options: {
			readonly payloadRoot: string;
			readonly runRoot: string;
			readonly sourceRevision: string | null;
			readonly playwrightExit: DesktopNightlyTestsMetricsExit;
			readonly consoleLogPath: string;
			readonly artifactDirectory: 'packaged-runtime';
			readonly evidenceKind: 'packaged-runtime';
		}) => Promise<DesktopNightlyTestsMetricsEvidence>;
	},
): Promise<{
	readonly child: DesktopNightlyTestsMetricsExit;
	readonly evidence: DesktopNightlyTestsMetricsEvidence;
}>;
