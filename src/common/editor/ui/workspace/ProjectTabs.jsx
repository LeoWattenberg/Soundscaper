

export default function ProjectTabs({ projects, activeProjectId, copy, disabled, onSelect, onNew }) {
	const unique = [];
	const seen = new Set();
	for (const project of projects || []) {
		if (!project?.id || seen.has(project.id)) continue;
		seen.add(project.id);
		unique.push(project);
	}
	return (
		<nav className="kw-audio-editor__project-tabs" aria-label={copy.projectTabs}>
			<div role="tablist" aria-label={copy.projectTabs}>
				{unique.map((project) => <button
					key={project.id}
					type="button"
					role="tab"
					aria-selected={project.id === activeProjectId}
					disabled={disabled}
					onClick={() => onSelect(project.id)}
				>{project.title}</button>)}
			</div>
			<button type="button" className="kw-audio-editor__project-tab-new" disabled={disabled} onClick={onNew} aria-label={copy.newProject}>+</button>
		</nav>
	);
}
