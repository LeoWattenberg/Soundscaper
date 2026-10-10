/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PluginScanSupervisorPort } from './plugin-scan-service.ts';
import type { HelperJobRequest } from './helper-supervisor.ts';

/** The renderer sees only a format and fraction, never the helper's path authority. */
export function createPluginScanProgressSupervisor(supervisor: PluginScanSupervisorPort) {
	let snapshot: Readonly<{ format: string; progress: number | null }> | null = null;
	const monitored: PluginScanSupervisorPort = Object.freeze({
		async runJob(request: HelperJobRequest<'plugin-scan'>) {
			const active = Object.freeze({ format: request.grant.format, progress: null });
			const tracked = snapshot === null;
			if (tracked) snapshot = active;
			try {
				return await supervisor.runJob({ ...request, onProgress: (progress) => {
					if (tracked) snapshot = Object.freeze({ format: request.grant.format, progress });
					request.onProgress?.(progress);
				} });
			} finally {
				if (tracked) snapshot = null;
			}
		},
		snapshot: () => supervisor.snapshot(),
		clearQuarantine: () => supervisor.clearQuarantine(),
		dispose: () => supervisor.dispose(),
	});
	return Object.freeze({ supervisor: monitored, getSnapshot: () => snapshot });
}
