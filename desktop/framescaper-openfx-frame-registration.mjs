/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep baseline OpenFX frame authority out of the native-services composition root. */
export async function createFramescaperOpenFxFrameRegistration(options, dependencies = {}) {
	if (!options || typeof options.openFxService?.inventory !== 'function'
		|| typeof options.openFxService.execute !== 'function'
		|| typeof options.openFxService.supportedGpuBackends !== 'function'
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
		supportedGpuBackends: () => options.openFxService.supportedGpuBackends(),
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
	if (authority === null) return async () => false;
	assertFramescaperIdentity(authority, 'OpenFX project authority');
	return async (project, effect) => {
		if (!currentFramescaperIdentity(project)) return false;
		const { id, revision } = project;
		const current = authority?.projectRecord(id);
		if (!currentFramescaperIdentity(current) || current.projectId !== id
			|| current.projectRevision !== revision) return false;
		if (effect === undefined) return true;
		const bundle = await authority.readProjectBundle(id);
		if (!currentFramescaperIdentity(bundle?.project)
			|| bundle.project.projectRevision !== revision
			|| bundle.project.sha256 !== current.projectSha256
			|| typeof bundle.document !== 'string') return false;
		let document;
		try { document = JSON.parse(bundle.document); } catch { return false; }
		return currentFramescaperIdentity(document) && document.id === id && document.revision === revision
			&& Array.isArray(document.ofxEffects) && document.ofxEffects.filter((candidate) => (
				candidate?.instanceId === effect.instanceId
				&& JSON.stringify(candidate) === JSON.stringify(effect)
			)).length === 1;
	};
}

function currentFramescaperIdentity(value) {
	try { assertFramescaperIdentity(value, 'OpenFX project'); return true; }
	catch { return false; }
}

function assertFramescaperIdentity(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must carry a project schema identity.`);
	}
	const family = Object.getOwnPropertyDescriptor(value, 'schemaFamily');
	const version = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!family?.enumerable || !Object.hasOwn(family, 'value')
		|| !version?.enumerable || !Object.hasOwn(version, 'value')
		|| family.value !== 'framescaper' || version.value !== 1) {
		throw new TypeError(`${label} requires the exact Framescaper v1 identity.`);
	}
}
