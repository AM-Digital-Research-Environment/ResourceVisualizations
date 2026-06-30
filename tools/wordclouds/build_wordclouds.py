#!/usr/bin/env python3
"""
Build lemmatised, per-language word-frequency inputs for the DRE Visualizations
word clouds.

Runs in CI (see .github/workflows/wordclouds.yml), NOT in Omeka. It reads each
corpus's text straight from the **public** Omeka REST API (public reads, no auth
or VPN), groups items by language (the declared dcterms:language, else
auto-detected), lemmatises each with the matching spaCy model, and writes a
per-corpus frequency file to ``asset/data/wordclouds/<corpus>.json``.

The corpora are multilingual (English, French, German, Portuguese), so a single
mixed cloud would be meaningless — each language is kept in its own bucket and
the front-end offers a language toggle.

Those files are committed and consumed by the in-Omeka precompute
(``Runner::wordCloudInput``) — a static INPUT, like ``asset/data/geo/
countries.geojson`` — with an in-PHP tokeniser as the fallback when a file is
absent. So the clouds work without this script (single-language, unlemmatised),
and upgrade to proper per-language lemmatisation once it has run.

Output shape (per corpus)::

    {
      "corpus": "publications",
      "generated_utc": "2026-06-30T12:00:00Z",
      "source": "https://data.africamultiple.uni-bayreuth.de",
      "models": {"en": "en_core_web_sm", ...},
      "languages": ["en", "de", "fr", "pt"],   # present, most items first
      "items": {"total": 247, "skipped": 5, "en": 150, "de": 70, ...},
      "byLang": {"en": [{"name": "africa", "value": 120}, ...], "de": [...], ...}
    }

Reusable: add an entry to CORPORA (item-set id + the text property) and it is
picked up automatically. On the PHP side, read it via ``Runner::wordCloudInput``
(which returns {languages, byLang}); the front-end word-cloud builder renders the
language toggle from `languages`.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import spacy
from langdetect import DetectorFactory, LangDetectException, detect

DetectorFactory.seed = 0  # make langdetect deterministic across runs

API_BASE = os.environ.get(
    "OMEKA_API_BASE", "https://data.africamultiple.uni-bayreuth.de"
).rstrip("/")

TOP_N = 200       # words kept per language
MIN_COUNT = 2     # drop per-language hapax
MIN_LEN = 3       # drop very short lemmas

# repo-root/asset/data/wordclouds — this file is tools/wordclouds/build_wordclouds.py
OUT_DIR = Path(__file__).resolve().parents[2] / "asset" / "data" / "wordclouds"

# Corpora to build: id -> Omeka item set + the property holding the text.
CORPORA = [
    {"id": "podcasts", "item_set": 39095, "field": "bibo:content"},      # transcripts
    {"id": "publications", "item_set": 29918, "field": "bibo:abstract"},
]

# Supported languages: code -> spaCy model (each downloaded in the CI workflow).
MODELS = {
    "en": "en_core_web_sm",
    "fr": "fr_core_news_sm",
    "de": "de_core_news_sm",
    "pt": "pt_core_news_sm",
}
SUPPORTED = list(MODELS)  # ['en', 'fr', 'de', 'pt']

# dcterms:language label fragments -> code (checked before falling back to detect).
LANG_LABELS = {
    "en": ("english", "anglais", "englisch"),
    "fr": ("french", "français", "francais", "französisch"),
    "de": ("german", "deutsch", "allemand"),
    "pt": ("portuguese", "português", "portugais", "portugiesisch"),
}

# Content words only — nouns, proper nouns, adjectives. Verbs are deliberately
# excluded: in spoken transcripts they are dominated by conversational fillers
# (know, think, come, mean, want, look, try) that lemmatisation only amplifies.
KEEP_POS = {"NOUN", "PROPN", "ADJ"}

# Domain / meta noise on top of each model's built-in stop words (lower-case lemmas).
EXTRA_STOP = {
    "podcast", "podcasts", "episode", "speaker", "music", "applause", "laughter",
    "intro", "outro", "welcome", "cluster", "conversation", "lecture", "session",
    "today", "talk", "hello", "everybody", "everyone", "thing", "stuff", "sort",
    "kind", "guess", "lot", "bit", "okay", "yeah", "actually", "basically",
    "really", "thank", "thanks",
    "épisode", "merci", "bonjour", "voilà",
}

CUE_RE = re.compile(r"\[[^\]]*\]")                          # [music], [applause]
SPEAKER_RE = re.compile(r"\bspeakers?\s*\d+\s*:?", re.I)    # "Speaker 1:" / "Speaker 2"
TAG_RE = re.compile(r"<[^>]+>")                             # strip HTML in abstracts


def clean(text: str) -> str:
    """Strip HTML, bracketed audio cues and 'Speaker N' diarisation labels."""
    text = TAG_RE.sub(" ", text)
    text = CUE_RE.sub(" ", text)
    return SPEAKER_RE.sub(" ", text)


def fetch_items(item_set: int) -> list[dict]:
    """All items of an item set from the public REST API (paginated)."""
    items: list[dict] = []
    page = 1
    while True:
        q = urlencode({"item_set_id": item_set, "per_page": 100, "page": page})
        req = Request(f"{API_BASE}/api/items?{q}", headers={"User-Agent": "dre-wordclouds/1.0"})
        with urlopen(req, timeout=60) as resp:
            batch = json.load(resp)
        if not batch:
            break
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.2)  # be gentle with the API
    return items


def text_of(item: dict, field: str) -> str:
    vals = item.get(field) or []
    return " ".join(v["@value"] for v in vals if isinstance(v, dict) and v.get("@value"))


def declared_lang(item: dict) -> str:
    """Map the item's dcterms:language to a supported code, or '' (first wins)."""
    for v in item.get("dcterms:language") or []:
        label = (v.get("display_title") or v.get("@value") or "").strip().lower()
        for code, frags in LANG_LABELS.items():
            if label == code or any(f in label for f in frags):
                return code
    return ""


def detect_lang(text: str) -> str:
    """Auto-detect language, restricted to the supported set ('' if unsure/other)."""
    try:
        code = detect(text[:2000])
    except LangDetectException:
        return ""
    return code if code in SUPPORTED else ""


def lemmatise(text: str, nlp) -> list[str]:
    out: list[str] = []
    for tok in nlp(text[: nlp.max_length]):
        if tok.pos_ not in KEEP_POS or not tok.is_alpha or tok.is_stop:
            continue
        lemma = tok.lemma_.lower().strip()
        if len(lemma) < MIN_LEN or lemma in EXTRA_STOP or nlp.vocab[lemma].is_stop:
            continue
        out.append(lemma)
    return out


def top(counter: Counter) -> list[dict]:
    return [{"name": w, "value": c} for w, c in counter.most_common(TOP_N) if c >= MIN_COUNT]


def main() -> int:
    print(f"Loading {len(MODELS)} spaCy models (API: {API_BASE}) …")
    models = {code: spacy.load(name, disable=["parser", "ner"]) for code, name in MODELS.items()}
    for nlp in models.values():
        for w in EXTRA_STOP:
            nlp.vocab[w].is_stop = True

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for corpus in CORPORA:
        cid, field, item_set = corpus["id"], corpus["field"], corpus["item_set"]
        print(f"== {cid}: fetching item set {item_set} …")
        items = fetch_items(item_set)
        counts = {c: Counter() for c in SUPPORTED}
        lang_items = {c: 0 for c in SUPPORTED}
        skipped = 0
        for it in items:
            text = clean(text_of(it, field))
            if not text.strip():
                skipped += 1
                continue
            code = declared_lang(it) or detect_lang(text)
            if code not in SUPPORTED:
                skipped += 1  # language we don't have a model for
                continue
            counts[code].update(lemmatise(text, models[code]))
            lang_items[code] += 1

        present = sorted((c for c in SUPPORTED if counts[c]), key=lambda c: -lang_items[c])
        payload = {
            "corpus": cid,
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": API_BASE,
            "models": MODELS,
            "languages": present,
            "items": {"total": len(items), "skipped": skipped, **{c: lang_items[c] for c in present}},
            "byLang": {c: top(counts[c]) for c in present},
        }
        (OUT_DIR / f"{cid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"   wrote asset/data/wordclouds/{cid}.json: languages={present} "
              f"items={{{', '.join(f'{c}={lang_items[c]}' for c in present)}}} skipped={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
