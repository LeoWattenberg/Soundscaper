import WorkspacePanelContent from './WorkspacePanelContent.jsx';
import WorkspacePanelHeader from './WorkspacePanelHeader.jsx';
import { workspacePanelLabel } from './workspace-panel-model.ts';

export default function VideoEditorWorkspacePanels({
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	playbackMeterSettings,
	run,
	showArmControls,
	displayAudioSupported,
	onOpenEffects,
	effectsPanelTarget,
	onEffectWindowChange,
	onTogglePanel,
	blocked,
}) {
	const panelIds = ['project-bin', 'video-preview', 'source-monitor'].filter((panelId) => (
		snapshot.preferences?.workspace?.panels?.[panelId]?.visible
	));
	if (!panelIds.length) return null;
	return (
		<section
			className="kw-audio-editor__video-workspace"
			data-video-workspace
			aria-label={`${copy.workspace}: ${copy.workspaceVideo}`}
		>
			{panelIds.map((panelId) => (
				<section
					key={panelId}
					className="kw-audio-editor__workspace-panel kw-audio-editor__video-workspace-panel"
					data-workspace-panel={panelId}
					data-video-workspace-panel={panelId}
				>
					<WorkspacePanelHeader
						panelId={panelId}
						label={workspacePanelLabel(copy, panelId)}
						copy={copy}
						onClose={() => onTogglePanel(panelId)}
					/>
					<div
						className="kw-audio-editor__workspace-panel-content"
						tabIndex={panelId === 'source-monitor' ? 0 : undefined}
					>
						<WorkspacePanelContent
							panelId={panelId}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							playbackMeterSettings={playbackMeterSettings}
							run={run}
							showArmControls={showArmControls}
							displayAudioSupported={displayAudioSupported}
							onOpenEffects={onOpenEffects}
							effectsPanelTarget={effectsPanelTarget}
							onEffectWindowChange={onEffectWindowChange}
							blocked={blocked}
						/>
					</div>
				</section>
			))}
		</section>
	);
}
