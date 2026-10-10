import { useRef } from 'react';

export type MetadataEditorTab = 'general' | 'id3' | 'sequence' | 'bext' | 'adm' | 'attribution';

interface MetadataEditorTabsProps {
	readonly activeTab: MetadataEditorTab;
	readonly showBext: boolean;
	readonly showId3?: boolean;
	readonly showSequence?: boolean;
	readonly showAdm?: boolean;
	readonly showAttribution?: boolean;
	readonly attributionLabel?: string;
	readonly sequenceLabel?: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly onChange: (tab: MetadataEditorTab) => void;
}

export function MetadataEditorTabs({
	activeTab,
	showBext,
	showId3 = false,
	showSequence = false,
	showAdm = false,
	showAttribution = false,
	copy,
	attributionLabel = copy.metadataTab,
	sequenceLabel = copy.sequenceTiming,
	onChange,
}: MetadataEditorTabsProps) {
	const tabListRef = useRef<HTMLDivElement>(null);
	const tabs: readonly Readonly<{ id: MetadataEditorTab; label: string }>[] = [
		{ id: 'general', label: copy.metadataGeneralTab },
		...(showId3 ? [{ id: 'id3' as const, label: 'ID3' }] : []),
		...(showSequence ? [{ id: 'sequence' as const, label: sequenceLabel }] : []),
		...(showBext ? [{ id: 'bext' as const, label: copy.metadataBextTab }] : []),
		...(showAdm ? [{ id: 'adm' as const, label: copy.metadataAdmTab }] : []),
		...(showAttribution ? [{ id: 'attribution' as const, label: attributionLabel }] : []),
	];
	const selectRelativeTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const forward = window.getComputedStyle(event.currentTarget).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
		const nextIndex = event.key === 'Home'
			? 0
			: event.key === 'End'
				? tabs.length - 1
				: (index + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length;
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
