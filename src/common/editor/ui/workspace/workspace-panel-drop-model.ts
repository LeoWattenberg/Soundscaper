export type WorkspacePanelDropDock = 'bottom' | 'left' | 'right';
export type WorkspacePanelDropIntent = 'after' | 'before' | 'tab';

export interface WorkspacePanelDropBounds {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

export interface WorkspacePanelDropPoint {
	readonly x: number;
	readonly y: number;
}

export type WorkspacePanelDropPreview = WorkspacePanelDropBounds;

function isDropDock(dock: string): dock is WorkspacePanelDropDock {
	return dock === 'left' || dock === 'right' || dock === 'bottom';
}

function isDropIntent(intent: string): intent is WorkspacePanelDropIntent {
	return intent === 'before' || intent === 'tab' || intent === 'after';
}

function hasUsableBounds(bounds: WorkspacePanelDropBounds): boolean {
	return Number.isFinite(bounds.left)
		&& Number.isFinite(bounds.top)
		&& Number.isFinite(bounds.width)
		&& Number.isFinite(bounds.height)
		&& bounds.width > 0
		&& bounds.height > 0;
}

function isPointInsideBounds(
	point: WorkspacePanelDropPoint,
	bounds: WorkspacePanelDropBounds,
): boolean {
	return Number.isFinite(point.x)
		&& Number.isFinite(point.y)
		&& point.x >= bounds.left
		&& point.x <= bounds.left + bounds.width
		&& point.y >= bounds.top
		&& point.y <= bounds.top + bounds.height;
}

export function resolveWorkspacePanelDropIntent(
	dock: string,
	point: WorkspacePanelDropPoint,
	bounds: WorkspacePanelDropBounds,
): WorkspacePanelDropIntent | null {
	if (!isDropDock(dock) || !hasUsableBounds(bounds) || !isPointInsideBounds(point, bounds)) {
		return null;
	}

	const position = dock === 'bottom'
		? (point.x - bounds.left) / bounds.width
		: (point.y - bounds.top) / bounds.height;
	if (position <= 1 / 3) return 'before';
	if (position <= 2 / 3) return 'tab';
	return 'after';
}

export function resolveWorkspacePanelDropPreview(
	dock: string,
	intent: WorkspacePanelDropIntent,
	bounds: WorkspacePanelDropBounds,
): WorkspacePanelDropPreview | null {
	if (!isDropDock(dock) || !isDropIntent(intent) || !hasUsableBounds(bounds)) return null;
	if (intent === 'tab') return { ...bounds };

	if (dock === 'bottom') {
		const width = bounds.width / 2;
		return {
			left: intent === 'after' ? bounds.left + width : bounds.left,
			top: bounds.top,
			width,
			height: bounds.height,
		};
	}

	const height = bounds.height / 2;
	return {
		left: bounds.left,
		top: intent === 'after' ? bounds.top + height : bounds.top,
		width: bounds.width,
		height,
	};
}
