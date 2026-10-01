import type {
	DesktopNightlyTestsItemProgress,
	DesktopNightlyTestsPlaywrightPlan,
} from './desktop-nightly-tests-runtime.mjs';

export function runDesktopNightlyTestsPlaywrightChild(
	plan: DesktopNightlyTestsPlaywrightPlan,
	onItems?: (progress: DesktopNightlyTestsItemProgress) => void,
): Promise<{ readonly code: number | null; readonly signal: string | null }>;
