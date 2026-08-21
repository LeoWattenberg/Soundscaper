export interface DesktopNightlyTestsEnvironment {
	readonly [key: string]: string | undefined;
}

export interface DesktopNightlyTestsProduct {
	readonly id: string;
	readonly name: string;
	readonly version: string;
}

export interface DesktopNightlyTestsRunPaths {
	readonly consoleLog: string;
	readonly htmlReport: string;
	readonly jsonReport: string;
	readonly junitReport: string;
	readonly result: string;
	readonly testResults: string;
}

export interface DesktopNightlyTestsRunDirectory {
	readonly runRoot: string;
	readonly paths: DesktopNightlyTestsRunPaths;
}

export interface DesktopNightlyTestsStaticServer {
	readonly baseURL: string;
	close(): Promise<void>;
}

export interface DesktopNightlyTestsPlaywrightPlan {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: DesktopNightlyTestsEnvironment;
	readonly logFile: string;
}

export type DesktopNightlyTestsStatus = 'running' | 'passed' | 'failed' | 'error' | 'interrupted';

export interface DesktopNightlyTestsResultEnvelope {
	readonly schemaVersion: 2;
	readonly kind: 'soundscaper-desktop-nightly-tests';
	readonly product: DesktopNightlyTestsProduct;
	readonly runtime: {
		readonly platform: string;
		readonly arch: string;
	};
	readonly sourceRevision: string | null;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly status: DesktopNightlyTestsStatus;
	readonly exitCode: number | null;
	readonly signal: string | null;
	readonly failure: string | null;
	readonly artifacts: {
		readonly consoleLog: 'console.log';
		readonly htmlReport: 'playwright-report/index.html';
		readonly jsonReport: 'results.json';
		readonly junitReport: 'junit.xml';
		readonly testResults: 'test-results';
		readonly metricsConsoleLog: 'metrics/console.log';
		readonly metricsHtmlReport: 'metrics/playwright-report/index.html';
		readonly metricsJsonReport: 'metrics/results.json';
		readonly metricsJunitReport: 'metrics/junit.xml';
		readonly metricsRaw: 'metrics/raw.json';
		readonly metricsSummary: 'metrics/summary.json';
		readonly metricsTestResults: 'metrics/test-results';
		readonly packagedRuntimeConsoleLog: 'packaged-runtime/console.log';
		readonly packagedRuntimeHtmlReport: 'packaged-runtime/playwright-report/index.html';
		readonly packagedRuntimeJsonReport: 'packaged-runtime/results.json';
		readonly packagedRuntimeJunitReport: 'packaged-runtime/junit.xml';
		readonly packagedRuntimeRaw: 'packaged-runtime/raw.json';
		readonly packagedRuntimeSummary: 'packaged-runtime/summary.json';
		readonly packagedRuntimeTestResults: 'packaged-runtime/test-results';
	};
}

export interface DesktopNightlyTestsExit {
	readonly status: Exclude<DesktopNightlyTestsStatus, 'running'>;
	readonly exitCode: number;
}

export function resolveDesktopNightlyTestsOutputRoot(options?: {
	readonly platform?: string;
	readonly executablePath?: string;
	readonly environment?: DesktopNightlyTestsEnvironment;
}): string;

export function createDesktopNightlyTestsRunDirectory(options: {
	readonly outputRoot: string;
	readonly productId: string;
	readonly now?: Date;
}): Promise<DesktopNightlyTestsRunDirectory>;

export function startDesktopNightlyTestsStaticServer(options: {
	readonly root: string;
}): Promise<DesktopNightlyTestsStaticServer>;

export function resolveDesktopNightlyTestsEsbuildBinary(options: {
	readonly payloadRoot: string;
}): Promise<string | null>;

export function createDesktopNightlyTestsPlaywrightPlan(options: {
	readonly executablePath: string;
	readonly payloadRoot: string;
	readonly runRoot: string;
	readonly baseURL: string;
	readonly esbuildBinaryPath?: string | null;
	readonly environment?: DesktopNightlyTestsEnvironment;
}): DesktopNightlyTestsPlaywrightPlan;

export function mapDesktopNightlyTestsExit(options: {
	readonly code: number | null;
	readonly signal: string | null;
}): DesktopNightlyTestsExit;

export function createDesktopNightlyTestsResultEnvelope(options: {
	readonly product: DesktopNightlyTestsProduct;
	readonly platform: string;
	readonly arch: string;
	readonly sourceRevision?: string | null;
	readonly startedAt: Date;
	readonly finishedAt?: Date | null;
	readonly status: DesktopNightlyTestsStatus;
	readonly exitCode?: number | null;
	readonly signal?: string | null;
	readonly failure?: string | null;
}): DesktopNightlyTestsResultEnvelope;

export function writeDesktopNightlyTestsResultEnvelope(
	runRoot: string,
	result: DesktopNightlyTestsResultEnvelope,
	dependencies?: {
		readonly rename?: (source: string, target: string) => Promise<void>;
	},
): Promise<void>;

export interface DesktopNightlyTestsRunOptions {
	readonly executablePath: string;
	readonly payloadRoot: string;
	readonly outputRoot?: string;
	readonly product: DesktopNightlyTestsProduct;
	readonly platform?: string;
	readonly arch?: string;
	readonly environment?: DesktopNightlyTestsEnvironment;
	readonly sourceRevision?: string | null;
}

export interface DesktopNightlyTestsDependencies {
	readonly now?: () => Date;
	readonly createRunDirectory?: typeof createDesktopNightlyTestsRunDirectory;
	readonly startStaticServer?: typeof startDesktopNightlyTestsStaticServer;
	readonly resolveEsbuildBinary?: typeof resolveDesktopNightlyTestsEsbuildBinary;
	readonly runPlaywright?: (
		plan: DesktopNightlyTestsPlaywrightPlan,
	) => Promise<{ readonly code: number | null; readonly signal: string | null }>;
	readonly writeMetricsEvidence?: (options: {
		readonly payloadRoot: string;
		readonly runRoot: string;
		readonly sourceRevision: string | null;
		readonly playwrightExit: { readonly code: number | null; readonly signal: string | null };
	}) => Promise<{ readonly passed: boolean }>;
	readonly writePackagedMetricsEvidence?: (options: {
		readonly payloadRoot: string;
		readonly runRoot: string;
		readonly sourceRevision: string | null;
		readonly playwrightExit: { readonly code: number | null; readonly signal: string | null };
		readonly consoleLogPath: string;
		readonly artifactDirectory: 'packaged-runtime';
		readonly evidenceKind: 'packaged-runtime';
	}) => Promise<{ readonly passed: boolean }>;
	readonly writeResult?: (
		runRoot: string,
		result: DesktopNightlyTestsResultEnvelope,
	) => Promise<void>;
}

export function runDesktopNightlyTests(
	options: DesktopNightlyTestsRunOptions,
	dependencies?: DesktopNightlyTestsDependencies,
): Promise<{
	readonly exitCode: number;
	readonly outputRoot: string;
	readonly runRoot: string;
	readonly result: DesktopNightlyTestsResultEnvelope;
}>;
