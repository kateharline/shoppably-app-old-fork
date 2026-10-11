"""Load local configuration without executing or logging shell contents."""
import os
import re
from pathlib import Path

from dotenv import load_dotenv


def load_config():
    load_dotenv()
    # The user keeps their development key here. Never read bashrc on Vercel.
    if (not os.getenv("VERCEL") and not os.getenv("ARCADE_API_KEY")
            and os.getenv("ARCADE_KEY_FROM_BASHRC", "1") == "1"):
        bashrc = Path.home() / ".bashrc"
        if bashrc.exists():
            for line in bashrc.read_text().splitlines():
                match = re.fullmatch(
                    r"\s*(?:export\s+)?ARCADE_API_KEY\s*=\s*['\"]([^'\"]+)['\"]\s*", line
                )
                if match:
                    os.environ["ARCADE_API_KEY"] = match[1]


def live_enabled():
    mode = os.getenv("ARCADE_MODE", "auto")
    if mode not in {"auto", "live", "mock"}:
        raise ValueError("ARCADE_MODE must be auto, live or mock")
    return mode == "live" or (mode == "auto" and bool(os.getenv("ARCADE_API_KEY")))

