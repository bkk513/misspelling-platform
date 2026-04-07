"""文件说明：GBNC 集成包初始化文件，负责标记数据源集成目录为 Python 包。"""

from .client import fetch_gbnc_series

__all__ = ["fetch_gbnc_series"]
