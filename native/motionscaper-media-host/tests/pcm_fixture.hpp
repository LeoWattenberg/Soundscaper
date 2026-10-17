/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "frame_fixture.hpp"
namespace motionscaper::media::fixture {
inline std::string pcm(const bool poison = false) {
	const std::string header = "{\"identity\":{\"projectId\":\"p\",\"revisionDigest\":\"" + std::string(64, 'a')
		+ "\",\"compositionId\":\"c\"},\"frameRate\":{\"num\":30000,\"den\":1001},\"firstFrame\":123,\"frameCount\":2,\"sampleRate\":96000,\"channels\":2,\"sampleCount\":6407,\"format\":\"motionscaper-interleaved-pcm-pack\",\"version\":1,\"sampleFormat\":\"f32le\"}";
	std::string result = "motionscaper-interleaved-pcm-pack-v1\n"; integer(result, static_cast<std::uint32_t>(header.size())); result += header;
	for (std::uint32_t index = 0; index < 6407; ++index) {
		integer(result, poison ? 0x7fc00000U : std::bit_cast<std::uint32_t>(index % 3 == 0 ? 1.25F : 0.1234567F));
		integer(result, std::bit_cast<std::uint32_t>(index % 3 == 0 ? -1.25F : -0.7654321F));
	}
	return result;
}
}
