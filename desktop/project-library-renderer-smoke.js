/* SPDX-License-Identifier: AGPL-3.0-only */

export async function runProjectLibraryRendererSmoke(scope, plan) {
	const currentProjectSchemaVersion = 11;
	const api = scope?.scapeDesktop?.v1;
	if (!api || typeof api.readSharedProject !== 'function'
		|| typeof api.commitSharedProject !== 'function'
		|| typeof api.listSharedProjects !== 'function') {
		throw new Error('Packaged project-library bridge is incomplete');
	}
	const digest = async (text) => {
		const bytes = new scope.TextEncoder().encode(text);
		const value = await scope.crypto.subtle.digest('SHA-256', bytes);
		return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	};
	const validate = async (document, expected, label) => {
		if (typeof document !== 'string') throw new Error(`${label} is not a canonical project document`);
		let project;
		try { project = JSON.parse(document); } catch { throw new Error(`${label} is not a canonical project document`); }
		if (JSON.stringify(project) !== document) throw new Error(`${label} is not a canonical project document`);
		if (!project || typeof project !== 'object' || Array.isArray(project)
			|| project.schemaVersion !== currentProjectSchemaVersion || project.id !== expected.id
			|| project.title !== expected.title || project.revision !== expected.revision
			|| !Array.isArray(project.timelineAnnotations)) {
			throw new Error(`${label} does not match its project descriptor`);
		}
		if (!Array.isArray(project.sources) || project.sources.length !== 0
			|| !Array.isArray(project.clips) || project.clips.length !== 0
			|| (project.tracks !== undefined && (!Array.isArray(project.tracks) || project.tracks.length !== 0))
			|| !project.projectBin || !Array.isArray(project.projectBin.clips)
			|| project.projectBin.clips.length !== 0) throw new Error(`${label} must remain source-free`);
		if (await digest(document) !== expected.sha256) throw new Error(`${label} SHA-256 changed before handoff`);
	};
	const current = await api.readSharedProject(plan.target.id);
	if (plan.previous === null) {
		if (current !== null) throw new Error('Publish target already exists before handoff');
	} else await validate(current, plan.previous, 'Previous shared project');
	await validate(plan.target.document, plan.target, 'Target shared project');
	const commitResult = await api.commitSharedProject({
		document: plan.target.document,
		expectedRevision: plan.previous?.revision ?? null,
	});
	if (commitResult?.status !== 'committed') throw new Error('Target shared project commit conflicted');
	await validate(commitResult.document, plan.target, 'Committed shared project');
	await validate(await api.readSharedProject(plan.target.id), plan.target, 'Reread shared project');
	const summaries = await api.listSharedProjects();
	const matches = Array.isArray(summaries)
		? summaries.filter((candidate) => candidate?.id === plan.target.id) : [];
	if (matches.length !== 1) throw new Error('Shared project summary is missing or duplicated');
	const summary = matches[0];
	if (summary.title !== plan.target.title || summary.revision !== plan.target.revision) {
		throw new Error('Shared project summary does not match the committed target');
	}
	return { summary: { id: summary.id, title: summary.title, revision: summary.revision } };
}
