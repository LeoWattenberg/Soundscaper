/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';

import { SourcePropertiesPanel } from '../toolbar/SourcePropertiesPanel.jsx';

/**
 * The inspected clip's source facts and re-probe action in Clip properties.
 * @param {{
 *   source: unknown,
 *   controller: { actions: { video: { reprobeSource: (sourceId: string) => Promise<unknown> } } },
 *   copy: Record<string, string>,
 *   disabled: boolean,
 * }} props
 */
function VideoSourcePropertiesSection({ source, controller, copy, disabled }) {
	return <section className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide" data-clip-video-source-properties>
		<h3>{copy.sourceProperties}</h3>
		<SourcePropertiesPanel
			source={source}
			copy={copy}
			disabled={disabled}
			onReprobe={(sourceId) => controller.actions.video.reprobeSource(sourceId)}
		/>
	</section>;
}

export default React.memo(VideoSourcePropertiesSection);
