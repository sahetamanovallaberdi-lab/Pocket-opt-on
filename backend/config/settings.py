import os
from pathlib import Path

DATA_DIR = Path(os.getenv("POCKET_ANALYZER_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
DATABASE_PATH = DATA_DIR / "pocket_analyzer.sqlite3"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
MODE = "SIGNAL_ONLY"
