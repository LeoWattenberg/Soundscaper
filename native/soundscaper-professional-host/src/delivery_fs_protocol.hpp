/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace soundscaper::delivery_fs {

inline constexpr char protocol_magic[] = "SDF1";
inline constexpr std::uint8_t protocol_version = 1;
inline constexpr std::uint32_t maximum_control_bytes = 64U * 1024U;
inline constexpr std::uint32_t maximum_data_bytes = 4U * 1024U * 1024U;
inline constexpr std::uint64_t maximum_session_bytes = 9'007'199'254'740'991ULL;

enum class opcode : std::uint8_t {
	init = 0x01,
	data = 0x02,
	seal = 0x03,
	publish = 0x04,
	abort = 0x05,
	patch_prefix = 0x06,
	recover = 0x07,
	inspect_final = 0x08,
	ready = 0x81,
	ack = 0x82,
	sealed = 0x83,
	published = 0x84,
	aborted = 0x85,
	recovery = 0x87,
	final_inspection = 0x88,
	error = 0xff,
};

struct protocol_error final : std::runtime_error {
	std::string code;
	std::string phase;
	bool retryable;

	protocol_error(std::string code_, std::string phase_, bool retryable_, std::string detail);
};

struct frame final {
	opcode operation;
	std::uint32_t request_id;
	std::vector<std::byte> payload;
};

struct root_identity final {
	std::string volume_identity;
	std::string directory_identity;
};

struct file_identity final {
	std::string volume_identity;
	std::string file_identity_value;
};

struct session_limits final {
	std::uint64_t maximum_bytes;
	std::uint32_t maximum_chunk_bytes;
	std::uint32_t final_prefix_bytes;
};

struct init_request final {
	std::string session_id;
	std::string root_path;
	std::string final_name;
	root_identity expected_root_identity;
	session_limits limits;
};

struct seal_request final { std::uint64_t byte_length; };
struct publish_request final { std::string journal_id; };

enum class recovery_action { inspect, remove };
struct recovery_inspection final {
	std::uint64_t byte_length;
	std::string sha256;
};
struct recovery_request final {
	recovery_action action;
	std::string root_path;
	root_identity expected_root_identity;
	std::string staging_reference;
	file_identity expected_file_identity;
	std::optional<recovery_inspection> expected_inspection;
};

struct final_inspection_request final {
	std::string root_path;
	root_identity expected_root_identity;
	std::string final_name;
};

struct json_value final {
	using object = std::map<std::string, json_value, std::less<>>;
	using storage = std::variant<std::nullptr_t, bool, std::uint64_t, std::string, object>;
	storage value;
};

std::optional<frame> read_frame();
void write_frame(opcode operation, std::uint32_t request_id, const std::string& payload);
void write_error(std::uint32_t request_id, const protocol_error& error);
void configure_binary_standard_io();

init_request parse_init(const frame& value);
seal_request parse_seal(const frame& value);
publish_request parse_publish(const frame& value);
recovery_request parse_recovery(const frame& value);
final_inspection_request parse_final_inspection(const frame& value);
void require_empty_payload(const frame& value, const char* phase);

std::string json_escape(const std::string& value);
std::string root_identity_json(const root_identity& value);
std::string file_identity_json(const file_identity& value);
std::string hex_value(std::uint64_t value);

} // namespace soundscaper::delivery_fs
