/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace soundscaper::professional::macosBootstrap {

inline constexpr int enforcementDescriptor = 3;
inline constexpr int policyDescriptor = 4;
inline constexpr int extraInputDescriptor = 5;
inline constexpr std::size_t maximumPolicyBytes = 512u * 1024u;
inline constexpr std::array<std::uint8_t, 8> policyMagic{ 'M', '5', 'M', 'A', 'C', 'S', 'B', '1' };
inline constexpr std::size_t policyHeaderBytes = 16u;

bool soundscaperProfessionalMacosBootstrap();

} // namespace soundscaper::professional::macosBootstrap
