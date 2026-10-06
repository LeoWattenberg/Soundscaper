/* SPDX-License-Identifier: AGPL-3.0-only */

import { memo, useLayoutEffect, useMemo } from 'react';
import { AudioTrackRow } from './AudioTrackRow.jsx';
import { createAudioTrackRowPropReader } from './audio-track-row-props.ts';

const RetainedAudioTrackRow = memo(AudioTrackRow);

export function MemoizedAudioTrackRow(props) {
	const reader = useMemo(createAudioTrackRowPropReader, []);
	const narrowed = reader.read(props);
	useLayoutEffect(() => reader.publish(props));
	return <RetainedAudioTrackRow {...narrowed} />;
}
