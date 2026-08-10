export const ANALYSIS_MODE_PANEL_IDS = Object.freeze({
	levels: 'analysis',
	spectrum: 'spectrum',
	clipping: 'clipping',
	contrast: 'contrast',
});
export const ANALYZER_PANEL_IDS = Object.freeze([
	...Object.values(ANALYSIS_MODE_PANEL_IDS),
	'ebu-r128',
]);
export const ANALYZER_PANEL_ID_SET = new Set(ANALYZER_PANEL_IDS);

export const WORKSPACE_PANEL_IDS = Object.freeze([
	'project-bin',
	'video-preview',
	'source-monitor',
	'history',
	'labels',
	'markers',
	'metadata',
	'effects',
	'mixer',
	'analysis',
	'spectrum',
	'clipping',
	'contrast',
	'ebu-r128',
]);
export const WORKSPACE_TOOLBAR_IDS = Object.freeze(['transport', 'tools', 'edit', 'meter']);
export const WORKSPACE_DOCK_IDS = Object.freeze(['left', 'right', 'bottom', 'floating']);
export const FLOATING_PANEL_MIN_WIDTH = 240;
export const FLOATING_PANEL_MIN_HEIGHT = 120;

export interface FloatingPanelGeometry {
	height: number;
	width: number;
	x: number;
	y: number;
}

export interface FloatingPanelGeometryInput {
	height?: number;
	size?: number;
	width?: number;
	x?: number;
	y?: number;
}

type EditorCopy = Record<string, string | undefined>;

interface HistoryEntry {
	commandCount?: number;
	commands?: string[];
	type?: string;
}

export function clampFloatingPanelGeometry(
	panel: FloatingPanelGeometryInput | null | undefined,
	workspaceBounds: Pick<Partial<FloatingPanelGeometry>, 'height' | 'width'> = {},
): FloatingPanelGeometry {
	const raw = {
		x: Math.max(0, Number(panel?.x) || 0),
		y: Math.max(0, Number(panel?.y) || 0),
		width: Math.max(80, Number(panel?.width ?? panel?.size) || 320),
		height: Math.max(80, Number(panel?.height) || 320),
	};
	const workspaceWidth = Math.max(0, Number(workspaceBounds.width) || 0);
	const workspaceHeight = Math.max(0, Number(workspaceBounds.height) || 0);
	if (!workspaceWidth || !workspaceHeight) return raw;
	const minimumWidth = Math.min(FLOATING_PANEL_MIN_WIDTH, workspaceWidth);
	const minimumHeight = Math.min(FLOATING_PANEL_MIN_HEIGHT, workspaceHeight);
	const width = Math.min(workspaceWidth, Math.max(minimumWidth, raw.width));
	const height = Math.min(workspaceHeight, Math.max(minimumHeight, raw.height));
	return {
		x: Math.min(Math.max(0, raw.x), workspaceWidth - width),
		y: Math.min(Math.max(0, raw.y), workspaceHeight - height),
		width,
		height,
	};
}

export function workspacePanelLabel(copy: EditorCopy, panelId: string): string {
	const analyzerLabels: Record<string, string | undefined> = {
		'project-bin': copy.panelProjectBin,
		'video-preview': copy.panelVideoPreview,
		'source-monitor': copy.panelSourceMonitor,
		analysis: copy.analysisCommand,
		spectrum: copy.plotSpectrum,
		clipping: copy.findClipping,
		contrast: copy.contrast,
		'ebu-r128': copy.meterTypeEbuR128,
	};
	if (analyzerLabels[panelId]) return analyzerLabels[panelId];
	return copy[`panel${panelId[0].toUpperCase()}${panelId.slice(1)}`] || panelId;
}

export function workspaceDockLabel(copy: EditorCopy, dockId: string): string {
	return copy[`dock${dockId[0].toUpperCase()}${dockId.slice(1)}`] || dockId;
}

export function historyCommandLabel(copy: EditorCopy, entry: HistoryEntry): string {
	const type = entry.commands?.[0] || entry.type || '';
	return copy.historyCommand?.replace('{command}', type).replace('{count}', String(entry.commandCount || 1)) || type;
}
