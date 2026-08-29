/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Arm a page-owned latency probe before Playwright dispatches an interaction.
 * Both timestamps are taken in the renderer, so runner/CDP round trips cannot
 * inflate the observation.
 */
export function armInteractionToAttributeLatencyProbe({
	actionTarget,
	observedTarget,
	eventType,
	attributeName,
	expectedValue,
}) {
	if (!(actionTarget && typeof actionTarget.addEventListener === 'function')) {
		throw new TypeError('The latency probe action target is unavailable.');
	}
	if (!(observedTarget && typeof observedTarget.getAttribute === 'function')) {
		throw new TypeError('The latency probe observation target is unavailable.');
	}
	const probeId = `soundscaper-interaction-${String(Math.random()).slice(2)}`;
	const registryKey = '__soundscaperInteractionToAttributeLatencyProbes';
	const registry = observedTarget[registryKey] ?? new Map();
	observedTarget[registryKey] = registry;
	let startedAt = null;
	const state = {
		elapsedMs: null,
		error: null,
		settle: null,
	};
	const cleanup = () => {
		actionTarget.removeEventListener(eventType, start, true);
		observer.disconnect();
	};
	const complete = () => {
		if (startedAt === null || observedTarget.getAttribute(attributeName) !== expectedValue) return;
		state.elapsedMs = performance.now() - startedAt;
		cleanup();
		state.settle?.();
	};
	const start = () => {
		if (startedAt !== null) return;
		startedAt = performance.now();
		complete();
	};
	const observer = new MutationObserver((records) => {
		if (records.some((record) => (
			record.type === 'attributes' && record.attributeName === attributeName
		))) complete();
	});
	actionTarget.addEventListener(eventType, start, true);
	observer.observe(observedTarget, { attributes: true, attributeFilter: [attributeName] });
	registry.set(probeId, { state, cleanup });
	return probeId;
}

/** Resolve an armed probe, retaining only the in-page interaction-to-state delta. */
export function readInteractionToAttributeLatencyProbe({
	observedTarget,
	probeId,
	timeoutMs,
}) {
	const registryKey = '__soundscaperInteractionToAttributeLatencyProbes';
	const registry = observedTarget?.[registryKey];
	const probe = registry?.get(probeId);
	if (!probe) throw new Error('The armed interaction latency probe is unavailable.');
	const finish = () => {
		probe.cleanup();
		registry.delete(probeId);
		if (registry.size === 0) delete observedTarget[registryKey];
	};
	if (probe.state.elapsedMs !== null) {
		const elapsedMs = probe.state.elapsedMs;
		finish();
		return Promise.resolve(elapsedMs);
	}
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			finish();
			reject(new Error(`The in-page interaction did not publish its expected state within ${String(timeoutMs)} ms.`));
		}, timeoutMs);
		probe.state.settle = () => {
			clearTimeout(timer);
			const elapsedMs = probe.state.elapsedMs;
			finish();
			resolve(elapsedMs);
		};
	});
}
