/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep selected-V28 OpenFX frame authority out of the native-services composition root. */
export async function createFramescaperOpenFxFrameRegistration(options, dependencies = {}) {
	if (!options || typeof options.openFxService?.inventory !== 'function'
		|| typeof options.openFxService.execute !== 'function'
		|| typeof options.openFxService.qualifiedGpuBackends !== 'function'
		|| typeof options.currentProject !== 'function'
		|| typeof options.createMessageChannel !== 'function'
		|| typeof options.mintOpaqueId !== 'function') {
		throw new TypeError('OpenFX frame registration requires exact service and port seams.');
	}
	const [execution, transport] = dependencies.modules ?? await Promise.all([
		import('./project-library-runtime/desktop/framescaper-openfx-frame-execution.js'),
		import('./project-library-runtime/desktop/framescaper-openfx-frame-port.js'),
	]);
	const service = execution.createFramescaperOpenFxFrameExecutionService({
		inventory: () => options.openFxService.inventory(),
		qualifiedGpuBackends: () => options.openFxService.qualifiedGpuBackends(),
		execute: (request) => options.openFxService.execute(request),
		currentProject: async (plan, effect) => await options.currentProject(plan, effect) === true,
		timingAssets: (plan) => options.projectBodyAuthority?.openFxTimingAssets(plan)
			?? Promise.reject(new Error('OpenFX project timing authority is unavailable.')),
	});
	return transport.createFramescaperOpenFxFramePortBroker({
		service, createMessageChannel: options.createMessageChannel,
		mintOpaqueId: options.mintOpaqueId, reportError: options.onError,
	});
}

export function createFramescaperOpenFxCurrentProjectAuthority(authority) {
	return async ({ id, revision }, effect) => {
		const current = authority?.projectRecord(id);
		if (current?.projectId !== id || current.projectRevision !== revision) return false;
		if (effect === undefined) return true;
		const bundle = await authority.readProjectBundle(id);
		if (bundle?.project?.projectRevision !== revision
			|| bundle.project.sha256 !== current.projectSha256
			|| typeof bundle.document !== 'string') return false;
		let document;
		try { document = JSON.parse(bundle.document); } catch { return false; }
		return document?.schemaVersion === 28 && document.id === id && document.revision === revision
			&& Array.isArray(document.ofxEffects) && document.ofxEffects.filter((candidate) => (
				candidate?.instanceId === effect.instanceId
				&& JSON.stringify(candidate) === JSON.stringify(effect)
			)).length === 1;
	};
}
