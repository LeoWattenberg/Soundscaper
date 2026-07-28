import { useRef } from 'react';

export type MetadataEditorTab = 'general' | 'bext';

interface MetadataEditorTabsProps {
	readonly activeTab: MetadataEditorTab;
	readonly showBext: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly onChange: (tab: MetadataEditorTab) => void;
}

export function MetadataEditorTabs({ activeTab, showBext, copy, onChange }: MetadataEditorTabsProps) {
	const tabListRef = useRef<HTMLDivElement>(null);
	const tabs: readonly Readonly<{ id: MetadataEditorTab; label: string }>[] = [
		{ id: 'general', label: copy.metadataGeneralTab },
		...(showBext ? [{ id: 'bext' as const, label: copy.metadataBextTab }] : []),
	];
	const selectRelativeTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const nextIndex = event.key === 'Home'
			? 0
			: event.key === 'End'
				? tabs.length - 1
				: (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
		onChange(tabs[nextIndex].id);
		queueMicrotask(() => tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus());
	};
	return (
		<div ref={tabListRef} className="audio-editor-metadata-tabs" role="tablist" aria-label={copy.metadataSections}>
			{tabs.map((tab, index) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					aria-selected={activeTab === tab.id}
					tabIndex={activeTab === tab.id ? 0 : -1}
					onClick={() => onChange(tab.id)}
					onKeyDown={(event) => selectRelativeTab(event, index)}
				>{tab.label}</button>
			))}
		</div>
	);
}

export default MetadataEditorTabs;
