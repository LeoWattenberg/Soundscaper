import type {
	DesktopNightlyTestsEnvironment,
	DesktopNightlyTestsPlaywrightPlan,
} from './desktop-nightly-tests-runtime.mjs';
import type { DesktopNightlyTestsMetricsExit } from './desktop-nightly-tests-metrics.mjs';

export const PACKAGED_COVERAGE_ARTIFACT_PATHS: Readonly<{
	readonly e2eBuildEvidence: 'coverage/build-evidence';
	readonly packagedCoverageConsoleLog: 'e2e-coverage/packaged-runtime/console.log';
	readonly packagedCoverageHtmlReport: 'e2e-coverage/packaged-runtime/playwright-report/index.html';
	readonly packagedCoverageJsonReport: 'e2e-coverage/packaged-runtime/results.json';
	readonly packagedCoverageJunitReport: 'e2e-coverage/packaged-runtime/junit.xml';
	readonly packagedCoverageRaw: 'coverage/v8-packaged';
	readonly packagedCoverageTestResults: 'e2e-coverage/packaged-runtime/test-results';
}>;

export interface DesktopNightlyTestsPackagedCoverageOptions {
	readonly executablePath: string;
	readonly payloadRoot: string;
	readonly runRoot: string;
	readonly esbuildBinaryPath?: string | null;
	readonly platform: 'win32' | 'darwin' | 'linux';
	readonly arch: 'x64' | 'arm64';
	readonly environment?: DesktopNightlyTestsEnvironment;
}

export function createDesktopNightlyTestsPackagedCoveragePlan(
	options: DesktopNightlyTestsPackagedCoverageOptions,
): DesktopNightlyTestsPlaywrightPlan;

export function preserveDesktopNightlyTestsCoverageEvidence(options: {
	readonly payloadRoot: string;
	readonly runRoot: string;
}): Promise<string>;

export function runDesktopNightlyTestsPackagedCoveragePhase(
	options: DesktopNightlyTestsPackagedCoverageOptions,
	dependencies: {
		readonly runPlaywright: (
			plan: DesktopNightlyTestsPlaywrightPlan,
		) => Promise<DesktopNightlyTestsMetricsExit>;
		readonly preserveEvidence?: typeof preserveDesktopNightlyTestsCoverageEvidence;
	},
): Promise<{
	readonly child: DesktopNightlyTestsMetricsExit;
	readonly diagnostics: Readonly<{ readonly passed: boolean }>;
}>;
