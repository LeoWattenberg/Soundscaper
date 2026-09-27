/* SPDX-License-Identifier: AGPL-3.0-only */

import { releaseLiveAnalysisTap } from './live-analysis-tap.ts';
import { ENGINE_ASSERT_ACTIVE } from './runtime-symbols.ts';
import type { EngineRuntimeMethodMap } from './runtime-types.ts';

/** Reference-counted panel visibility; graph work begins on the shared meter tick. */
export const engineLiveAnalysisLeaseMethods = {
	acquireLiveAnalysis() {
		this[ENGINE_ASSERT_ACTIVE]();
		this.liveAnalysisLeaseCount += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.liveAnalysisLeaseCount = Math.max(0, this.liveAnalysisLeaseCount - 1);
			if (this.liveAnalysisLeaseCount === 0) releaseLiveAnalysisTap(this.graph);
		};
	},
} satisfies EngineRuntimeMethodMap<'acquireLiveAnalysis'>;
