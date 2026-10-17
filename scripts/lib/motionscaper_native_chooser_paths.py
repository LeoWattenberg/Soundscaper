# SPDX-License-Identifier: AGPL-3.0-only
"""Pure path admission for the external Motionscaper X11 qualification driver."""
import re


def validate_arguments(arguments):
    if len(arguments) == 2 and arguments[0] == "--sustained":
        path = arguments[1]
        pattern = (r"/tmp/motionscaper-sustained-[A-Za-z0-9_-]{1,96}/"
                   r"(input\.mscape|(300|1200)/(output|native-(upload|encode)-(cancel|retry))\.mov)")
        if not re.fullmatch(pattern, path):
            raise ValueError("Expected one sustained-owned input or exact duration/movie path.")
        return path, path.endswith(".mov")
    if len(arguments) != 1 or not re.fullmatch(
        r"/tmp/motionscaper-native-scene-[A-Za-z0-9_-]+/(saved\.mscape|output\.mov)", arguments[0]
    ):
        raise ValueError("Expected one native scene qualification project/movie path.")
    return arguments[0], arguments[0].endswith("/output.mov")
