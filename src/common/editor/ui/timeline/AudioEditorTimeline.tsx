import type { EditorController, EditorSnapshot } from '../../types.ts';
import TimelineController from './TimelineController.jsx';

interface TimelineSearchRevealRequest {
	readonly clipId?: string;
	readonly revision?: number;
}

interface AudioEditorTimelineProps {
	readonly controller: EditorController;
	readonly snapshot: EditorSnapshot;
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly mobile: boolean;
	readonly showArmControls: boolean;
	readonly displayAudioSupported: boolean;
	readonly splitToolEnabled?: boolean;
	readonly automationToolEnabled?: boolean;
	readonly onToggleSplitTool?: () => void;
	readonly onError: (error: unknown) => void;
	readonly onOpenEffects?: (...args: readonly unknown[]) => void;
	readonly onOpenClipProperties?: (clipId: string) => void;
	readonly onExportClip?: (clipId: string) => void;
	readonly onRevealProjectBin?: () => void;
	readonly onToggleArmControls?: () => void;
	readonly searchRevealRequest?: TimelineSearchRevealRequest | null;
	readonly overlayTarget?: Element | null;
}

export default function AudioEditorTimeline({
	controller,
	snapshot,
	locale,
	copy,
	mobile,
	showArmControls,
	displayAudioSupported,
	splitToolEnabled = false,
	automationToolEnabled = false,
	onToggleSplitTool,
	onError,
	onOpenEffects,
	onOpenClipProperties,
	onExportClip,
	onRevealProjectBin,
	onToggleArmControls,
	searchRevealRequest = null,
	overlayTarget = null,
}: AudioEditorTimelineProps) {
	const geometry = { mobile, showArmControls, displayAudioSupported };
	const selection = { searchRevealRequest };
	const preview = { overlayTarget };
	const navigation = { splitToolEnabled, automationToolEnabled };
	const actions = {
		onToggleSplitTool,
		onError,
		onOpenEffects,
		onOpenClipProperties,
		onExportClip,
		onRevealProjectBin,
		onToggleArmControls,
	};

	return (
		<TimelineController
			controller={controller}
			snapshot={snapshot}
			locale={locale}
			copy={copy}
			geometry={geometry}
			selection={selection}
			preview={preview}
			navigation={navigation}
			actions={actions}
		/>
	);
}
