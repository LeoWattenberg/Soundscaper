import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import type { DesktopNightlyTestsItemProgress } from './desktop-nightly-tests-runtime.mjs';

export const DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER: 'SOUNDSCAPER_NIGHTLY_TESTS_ITEMS ';
type ReporterTest = Pick<TestCase, 'id' | 'expectedStatus' | 'retries' | 'titlePath'>;

export default class DesktopNightlyTestsProgressReporter {
	constructor(options?: { readonly output?: { write(value: string): unknown } });
	onBegin(config: Partial<FullConfig>, suite: { allTests(): readonly ReporterTest[] }): void;
	onTestBegin(test: ReporterTest, result: Pick<TestResult, 'retry'>): void;
	onTestEnd(test: ReporterTest, result: Pick<TestResult, 'retry' | 'status'>): void;
	onEnd(result: Pick<FullResult, 'status'>): void;
}

export function createDesktopNightlyTestsItemProgressReader(
	onProgress: (progress: DesktopNightlyTestsItemProgress) => void,
): Readonly<{
	write(chunk: string | Uint8Array): void;
	finish(): void;
}>;
