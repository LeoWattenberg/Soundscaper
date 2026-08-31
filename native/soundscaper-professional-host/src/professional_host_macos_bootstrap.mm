/* SPDX-License-Identifier: AGPL-3.0-only */

#include "professional_host_macos_bootstrap.hpp"

#include <sandbox.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdio>
#include <cstdint>
#include <string>

namespace soundscaper::professional::macosBootstrap {
namespace {

constexpr char enforcementFrame[] = "M5_NATIVE_ISOLATION_ENFORCED_V1\n";

bool exactRead(int descriptor, void *output, size_t length)
{
	auto *bytes = static_cast<uint8_t *>(output);
	size_t offset = 0u;
	while (offset < length) {
		const ssize_t received = read(descriptor, bytes + offset, length - offset);
		if (received > 0) { offset += static_cast<size_t>(received); continue; }
		if (received < 0 && errno == EINTR) continue;
		return false;
	}
	return true;
}

bool exactWrite(int descriptor, const void *input, size_t length)
{
	const auto *bytes = static_cast<const uint8_t *>(input);
	size_t offset = 0u;
	while (offset < length) {
		const ssize_t written = write(descriptor, bytes + offset, length - offset);
		if (written > 0) { offset += static_cast<size_t>(written); continue; }
		if (written < 0 && errno == EINTR) continue;
		return false;
	}
	return true;
}

bool bootstrapFailure(const char *stage, int code)
{
	std::array<char, 128> message{};
	const auto boundedCode = static_cast<unsigned int>(code > 0 ? code : 1);
	const int length = std::snprintf(message.data(), message.size(),
		"M5_NATIVE_ISOLATION_FAILURE_V1 macos %s %u\n", stage, boundedCode);
	if (length > 0 && static_cast<size_t>(length) < message.size()) {
		(void)exactWrite(STDERR_FILENO, message.data(), static_cast<size_t>(length));
	}
	return false;
}

bool exactEof(int descriptor)
{
	uint8_t trailing = 0u;
	for (;;) {
		const ssize_t received = read(descriptor, &trailing, 1u);
		if (received < 0 && errno == EINTR) continue;
		return received == 0;
	}
}

uint32_t decode32(const uint8_t *bytes)
{
	return static_cast<uint32_t>(bytes[0]) | static_cast<uint32_t>(bytes[1]) << 8u
		| static_cast<uint32_t>(bytes[2]) << 16u | static_cast<uint32_t>(bytes[3]) << 24u;
}

bool enterSandbox(const std::string &policy)
{
	char *error = nullptr;
	errno = 0;
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#endif
	const int status = sandbox_init(policy.c_str(), 0u, &error);
	const int failureCode = errno;
	if (status != 0 && error != nullptr) sandbox_free_error(error);
#if defined(__clang__)
#pragma clang diagnostic pop
#endif
	return status == 0 ? true : bootstrapFailure("sandbox-init", failureCode);
}

} // namespace

bool soundscaperProfessionalMacosBootstrap()
{
	std::array<uint8_t, policyHeaderBytes> header{};
	if (!exactRead(policyDescriptor, header.data(), header.size())) {
		return bootstrapFailure("policy-header-read", errno);
	}
	if (!std::equal(policyMagic.begin(), policyMagic.end(), header.begin())
		|| header[13] != 0u || header[14] != 0u || header[15] != 0u) {
		return bootstrapFailure("policy-header", 1);
	}
	const uint32_t policyLength = decode32(header.data() + policyMagic.size());
	const bool hasExtraInput = header[12] == 1u;
	if (policyLength == 0u || policyLength > maximumPolicyBytes || header[12] > 1u) {
		return bootstrapFailure("policy-length", 1);
	}
	std::string policy(policyLength, '\0');
	if (!exactRead(policyDescriptor, policy.data(), policy.size())) {
		return bootstrapFailure("policy-body-read", errno);
	}
	if (policy.find('\0') != std::string::npos || !exactEof(policyDescriptor)) {
		return bootstrapFailure("policy-body", 1);
	}
	if (close(policyDescriptor) != 0) return bootstrapFailure("policy-close", errno);
	if (!enterSandbox(policy)) return false;
	if (!exactWrite(enforcementDescriptor, enforcementFrame, sizeof(enforcementFrame) - 1u)) {
		return bootstrapFailure("enforcement-write", errno);
	}
	if (close(enforcementDescriptor) != 0) return bootstrapFailure("enforcement-close", errno);
	if (hasExtraInput) {
		if (dup2(extraInputDescriptor, enforcementDescriptor) != enforcementDescriptor
			|| close(extraInputDescriptor) != 0) return bootstrapFailure("extra-input", errno);
	} else if (close(extraInputDescriptor) != 0 && errno != EBADF) {
		return bootstrapFailure("extra-input-close", errno);
	}
	return true;
}

} // namespace soundscaper::professional::macosBootstrap
