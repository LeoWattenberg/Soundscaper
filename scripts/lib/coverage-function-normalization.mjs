/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * c8 can map the same source function twice when Node loads its TypeScript
 * source and Chromium loads a minified chunk. The two mappings have the same
 * source span but different names and starting columns. Count that source
 * function once, with execution from either runtime.
 */
export function normalizeDuplicateFunctionCoverage(summary, detailed) {
	const normalized = { ...summary };
	for (const [path, file] of Object.entries(detailed)) {
		if (!summary[path] || !file?.fnMap || !file?.f) continue;
		const groups = new Map();
		for (const [id, functionInfo] of Object.entries(file.fnMap)) {
			const { start, end } = functionInfo.loc;
			const key = `${start.line}:${end.line}:${end.column}`;
			const group = groups.get(key) ?? [];
			group.push({ id, name: functionInfo.name, column: start.column });
			groups.set(key, group);
		}
		let removed = 0;
		let removedCovered = 0;
		for (const group of groups.values()) {
			if (group.length !== 2) continue;
			const alias = group.find(({ name, column }) =>
				(column === 0 && /^[A-Za-z_$]$/u.test(name))
				|| (column === 1 && name === '<instance_members_initializer>'));
			const source = group.find(({ id }) => id !== alias?.id);
			if (!alias || !source || source.column !== (alias.column === 0 ? 7 : 10)
				|| (alias.name === '<instance_members_initializer>'
					? source.name !== alias.name : source.name.length <= 1)) continue;
			removed += 1;
			if (file.f[alias.id] > 0 && file.f[source.id] > 0) removedCovered += 1;
		}
		if (removed === 0) continue;
		const functions = summary[path].functions;
		const total = functions.total - removed;
		const covered = functions.covered - removedCovered;
		normalized[path] = {
			...summary[path],
			functions: {
				...functions,
				total,
				covered,
				pct: total === 0 ? 100 : Math.round(10000 * covered / total) / 100,
			},
		};
	}
	return normalized;
}
