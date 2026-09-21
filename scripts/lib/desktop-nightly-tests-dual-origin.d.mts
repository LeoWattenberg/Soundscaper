import type {
	DesktopNightlyTestsEnvironment,
	DesktopNightlyTestsPlaywrightPlan,
	DesktopNightlyTestsStaticServer,
} from './desktop-nightly-tests-runtime.mjs';
import type { DesktopNightlyTestsMetricsExit } from './desktop-nightly-tests-metrics.mjs';

export const DUAL_ORIGIN_ARTIFACT_PATHS: Readonly<{
	readonly dualOriginConsoleLog: 'e2e-coverage/dual-origin/console.log';
	readonly dualOriginHtmlReport: 'e2e-coverage/dual-origin/playwright-report/index.html';
	readonly dualOriginJsonReport: 'e2e-coverage/dual-origin/results.json';
	readonly dualOriginJunitReport: 'e2e-coverage/dual-origin/junit.xml';
	readonly dualOriginTestResults: 'e2e-coverage/dual-origin/test-results';
}>;

export interface DesktopNightlyTestsDualOriginOptions {
	readonly executablePath: string;
	readonly payloadRoot: string;
	readonly runRoot: string;
	readonly esbuildBinaryPath?: string | null;
	readonly environment?: DesktopNightlyTestsEnvironment;
	readonly activeProductOrigins?: Readonly<{
		readonly soundscaper: string;
		readonly framescaper: string;
	}>;
}

export function createDesktopNightlyTestsDualOriginPlan(
	options: DesktopNightlyTestsDualOriginOptions & {
		readonly origins: Readonly<{ readonly soundscaper: string; readonly framescaper: string }>;
	},
): DesktopNightlyTestsPlaywrightPlan;

export function runDesktopNightlyTestsDualOriginPhase(
	options: DesktopNightlyTestsDualOriginOptions,
	dependencies: {
		readonly runPlaywright: (
			plan: DesktopNightlyTestsPlaywrightPlan,
		) => Promise<DesktopNightlyTestsMetricsExit>;
		readonly startPagesSiteServer?: (options: {
			readonly root: string;
			readonly host: string;
			readonly port: number;
		}) => Promise<DesktopNightlyTestsStaticServer>;
	},
): Promise<{
	readonly child: DesktopNightlyTestsMetricsExit;
	readonly diagnostics: Readonly<{ readonly passed: boolean }>;
}>;
