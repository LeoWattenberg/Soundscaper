import type {
	DesktopNightlyTestsEnvironment,
	DesktopNightlyTestsPlaywrightPlan,
} from './desktop-nightly-tests-runtime.mjs';

export interface DesktopNightlyTestsMetricsExit {
	readonly code: number | null;
	readonly signal: string | null;
}

export interface DesktopNightlyTestsMetricsEvidence {
	readonly passed: boolean;
	readonly raw?: DesktopNightlyTestsMetricsRaw;
	readonly summary?: DesktopNightlyTestsMetricsSummary;
	readonly qualification?: DesktopNightlyTestsQualification | null;
}

export interface DesktopNightlyTestsMetricCollector {
	readonly workloadId: string;
	readonly parse: (output: string) => unknown;
	readonly evaluate: (
		diagnostic: unknown,
		config: Readonly<Record<string, unknown>>,
	) => Readonly<Record<string, unknown>>;
	readonly metricGatePassed: (result: Readonly<Record<string, unknown>>) => boolean;
}

export interface DesktopNightlyTestsMetricsWorkload extends Readonly<Record<string, unknown>> {
	readonly status: 'accepted' | 'failed' | 'pending-external';
	readonly metricGatePassed: boolean;
	readonly qualificationEvidencePublished: boolean;
	readonly evaluation: Readonly<{
		passed: boolean;
		failures: readonly string[];
		readonly [key: string]: unknown;
	}>;
}

export interface DesktopNightlyTestsMetricsRaw {
	readonly schemaVersion: 1;
	readonly kind: 'soundscaper-desktop-nightly-metrics-raw' | 'soundscaper-desktop-nightly-packaged-runtime-metrics-raw';
	readonly executionSurface: 'browser' | 'packaged-runtime';
	readonly sourceRevision: string | null;
	readonly budgetSha256: string;
	readonly diagnostics: Readonly<Record<string, unknown>>;
}

export interface DesktopNightlyTestsMetricsSummary {
	readonly schemaVersion: 1;
	readonly kind: 'soundscaper-desktop-nightly-metrics' | 'soundscaper-desktop-nightly-packaged-runtime-metrics';
	readonly executionSurface: 'browser' | 'packaged-runtime';
	readonly sourceRevision: string | null;
	readonly budgetSha256: string;
	readonly attemptCount: 1;
	readonly retryCount: 0;
	readonly workerCount: 1;
	readonly collectionPassed: boolean;
	readonly qualificationEvidencePublished: boolean;
	readonly workloads: readonly DesktopNightlyTestsMetricsWorkload[];
	readonly failures: readonly string[];
}

export interface DesktopNightlyTestsQualification extends Readonly<Record<string, unknown>> {
	readonly status: 'accepted' | 'rejected';
	readonly qualificationEvidencePublished: boolean;
}

export function createDesktopNightlyTestsMetricsPlan(options: {
	readonly executablePath: string;
	readonly payloadRoot: string;
	readonly runRoot: string;
	readonly baseURL: string;
	readonly esbuildBinaryPath?: string | null;
	readonly environment?: DesktopNightlyTestsEnvironment;
}): DesktopNightlyTestsPlaywrightPlan;

export function parseM1VideoPreviewDiagnostic(output: string): Readonly<Record<string, unknown>>;

export function createPendingM1VideoPreviewResult(
	diagnostic: Readonly<Record<string, unknown>>,
	config: Readonly<Record<string, unknown>>,
): Readonly<{
	readonly metricGatePassed: boolean;
	readonly metrics: Readonly<Record<string, number>>;
}>;

export function createDesktopNightlyTestsMetricsEvidence(
	options: {
		readonly consoleOutput: string;
		readonly config: Readonly<Record<string, unknown>>;
		readonly sourceRevision: string | null;
		readonly budgetSha256: string;
		readonly playwrightExit: DesktopNightlyTestsMetricsExit;
	},
	dependencies?: {
		readonly collectors?: readonly DesktopNightlyTestsMetricCollector[];
		readonly evidenceKind?: 'browser' | 'packaged-runtime';
	},
): {
	readonly passed: boolean;
	readonly raw: DesktopNightlyTestsMetricsRaw;
	readonly summary: DesktopNightlyTestsMetricsSummary;
	readonly qualification: DesktopNightlyTestsQualification | null;
};

export function writeDesktopNightlyTestsMetricsEvidence(
	options: {
		readonly payloadRoot: string;
		readonly runRoot: string;
		readonly sourceRevision: string | null;
		readonly playwrightExit: DesktopNightlyTestsMetricsExit;
		readonly consoleLogPath?: string;
		readonly artifactDirectory?: 'metrics' | 'packaged-runtime';
		readonly evidenceKind?: 'browser' | 'packaged-runtime';
	},
	dependencies?: {
		readonly collectors?: readonly DesktopNightlyTestsMetricCollector[];
		readonly evidenceKind?: 'browser' | 'packaged-runtime';
	},
): Promise<DesktopNightlyTestsMetricsEvidence>;

export function runDesktopNightlyTestsMetricsPhase(
	options: {
		readonly executablePath: string;
		readonly payloadRoot: string;
		readonly runRoot: string;
		readonly baseURL: string;
		readonly esbuildBinaryPath: string | null;
		readonly environment: DesktopNightlyTestsEnvironment;
		readonly sourceRevision: string | null;
	},
	dependencies: {
		readonly runPlaywright: (
			plan: DesktopNightlyTestsPlaywrightPlan,
		) => Promise<DesktopNightlyTestsMetricsExit>;
		readonly writeEvidence?: typeof writeDesktopNightlyTestsMetricsEvidence;
	},
): Promise<{
	readonly child: DesktopNightlyTestsMetricsExit;
	readonly evidence: DesktopNightlyTestsMetricsEvidence;
}>;
