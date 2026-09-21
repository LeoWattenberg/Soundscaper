/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Exercises the packaged, sandbox-preloaded capture control plane without
 * enumerating or opening a physical capture device. The authority is retired
 * before evidence is returned; failure after grant creation also attempts the
 * same teardown.
 */
export async function runFramescaperCaptureArtifactRendererSmoke(scope) {
	const fail = (message) => { throw new Error(`Framescaper packaged capture smoke ${message}`); };
	const exactKeys = (value, keys, label) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)
			|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
			fail(`requires the exact ${label}`);
		}
		return value;
	};
	const preloadBridge = ['grant', 'listSources', 'status', 'teardown'];
	const bridge = exactKeys(
		scope?.framescaperCaptureDesktop?.v1,
		preloadBridge,
		'capture preload bridge',
	);
	if (preloadBridge.some((key) => typeof bridge[key] !== 'function')) {
		fail('requires callable capture preload methods');
	}
	const status = exactKeys(await bridge.status(), [
		'version', 'available', 'unavailableReason', 'selectionMode', 'systemAudio',
		'sourceLimit', 'sourceListTtlMs', 'grantTtlMs',
	], 'capture status');
	if (status.version !== 1 || status.available !== true || status.unavailableReason !== null
		|| !['source-list', 'system-picker'].includes(status.selectionMode)
		|| !['windows-loopback', 'unavailable'].includes(status.systemAudio)
		|| status.sourceLimit !== 64 || status.sourceListTtlMs !== 300_000
		|| status.grantTtlMs !== 15_000) {
		fail('received an unavailable or invalid capture status');
	}

	const generation = 1;
	let grantIssued = false;
	try {
		const grant = await bridge.grant({
			generation,
			roles: ['camera', 'microphone'],
			sourceToken: null,
		});
		grantIssued = true;
		exactKeys(grant, ['grantId', 'generation', 'expiresAtMs', 'roles'], 'capture grant');
		if (typeof grant.grantId !== 'string' || !/^[a-f0-9]{32}$/u.test(grant.grantId)
			|| grant.generation !== generation || !Number.isSafeInteger(grant.expiresAtMs)
			|| grant.expiresAtMs < 0
			|| JSON.stringify(grant.roles) !== '["camera","microphone"]') {
			fail('received an invalid capture grant');
		}
		const retired = await bridge.teardown(generation);
		if (retired !== true) fail('did not retire its capture grant');
		grantIssued = false;
		const retiredAgain = await bridge.teardown(generation);
		if (retiredAgain !== false) fail('capture grant did not retire exactly once');
		return {
			preloadBridge,
			status: {
				version: status.version,
				available: status.available,
				unavailableReason: status.unavailableReason,
				selectionMode: status.selectionMode,
				systemAudio: status.systemAudio,
				sourceLimit: status.sourceLimit,
				sourceListTtlMs: status.sourceListTtlMs,
				grantTtlMs: status.grantTtlMs,
			},
			grant: {
				generation,
				expiresAtMs: grant.expiresAtMs,
				roles: ['camera', 'microphone'],
				opaqueId: true,
			},
			teardown: { retired, retiredAgain },
		};
	} finally {
		if (grantIssued) {
			try { await bridge.teardown(generation); } catch { /* The process exit barrier also disposes the port. */ }
		}
	}
}
