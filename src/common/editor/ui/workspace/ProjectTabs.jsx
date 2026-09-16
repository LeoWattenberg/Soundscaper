import { useEffect, useId, useRef } from 'react';

export default function ProjectTabs({ projects, activeProjectId, copy, disabled, onSelect, onClose, onNew }) {
	const tabListRef = useRef(null);
	const tabListId = useId();
	const closingProjectRef = useRef(null);
	useEffect(() => {
		const closing = closingProjectRef.current;
		if (!closing || closing.isConnected) return;
		closingProjectRef.current = null;
		const ownerDocument = closing.ownerDocument;
		if (ownerDocument.activeElement === ownerDocument.body) {
			tabListRef.current?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
		}
	}, [projects]);
	const unique = [];
	const tabIds = [];
	const seen = new Set();
	for (const project of projects || []) {
		if (!project?.id || seen.has(project.id)) continue;
		seen.add(project.id);
		tabIds.push(`${tabListId}-${unique.length}`);
		unique.push(project);
	}
	const focusableProjectId = seen.has(activeProjectId)
		? activeProjectId
		: unique[0]?.id;
	const handleTabKeyDown = (event, index) => {
		const nextIndex = {
			ArrowRight: index + 1, ArrowLeft: index - 1 + unique.length,
			Home: 0, End: unique.length - 1,
		}[event.key] % unique.length;
		const next = unique[nextIndex];
		if (!next) return;
		event.preventDefault();
		if (nextIndex !== index) onSelect(next.id);
		requestAnimationFrame(() => {
			tabListRef.current?.querySelectorAll('[role="tab"]')[nextIndex]?.focus({ preventScroll: true });
		});
	};
	return (
		<nav className="kw-audio-editor__project-tabs" aria-label={copy.projectTabs}>
			{/* Own only selection tabs, keeping each adjacent close button independently accessible. */}
			<div role="tablist" aria-label={copy.projectTabs} className="kw-audio-editor-sr-only"
				aria-owns={tabIds.join(' ')} />
			<div ref={tabListRef} className="kw-audio-editor__project-tab-strip">
				{unique.map((project, index) => <div key={project.id} role="presentation" className="kw-audio-editor__project-tab">
					<button
						type="button"
						role="tab"
						id={tabIds[index]}
						aria-selected={project.id === activeProjectId}
						tabIndex={project.id === focusableProjectId ? 0 : -1}
						disabled={disabled}
						onClick={() => onSelect(project.id)}
						onKeyDown={(event) => handleTabKeyDown(event, index)}
					>{project.title}</button>
					<button
						type="button"
						className="kw-audio-editor__project-tab-close"
						aria-label={`${copy.closeProject}: ${project.title}`}
						title={copy.closeProject}
						tabIndex={project.id === focusableProjectId ? 0 : -1}
						disabled={disabled}
						onClick={(event) => {
							closingProjectRef.current = event.currentTarget;
							onClose(project.id);
						}}
					>×</button>
				</div>)}
			</div>
			<button type="button" className="kw-audio-editor__project-tab-new" disabled={disabled} onClick={onNew} aria-label={copy.newProject}>+</button>
		</nav>
	);
}
