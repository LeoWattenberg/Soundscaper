/* SPDX-License-Identifier: AGPL-3.0-only */

export async function createDesktopProjectLibrarySmokeEvidence(
	host,
	projectId,
	{ createMediaBinding, sourceBindingKey },
) {
	if (!host || typeof host.snapshot !== 'function' || typeof host.readCatalog !== 'function'
		|| typeof host.readProjectBundleById !== 'function' || typeof createMediaBinding !== 'function'
		|| typeof sourceBindingKey !== 'function') {
		throw new TypeError('Desktop project-library smoke evidence dependencies are unavailable');
	}
	const snapshot = host.snapshot();
	const catalog = host.readCatalog();
	const matches = catalog.projects.filter((project) => project.projectId === projectId);
	if (matches.length !== 1) throw new Error('Desktop smoke target catalog row is missing or duplicated');
	const bundle = await host.readProjectBundleById(projectId);
	if (!bundle || bundle.catalog.projectId !== projectId || bundle.project.id !== projectId
		|| bundle.catalog.projectRevision !== bundle.project.revision) {
		throw new Error('Desktop smoke target project bundle is missing or inconsistent');
	}
	const mediaById = new Map(bundle.media.map((media) => [media.id, media]));
	const sources = bundle.project.sources.map((source) => {
		const kind = source.kind;
		const encoding = kind === 'audio' ? 'audio-f32le-chunks-v1'
			: kind === 'video' ? 'video-original-v1' : null;
		if (!encoding || typeof source.id !== 'string' || typeof source.storageKey !== 'string') {
			throw new Error('Desktop smoke target has an unsupported source descriptor');
		}
		const binding = createMediaBinding(
			encoding, projectId, sourceBindingKey(source),
			bundle.catalog.projectRevision, bundle.catalog.sha256,
		);
		const media = mediaById.get(binding.id);
		if (!media) {
			throw new Error(
				`Desktop smoke target ${kind} managed media is missing at revision ${String(bundle.catalog.projectRevision)} (${binding.id.slice(0, 9)}; ${[...mediaById.keys()].map((id) => id.slice(0, 9)).join(',')})`,
			);
		}
		return Object.freeze({
			bindingId: media.id,
			byteLength: media.byteLength,
			encoding,
			kind,
			sha256: media.sha256,
			sourceId: source.id,
			storageKey: source.storageKey,
		});
	});
	return Object.freeze({
		host: snapshot,
		catalogRevision: catalog.revision,
		target: matches[0],
		project: Object.freeze({
			id: projectId,
			title: bundle.project.title,
			revision: bundle.catalog.projectRevision,
			sha256: bundle.catalog.sha256,
		}),
		sources: Object.freeze(sources),
	});
}
