import type { EditorController, EditorSnapshot } from '../../types.ts';
import type { SoundscaperProductionWorkspaceRuntime } from '../workspace/useSoundscaperProductionWorkspace.ts';
import TimelineController from './TimelineController.jsx';

interface TimelineSearchRevealRequest {
	readonly clipId?: string;
	readonly revision?: number;
}

interface AudioEditorTimelineProps {
	readonly controller: EditorController;
	readonly snapshot: EditorSnapshot;
	readonly runtimeProject?: Readonly<Record<string, unknown>> | null;
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly mobile: boolean;
	readonly showArmControls: boolean;
	readonly displayAudioSupported: boolean;
	readonly productId: string;
	readonly capabilities: Readonly<Record<string, unknown>>;
	readonly splitToolEnabled?: boolean;
	readonly automationToolEnabled?: boolean;
	readonly spectralBrushEnabled?: boolean;
	readonly onToggleSplitTool?: () => void;
	readonly onError: (error: unknown) => void;
	readonly onOpenEffects?: (...args: readonly unknown[]) => void;
	readonly onOpenClipProperties?: (clipId: string) => void;
	readonly onExportClip?: (clipId: string) => void;
	readonly onRevealProjectBin?: () => void;
	readonly onToggleArmControls?: () => void;
	readonly onOpenSurface?: (surface: string) => void;
	readonly onOpenTrackRate?: (track: Readonly<Record<string, unknown>>) => void;
	readonly soundscaperProduction?: Readonly<SoundscaperProductionWorkspaceRuntime> | null;
	readonly searchRevealRequest?: TimelineSearchRevealRequest | null;
	readonly overlayTarget?: Element | null;
}

export default function AudioEditorTimeline({
	controller,
	snapshot,
	runtimeProject = null,
	locale,
	copy,
	mobile,
	showArmControls,
	displayAudioSupported,
	productId,
	capabilities,
	splitToolEnabled = false,
	automationToolEnabled = false,
	spectralBrushEnabled = false,
	onToggleSplitTool,
	onError,
	onOpenEffects,
	onOpenClipProperties,
	onExportClip,
	onRevealProjectBin,
	onToggleArmControls,
	onOpenSurface,
	onOpenTrackRate,
	soundscaperProduction = null,
	searchRevealRequest = null,
	overlayTarget = null,
}: AudioEditorTimelineProps) {
	const geometry = { mobile, showArmControls, displayAudioSupported };
	const selection = { searchRevealRequest };
	const preview = { overlayTarget };
	const navigation = { splitToolEnabled, automationToolEnabled, spectralBrushEnabled };
	const actions = {
		onToggleSplitTool,
		onError,
		onOpenEffects,
		onOpenClipProperties,
		onExportClip,
		onRevealProjectBin,
		onToggleArmControls,
		onOpenSurface,
		onOpenTrackRate,
		soundscaperProduction,
		productId,
		capabilities,
	};

	return (
		<TimelineController
			controller={controller}
			snapshot={snapshot}
			runtimeProject={runtimeProject}
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
