/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "delivery_fs_protocol.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <string>

namespace soundscaper::delivery_fs {

struct publication_result final { file_identity final_identity; };

struct recovery_result final {
	std::string status;
	std::uint64_t byte_length = 0;
	std::string sha256;
	std::optional<file_identity> identity;
};

class platform_session {
public:
	virtual ~platform_session() = default;
	platform_session(const platform_session&) = delete;
	platform_session& operator=(const platform_session&) = delete;

	virtual const root_identity& root() const noexcept = 0;
	virtual const file_identity& file() const noexcept = 0;
	virtual const std::string& staging_reference() const noexcept = 0;
	virtual void write_at(std::uint64_t offset, std::span<const std::byte> bytes) = 0;
	virtual std::size_t read_at(std::uint64_t offset, std::span<std::byte> bytes) = 0;
	virtual std::uint64_t size() const = 0;
	virtual void flush_file() = 0;
	virtual publication_result publish() = 0;
	virtual void abort() noexcept = 0;

protected:
	platform_session() = default;
};

std::unique_ptr<platform_session> create_platform_session(const init_request& request);
recovery_result recover_platform_session(const recovery_request& request);
recovery_result inspect_platform_final(const final_inspection_request& request);

} // namespace soundscaper::delivery_fs
