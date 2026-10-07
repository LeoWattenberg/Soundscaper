/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import type { VampAnalyzerDescriptor, VampOutputDescriptor } from '../../vamp-analysis.ts';

/** Normalized analyzer catalog identity owns these first-match lookup tables. */
export function useAnalyzerLookup(analyzers: readonly Readonly<VampAnalyzerDescriptor>[]) {
	return useMemo(() => {
		const byId = new Map<string, Readonly<VampAnalyzerDescriptor>>();
		const outputs = new Map<Readonly<VampAnalyzerDescriptor>, ReadonlyMap<string, Readonly<VampOutputDescriptor>>>();
		for (const analyzer of analyzers) {
			if (!byId.has(analyzer.analyzerId)) byId.set(analyzer.analyzerId, analyzer);
			const byOutput = new Map<string, Readonly<VampOutputDescriptor>>();
			for (const output of analyzer.outputs) if (!byOutput.has(output.id)) byOutput.set(output.id, output);
			outputs.set(analyzer, byOutput);
		}
		return { analyzers: byId as ReadonlyMap<string, Readonly<VampAnalyzerDescriptor>>, outputs: outputs as ReadonlyMap<Readonly<VampAnalyzerDescriptor>, ReadonlyMap<string, Readonly<VampOutputDescriptor>>> };
	}, [analyzers]);
}

