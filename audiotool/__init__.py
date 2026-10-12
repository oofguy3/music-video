"""audiotool: turn a song into tracks an AI can read."""

import logging
import os
import warnings

__version__ = "0.1.0"

# Large HF files are fetched over the plain HTTP path (the Xet hosts are not reliably reachable).
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

warnings.filterwarnings("ignore", message=r".*pkg_resources is deprecated.*")
warnings.filterwarnings("ignore", category=FutureWarning, module=r"librosa.*")


class _DropBasicPitchBackendNoise(logging.Filter):
    """basic-pitch logs one warning per missing backend (TF, tflite, CoreML) on import."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "is not installed. If you plan to use" not in record.getMessage()


logging.getLogger().addFilter(_DropBasicPitchBackendNoise())
