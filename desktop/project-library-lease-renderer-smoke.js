/* SPDX-License-Identifier: AGPL-3.0-only */
/* global __SCAPE_RENDERER_SMOKE_PRODUCT__:readonly */

export async function runDesktopProjectLibraryLeaseRendererSmoke(scope, plan) {
	const api = (typeof __SCAPE_RENDERER_SMOKE_PRODUCT__ === 'undefined'
		? plan.productId : __SCAPE_RENDERER_SMOKE_PRODUCT__) === 'framescaper'
		? scope?.framescaperDesktop?.v1?.projectLibrary
		: scope?.soundscaperProjectLibraryDesktop?.v1;
	if (!api) throw new Error(`${plan.productId} lease smoke bridge is unavailable`);
	await api.connect();
	const catalog = await api.listProjects();
	const bundle = await api.readProjectBundle(plan.projectId);
	const observed = {
		metadataRevision: catalog.metadataRevision,
		projectRevision: bundle === null ? null : bundle.project.projectRevision,
		projectSha256: bundle === null ? null : bundle.project.sha256,
	};
	if (plan.action === 'observe-hold' || plan.action === 'verify') {
		return { status: 'observed', ...observed, document: bundle === null ? null : bundle.document };
	}
	// Publish against exactly the base this case read. Main arbitrates the
	// compare-and-swap, so contenders that read the same base race there rather
	// than being pre-screened here. A contender publishes against the base the
	// matrix handed it instead, so the one that arrives after the winner is the
	// loser main refuses.
	const expectedProject = bundle === null ? null : {
		projectRevision: plan.action === 'commit-contend'
			? plan.request.expectedRevision
			: bundle.project.projectRevision,
		projectSha256: bundle.project.sha256,
	};
	if ((plan.request.expectedRevision === null) !== (expectedProject === null)) {
		return { status: 'conflict', ...observed, reason: 'destination-presence' };
	}
	const publicationId = publicationIdFor(scope);
	const framescaper = plan.productId === 'framescaper';
	const writeFence = framescaper && bundle !== null ? await api.claimProjectWriteFence(plan.projectId) : null;
	try {
		const admission = await api.beginPublication({
			publicationId,
			expectedMetadataRevision: catalog.metadataRevision,
			expectedProject,
			...(writeFence ? { writeFence, expectedDocument: JSON.parse(bundle.document) } : {}),
			project: JSON.parse(plan.request.document),
			bodies: [],
		});
		if (admission === null) return { status: 'conflict', ...observed, reason: 'compare-and-swap' };
	} catch (error) {
		return refusal(error);
	}
	try {
		const result = await api.finishPublication({ publicationId });
		if (result === null) return { status: 'conflict', ...observed, reason: 'compare-and-swap' };
		return {
			status: 'committed',
			metadataRevision: result.metadataRevision,
			projectRevision: result.project.projectRevision,
			projectSha256: result.project.sha256,
			document: result.document,
		};
	} catch (error) {
		await api.abortPublication({ publicationId }).catch(() => false);
		return refusal(error);
	}

	function publicationIdFor(globalScope) {
		const bytes = new Uint8Array(24);
		globalScope.crypto.getRandomValues(bytes);
		return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Only the refusals main arbitrates are outcomes of the workflow. Anything
	 * else — a fenced host, a closed session, a failed write — is a defect the
	 * matrix must see rather than a contender that lost fairly.
	 */
	function refusal(error) {
		const message = String(error && error.message ? error.message : error);
		const reason = /failed compare-and-swap/u.test(message) ? 'compare-and-swap'
			: /expected an absent project/u.test(message) ? 'destination-presence'
				: /requires a strictly higher project revision/u.test(message) ? 'revision-order' : null;
		if (reason === null) throw error;
		return { status: 'conflict', ...observed, reason };
	}
}
