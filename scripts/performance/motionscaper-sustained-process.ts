/* SPDX-License-Identifier: AGPL-3.0-only */
export interface MotionProcessIdentity { readonly pid: number; readonly parentPid: number; readonly startTicks: string }

/** Linux comm may contain both spaces and parentheses; numeric fields start after the final ')'. */
export function parseMotionProcessStat(text: string): MotionProcessIdentity {
	const match = /^(\d+) \([\s\S]*\) ([A-Za-z]) (.*)$/u.exec(text.trim());
	if (!match) throw new Error('Invalid Linux process stat.');
	const fields = [match[2]!, ...match[3]!.split(/\s+/u)];
	const pid = Number(match[1]), parentPid = Number(fields[1]), startTicks = fields[19];
	if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(parentPid) || parentPid < 0
		|| !startTicks || !/^[1-9]\d*$/u.test(startTicks)) throw new Error('Invalid Linux process stat identity.');
	return Object.freeze({ pid, parentPid, startTicks });
}
export function parseMotionProcessMemory(text: string): Readonly<{ rssBytes: number; pssBytes: number }> {
	const read = (name: string) => {
		const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, 'mu').exec(text);
		const value = match ? Number(match[1]) * 1024 : NaN;
		if (!Number.isSafeInteger(value) || value < 0) throw new Error('Missing or invalid Linux RSS/PSS observation.');
		return value;
	};
	return Object.freeze({ rssBytes: read('Rss'), pssBytes: read('Pss') });
}
const identity = (value: MotionProcessIdentity) => `${value.pid}:${value.startTicks}`;

/** Retain ownership of an orphaned child, but never inherit its recycled PID. */
export function selectMotionOwnedProcesses(current: readonly MotionProcessIdentity[], root: MotionProcessIdentity,
	previous: readonly MotionProcessIdentity[]): readonly MotionProcessIdentity[] {
	if (new Set(current.map(value => value.pid)).size !== current.length) throw new Error('Duplicate process observation.');
	const admitted = new Set([identity(root), ...previous.map(identity)]);
	const result = current.filter(value => admitted.has(identity(value)));
	const pids = new Set(result.map(value => value.pid));
	let changed = true;
	while (changed) {
		changed = false;
		for (const value of current) if (!pids.has(value.pid) && pids.has(value.parentPid)) {
			result.push(value); pids.add(value.pid); changed = true;
		}
	}
	return Object.freeze(result.sort((a, b) => a.pid - b.pid));
}
