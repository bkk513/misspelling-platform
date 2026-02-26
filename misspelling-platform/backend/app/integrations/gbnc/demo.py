import json
import sys

from .client import fetch_gbnc_series


def main() -> int:
    word = (sys.argv[1] if len(sys.argv) > 1 else "chatgpt").strip()
    data = fetch_gbnc_series(
        term=word,
        variants=[],
        start_year=2018,
        end_year=2019,
        corpus="eng_2019",
        smoothing=0,
    )
    print(json.dumps({"term": data["term"], "series": data["series"][:1]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

