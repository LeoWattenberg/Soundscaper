/* SPDX-License-Identifier: AGPL-3.0-only */

#include "delivery_fs_protocol.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <charconv>
#include <cstring>
#include <limits>
#include <set>
#include <span>
#include <sstream>
#include <string_view>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#else
#include <unistd.h>
#endif

namespace soundscaper::delivery_fs {
namespace {

class json_parser final {
public:
	explicit json_parser(std::string_view source) : source_(source) {}

	json_value parse() {
		auto output = parse_value();
		skip_space();
		if (position_ != source_.size()) fail();
		return output;
	}

private:
	json_value parse_value() {
		skip_space();
		if (position_ == source_.size()) fail();
		const auto value = source_[position_];
		if (value == '{') return json_value{parse_object()};
		if (value == '"') return json_value{parse_string()};
		if (value >= '0' && value <= '9') return json_value{parse_number()};
		if (take("true")) return json_value{true};
		if (take("false")) return json_value{false};
		if (take("null")) return json_value{nullptr};
		fail();
	}

	json_value::object parse_object() {
		++position_;
		json_value::object output;
		skip_space();
		if (consume('}')) return output;
		for (;;) {
			skip_space();
			if (position_ == source_.size() || source_[position_] != '"') fail();
			auto key = parse_string();
			skip_space();
			if (!consume(':')) fail();
			if (!output.emplace(std::move(key), parse_value()).second) fail();
			skip_space();
			if (consume('}')) return output;
			if (!consume(',')) fail();
		}
	}

	std::string parse_string() {
		if (!consume('"')) fail();
		std::string output;
		while (position_ < source_.size()) {
			const auto value = static_cast<unsigned char>(source_[position_++]);
			if (value == '"') return output;
			if (value < 0x20U) fail();
			if (value != '\\') { output.push_back(static_cast<char>(value)); continue; }
			if (position_ == source_.size()) fail();
			const auto escaped = source_[position_++];
			switch (escaped) {
			case '"': output.push_back('"'); break;
			case '\\': output.push_back('\\'); break;
			case '/': output.push_back('/'); break;
			case 'b': output.push_back('\b'); break;
			case 'f': output.push_back('\f'); break;
			case 'n': output.push_back('\n'); break;
			case 'r': output.push_back('\r'); break;
			case 't': output.push_back('\t'); break;
			case 'u': append_utf8(output, parse_codepoint()); break;
			default: fail();
			}
		}
		fail();
	}

	std::uint32_t parse_codepoint() {
		auto first = parse_hex_quad();
		if (first >= 0xd800U && first <= 0xdbffU) {
			if (position_ + 2 > source_.size() || source_[position_] != '\\'
				|| source_[position_ + 1] != 'u') fail();
			position_ += 2;
			const auto second = parse_hex_quad();
			if (second < 0xdc00U || second > 0xdfffU) fail();
			return 0x10000U + ((first - 0xd800U) << 10U) + second - 0xdc00U;
		}
		if (first >= 0xdc00U && first <= 0xdfffU) fail();
		return first;
	}

	std::uint32_t parse_hex_quad() {
		if (position_ + 4 > source_.size()) fail();
		std::uint32_t output = 0;
		for (int index = 0; index < 4; ++index) {
			const auto value = source_[position_++];
			output <<= 4U;
			if (value >= '0' && value <= '9') output |= static_cast<unsigned>(value - '0');
			else if (value >= 'a' && value <= 'f') output |= static_cast<unsigned>(value - 'a' + 10);
			else if (value >= 'A' && value <= 'F') output |= static_cast<unsigned>(value - 'A' + 10);
			else fail();
		}
		return output;
	}

	std::uint64_t parse_number() {
		const auto start = position_;
		if (source_[position_] == '0') ++position_;
		else while (position_ < source_.size() && source_[position_] >= '0'
			&& source_[position_] <= '9') ++position_;
		if (position_ < source_.size() && (source_[position_] == '.' || source_[position_] == 'e'
			|| source_[position_] == 'E')) fail();
		std::uint64_t output = 0;
		const auto result = std::from_chars(source_.data() + start, source_.data() + position_, output);
		if (result.ec != std::errc{} || result.ptr != source_.data() + position_) fail();
		return output;
	}

	void skip_space() {
		while (position_ < source_.size() && (source_[position_] == ' ' || source_[position_] == '\n'
			|| source_[position_] == '\r' || source_[position_] == '\t')) ++position_;
	}

	bool consume(char value) {
		if (position_ >= source_.size() || source_[position_] != value) return false;
		++position_;
		return true;
	}

	bool take(std::string_view value) {
		if (source_.substr(position_, value.size()) != value) return false;
		position_ += value.size();
		return true;
	}

	[[noreturn]] static void fail() {
		throw protocol_error("malformed-control", "control-parse", false,
			"The SDF1 control payload is not strict JSON.");
	}

	static void append_utf8(std::string& output, std::uint32_t value) {
		if (value <= 0x7fU) output.push_back(static_cast<char>(value));
		else if (value <= 0x7ffU) {
			output.push_back(static_cast<char>(0xc0U | (value >> 6U)));
			output.push_back(static_cast<char>(0x80U | (value & 0x3fU)));
		} else if (value <= 0xffffU) {
			output.push_back(static_cast<char>(0xe0U | (value >> 12U)));
			output.push_back(static_cast<char>(0x80U | ((value >> 6U) & 0x3fU)));
			output.push_back(static_cast<char>(0x80U | (value & 0x3fU)));
		} else {
			output.push_back(static_cast<char>(0xf0U | (value >> 18U)));
			output.push_back(static_cast<char>(0x80U | ((value >> 12U) & 0x3fU)));
			output.push_back(static_cast<char>(0x80U | ((value >> 6U) & 0x3fU)));
			output.push_back(static_cast<char>(0x80U | (value & 0x3fU)));
		}
	}

	std::string_view source_;
	std::size_t position_ = 0;
};

bool exact_read(std::span<std::byte> output, bool clean_eof_allowed) {
	std::size_t offset = 0;
	while (offset < output.size()) {
#ifdef _WIN32
		const auto count = _read(0, output.data() + offset,
			static_cast<unsigned int>(output.size() - offset));
#else
		const auto count = ::read(STDIN_FILENO, output.data() + offset, output.size() - offset);
#endif
		if (count == 0 && offset == 0 && clean_eof_allowed) return false;
		if (count == 0) throw protocol_error("unexpected-eof", "frame-read", false,
			"The SDF1 input ended inside a frame.");
		if (count < 0) {
			if (errno == EINTR) continue;
			throw protocol_error("control-io-failed", "frame-read", true, std::strerror(errno));
		}
		offset += static_cast<std::size_t>(count);
	}
	return true;
}

void exact_write(std::span<const std::byte> input) {
	std::size_t offset = 0;
	while (offset < input.size()) {
#ifdef _WIN32
		const auto count = _write(1, input.data() + offset,
			static_cast<unsigned int>(input.size() - offset));
#else
		const auto count = ::write(STDOUT_FILENO, input.data() + offset, input.size() - offset);
#endif
		if (count < 0) {
			if (errno == EINTR) continue;
			throw protocol_error("control-io-failed", "frame-write", true, std::strerror(errno));
		}
		if (count == 0) throw protocol_error("control-io-failed", "frame-write", true,
			"The SDF1 control output accepted a zero-byte write.");
		offset += static_cast<std::size_t>(count);
	}
}

std::uint32_t read_u32(const std::byte* value) {
	return (std::to_integer<std::uint32_t>(value[0]) << 24U)
		| (std::to_integer<std::uint32_t>(value[1]) << 16U)
		| (std::to_integer<std::uint32_t>(value[2]) << 8U)
		| std::to_integer<std::uint32_t>(value[3]);
}

void write_u32(std::byte* output, std::uint32_t value) {
	output[0] = static_cast<std::byte>((value >> 24U) & 0xffU);
	output[1] = static_cast<std::byte>((value >> 16U) & 0xffU);
	output[2] = static_cast<std::byte>((value >> 8U) & 0xffU);
	output[3] = static_cast<std::byte>(value & 0xffU);
}

json_value::object parse_control_object(const frame& value, opcode expected, const char* phase) {
	if (value.operation != expected || value.payload.empty()
		|| value.payload.size() > maximum_control_bytes) {
		throw protocol_error("invalid-state", phase, false, "The SDF1 control frame is invalid here.");
	}
	const std::string source(reinterpret_cast<const char*>(value.payload.data()), value.payload.size());
	auto parsed = json_parser(source).parse();
	if (!std::holds_alternative<json_value::object>(parsed.value)) {
		throw protocol_error("malformed-control", phase, false, "The SDF1 payload must be an object.");
	}
	return std::get<json_value::object>(std::move(parsed.value));
}

void exact_keys(const json_value::object& value, std::initializer_list<std::string_view> expected,
	const char* phase) {
	if (value.size() != expected.size() || std::any_of(expected.begin(), expected.end(),
		[&](const auto key) { return !value.contains(key); })) {
		throw protocol_error("malformed-control", phase, false,
			"The SDF1 control object is not closed over its canonical fields.");
	}
}

const json_value& field(const json_value::object& value, std::string_view key, const char* phase) {
	const auto found = value.find(key);
	if (found == value.end()) throw protocol_error("malformed-control", phase, false,
		"The SDF1 control object is missing a field.");
	return found->second;
}

const json_value::object& object_field(const json_value::object& value, std::string_view key,
	const char* phase) {
	const auto& selected = field(value, key, phase).value;
	if (!std::holds_alternative<json_value::object>(selected)) {
		throw protocol_error("malformed-control", phase, false, "An SDF1 field must be an object.");
	}
	return std::get<json_value::object>(selected);
}

std::string string_field(const json_value::object& value, std::string_view key, std::size_t maximum,
	const char* phase) {
	const auto& selected = field(value, key, phase).value;
	if (!std::holds_alternative<std::string>(selected)) {
		throw protocol_error("malformed-control", phase, false, "An SDF1 field must be text.");
	}
	auto output = std::get<std::string>(selected);
	if (output.empty() || output.size() > maximum || output.find('\0') != std::string::npos) {
		throw protocol_error("malformed-control", phase, false, "An SDF1 text field is out of bounds.");
	}
	return output;
}

std::uint64_t number_field(const json_value::object& value, std::string_view key, const char* phase) {
	const auto& selected = field(value, key, phase).value;
	if (!std::holds_alternative<std::uint64_t>(selected)) {
		throw protocol_error("malformed-control", phase, false, "An SDF1 field must be an integer.");
	}
	return std::get<std::uint64_t>(selected);
}

root_identity parse_root_identity(const json_value::object& value, const char* phase) {
	exact_keys(value, {"volumeIdentity", "directoryIdentity"}, phase);
	return {string_field(value, "volumeIdentity", 256, phase),
		string_field(value, "directoryIdentity", 256, phase)};
}

file_identity parse_file_identity(const json_value::object& value, const char* phase) {
	exact_keys(value, {"volumeIdentity", "fileIdentity"}, phase);
	return {string_field(value, "volumeIdentity", 256, phase),
		string_field(value, "fileIdentity", 256, phase)};
}

std::optional<recovery_inspection> parse_recovery_inspection(
	const json_value::object& value,
	const char* phase
) {
	const auto& selected = field(value, "expectedInspection", phase).value;
	if (std::holds_alternative<std::nullptr_t>(selected)) return std::nullopt;
	if (!std::holds_alternative<json_value::object>(selected)) {
		throw protocol_error("malformed-control", phase, false,
			"The SDF1 expected inspection must be an object or null.");
	}
	const auto& inspection = std::get<json_value::object>(selected);
	exact_keys(inspection, {"byteLength", "sha256"}, phase);
	auto digest = string_field(inspection, "sha256", 64, phase);
	if (digest.size() != 64 || std::any_of(digest.begin(), digest.end(), [](char value) {
		return !(value >= '0' && value <= '9') && !(value >= 'a' && value <= 'f');
	})) {
		throw protocol_error("malformed-control", phase, false,
			"The SDF1 expected inspection digest is invalid.");
	}
	return recovery_inspection{number_field(inspection, "byteLength", phase), std::move(digest)};
}

void schema_one(const json_value::object& value, const char* phase) {
	if (number_field(value, "schemaVersion", phase) != 1) {
		throw protocol_error("unsupported-version", phase, false, "The SDF1 schema version is unsupported.");
	}
}

std::string final_name_field(
	const json_value::object& source,
	std::string_view key,
	const char* phase
) {
	auto final_name = string_field(source, key, 255, phase);
	if (final_name == "." || final_name == ".." || final_name.find('/') != std::string::npos
		|| final_name.find('\\') != std::string::npos || final_name.find(':') != std::string::npos
		|| std::any_of(final_name.begin(), final_name.end(), [](const unsigned char value) {
			return value < 0x20U || value == 0x7fU;
		})) {
		throw protocol_error("invalid-final-name", phase, false, "The SDF1 final name is not one leaf.");
	}
	return final_name;
}

} // namespace

protocol_error::protocol_error(std::string code_, std::string phase_, bool retryable_,
	std::string detail) : std::runtime_error(std::move(detail)), code(std::move(code_)),
	phase(std::move(phase_)), retryable(retryable_) {}

std::optional<frame> read_frame() {
	std::array<std::byte, 16> header{};
	if (!exact_read(header, true)) return std::nullopt;
	if (!std::equal(header.begin(), header.begin() + 4,
		reinterpret_cast<const std::byte*>(protocol_magic))
		|| std::to_integer<std::uint8_t>(header[4]) != protocol_version
		|| header[6] != std::byte{0} || header[7] != std::byte{0}) {
		throw protocol_error("malformed-frame", "frame-read", false, "The SDF1 frame header is invalid.");
	}
	const auto request_id = read_u32(header.data() + 8);
	const auto length = read_u32(header.data() + 12);
	if (request_id == 0 || length > maximum_data_bytes) {
		throw protocol_error("malformed-frame", "frame-read", false, "The SDF1 frame bounds are invalid.");
	}
	std::vector<std::byte> payload(length);
	if (length > 0) exact_read(payload, false);
	return frame{static_cast<opcode>(std::to_integer<std::uint8_t>(header[5])), request_id,
		std::move(payload)};
}

void write_frame(opcode operation, std::uint32_t request_id, const std::string& payload) {
	if (payload.size() > maximum_control_bytes || request_id == 0) {
		throw protocol_error("response-too-large", "frame-write", false, "The SDF1 response is invalid.");
	}
	std::array<std::byte, 16> header{};
	std::copy_n(reinterpret_cast<const std::byte*>(protocol_magic), 4, header.begin());
	header[4] = static_cast<std::byte>(protocol_version);
	header[5] = static_cast<std::byte>(operation);
	write_u32(header.data() + 8, request_id);
	write_u32(header.data() + 12, static_cast<std::uint32_t>(payload.size()));
	exact_write(header);
	exact_write(std::span(reinterpret_cast<const std::byte*>(payload.data()), payload.size()));
}

void write_error(std::uint32_t request_id, const protocol_error& error) {
	if (request_id == 0) request_id = 1;
	write_frame(opcode::error, request_id,
		"{\"schemaVersion\":1,\"code\":\"" + json_escape(error.code)
		+ "\",\"phase\":\"" + json_escape(error.phase) + "\",\"retryable\":"
		+ (error.retryable ? "true" : "false") + ",\"detail\":\""
		+ json_escape(std::string(error.what()).substr(0, 512)) + "\"}");
}

void configure_binary_standard_io() {
#ifdef _WIN32
	if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1) {
		throw protocol_error("control-io-failed", "startup", false, "Binary standard I/O is unavailable.");
	}
#endif
}

init_request parse_init(const frame& value) {
	const auto source = parse_control_object(value, opcode::init, "init");
	exact_keys(source, {"schemaVersion", "sessionId", "rootPath", "finalName",
		"expectedRootIdentity", "limits"}, "init");
	schema_one(source, "init");
	const auto& limits = object_field(source, "limits", "init");
	exact_keys(limits, {"maxBytes", "maxChunkBytes", "finalPrefixByteLength"}, "init");
	const auto maximum_bytes = number_field(limits, "maxBytes", "init");
	const auto chunk_bytes = number_field(limits, "maxChunkBytes", "init");
	const auto prefix_bytes = number_field(limits, "finalPrefixByteLength", "init");
	if (maximum_bytes == 0 || maximum_bytes > maximum_session_bytes || chunk_bytes == 0
		|| chunk_bytes > maximum_data_bytes || prefix_bytes > 32 || (prefix_bytes != 0 && prefix_bytes != 32)
		|| maximum_bytes < prefix_bytes) {
		throw protocol_error("invalid-limits", "init", false, "The SDF1 write limits are invalid.");
	}
	auto final_name = final_name_field(source, "finalName", "init");
	return {
		string_field(source, "sessionId", 128, "init"),
		string_field(source, "rootPath", 32'768, "init"), std::move(final_name),
		parse_root_identity(object_field(source, "expectedRootIdentity", "init"), "init"),
		{maximum_bytes, static_cast<std::uint32_t>(chunk_bytes), static_cast<std::uint32_t>(prefix_bytes)},
	};
}

seal_request parse_seal(const frame& value) {
	const auto source = parse_control_object(value, opcode::seal, "seal");
	exact_keys(source, {"byteLength"}, "seal");
	return {number_field(source, "byteLength", "seal")};
}

publish_request parse_publish(const frame& value) {
	const auto source = parse_control_object(value, opcode::publish, "publish");
	exact_keys(source, {"journalId"}, "publish");
	return {string_field(source, "journalId", 128, "publish")};
}

recovery_request parse_recovery(const frame& value) {
	const auto source = parse_control_object(value, opcode::recover, "recover");
	exact_keys(source, {"schemaVersion", "action", "rootPath", "expectedRootIdentity",
		"stagingReference", "expectedFileIdentity", "expectedInspection"}, "recover");
	schema_one(source, "recover");
	const auto action = string_field(source, "action", 16, "recover");
	if (action != "inspect" && action != "remove") {
		throw protocol_error("malformed-control", "recover", false, "The recovery action is invalid.");
	}
	return {
		action == "inspect" ? recovery_action::inspect : recovery_action::remove,
		string_field(source, "rootPath", 32'768, "recover"),
		parse_root_identity(object_field(source, "expectedRootIdentity", "recover"), "recover"),
		string_field(source, "stagingReference", 32'768, "recover"),
		parse_file_identity(object_field(source, "expectedFileIdentity", "recover"), "recover"),
		parse_recovery_inspection(source, "recover"),
	};
}

final_inspection_request parse_final_inspection(const frame& value) {
	const auto source = parse_control_object(value, opcode::inspect_final, "inspect-final");
	exact_keys(source, {"schemaVersion", "rootPath", "expectedRootIdentity", "finalName"},
		"inspect-final");
	schema_one(source, "inspect-final");
	return {
		string_field(source, "rootPath", 32'768, "inspect-final"),
		parse_root_identity(object_field(source, "expectedRootIdentity", "inspect-final"),
			"inspect-final"),
		final_name_field(source, "finalName", "inspect-final"),
	};
}

void require_empty_payload(const frame& value, const char* phase) {
	if (!value.payload.empty()) throw protocol_error("malformed-control", phase, false,
		"This SDF1 operation requires an empty payload.");
}

std::string json_escape(const std::string& value) {
	std::ostringstream output;
	output << std::hex;
	for (const auto byte : value) {
		const auto selected = static_cast<unsigned char>(byte);
		switch (selected) {
		case '"': output << "\\\""; break;
		case '\\': output << "\\\\"; break;
		case '\b': output << "\\b"; break;
		case '\f': output << "\\f"; break;
		case '\n': output << "\\n"; break;
		case '\r': output << "\\r"; break;
		case '\t': output << "\\t"; break;
		default:
			if (selected < 0x20U) output << "\\u00" << "0123456789abcdef"[selected >> 4U]
				<< "0123456789abcdef"[selected & 0xfU];
			else output << static_cast<char>(selected);
		}
	}
	return output.str();
}

std::string root_identity_json(const root_identity& value) {
	return "{\"volumeIdentity\":\"" + json_escape(value.volume_identity)
		+ "\",\"directoryIdentity\":\"" + json_escape(value.directory_identity) + "\"}";
}

std::string file_identity_json(const file_identity& value) {
	return "{\"volumeIdentity\":\"" + json_escape(value.volume_identity)
		+ "\",\"fileIdentity\":\"" + json_escape(value.file_identity_value) + "\"}";
}

std::string hex_value(std::uint64_t value) {
	std::ostringstream output;
	output << std::hex << value;
	return output.str();
}

} // namespace soundscaper::delivery_fs
