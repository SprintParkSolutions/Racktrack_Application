"""Read the identifier printed on a rack's own rails.

A rack wears its name on a strip of tape or an engraved chip on the frame -
"SP-HYB-RM01-R01-R1" across the top rail, "RACK-07" down the side. It is the
one piece of text in the photograph that names the RACK rather than a box in
it, and reading it is what lets the application say which rack this is instead
of asking the person who just photographed it.

Whole-image reading misses it. The text is small, low contrast, often on tape
at an angle, and at phone-photo distance a rack label is a few dozen pixels
tall. So the label is read the way a person reads something small: look at the
one place it lives, hold it closer, and read it several times.

  - The units model already finds the rails, so the search is over a strip of
    frame rather than the whole picture.
  - Inside a rail, the label is the bright thing: white tape and engraved
    chips both throw far more light than the black frame around them.
  - That crop is then read at several sizes and with several treatments -
    plain, sharpened, thresholded - because a reading that fails on one often
    succeeds on another.
  - The readings are voted on character by character. The vote is the answer
    and the agreement is the confidence: seven readings that agree everywhere
    score 1.0, seven that disagree about one letter score a little less.

What it refuses to do. It never returns a reading the votes disagreed about
badly, never one that is mostly a single repeated character or holds anything
but plain text, and it never decides anything: a reading is a candidate with a
confidence, and which rack this is remains the ladder's decision and, above
that, a person's.

The method is a colleague's, ported here onto this engine's reader and this
pipeline's rail detections.
"""

from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher

import cv2
import numpy as np

# How much bigger to make the label before reading it. A rack label is small in
# a photograph of a whole cabinet, and the reader was trained on text that
# fills more of the frame than this ever does.
SCALES = (1.0, 1.5, 2.0, 2.5, 3.0, 4.0)

SHARPEN = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])

# Anything below this and the readings disagreed too much to be worth offering.
MIN_AGREEMENT = 0.55
# A rail wider than it is tall is a cross rail with a label along it; an upright
# rail is read too, but a sliver of frame is not.
MIN_SIDE_PX = 24

# The reader turns these into letters inside a run of digits: a nought becomes
# a letter O, a one becomes I or l. Only ever applied to the tail of a segment,
# where these labels carry their numbers.
DIGIT_LOOKALIKE = {"O": "0", "o": "0", "I": "1", "i": "1", "l": "1", "L": "1"}

# What a rack identifier can be made of. Telling the reader so is the single
# biggest help it gets: left to choose from every character it knows, it reads
# a marginal photograph of this tape as "7+H" and gives up, and the same strip
# with the alphabet narrowed to letters, digits and the hyphen reads
# SP-HYB-RM01-R01-R1 eleven times out of eleven. Lower case is left out on
# purpose - the tidy step upper-cases anyway, and offering both cases only
# gives the reader more ways to be wrong about the same stroke.
ALLOWED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"


def isolate_label(crop: np.ndarray) -> np.ndarray:
    """The bright part of a rail crop: the tape or chip, without the frame."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    _, bright = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY)
    ys, xs = np.where(bright > 0)
    if len(xs) < 20:
        return gray  # nothing stands out; read the strip as it is
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    return gray[max(0, y0 - 2) : y1 + 3, max(0, x0 - 2) : x1 + 3]


def treatments(gray: np.ndarray) -> list:
    """One crop, three ways: as it is, sharpened, and thresholded."""
    out = [gray, cv2.filter2D(gray, -1, SHARPEN)]
    if min(gray.shape[:2]) >= 32:
        out.append(
            cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
            )
        )
    return out


def resolve_number_tails(text: str) -> str:
    """Letters that are really digits, in the number at the end of a segment.

    These labels end each hyphenated segment in a number - R01, U15, RM01 - so
    a letter O or l sitting in that tail is the reader's mistake, not the
    label's. Only the tail is touched: SOPHOS keeps its O.
    """
    out = []
    for segment in text.split("-"):
        chars = list(segment)
        i = len(chars) - 1
        while i >= 0 and (chars[i].isdigit() or chars[i] in DIGIT_LOOKALIKE):
            chars[i] = DIGIT_LOOKALIKE.get(chars[i], chars[i])
            i -= 1
        out.append("".join(chars))
    return "-".join(out)


def is_plausible(text: str) -> bool:
    """Something that could be an identifier, rather than noise off the frame."""
    packed = "".join(text.split())
    if not packed or any(ord(c) > 127 for c in packed):
        return False
    if sum(c.isalpha() for c in packed) < 4:
        return False
    if not re.search(r"\d", packed):
        return False  # a rack identifier carries a number
    # "IIIIIIII" and "--------" are the reader failing, not a label.
    return max(packed.count(c) for c in set(packed)) / len(packed) <= 0.35


def vote(readings: list) -> tuple:
    """One answer from many readings, with how much they agreed as its score.

    The longest common shape wins the ballot: the reading whose length most
    readings share is the reference, and every other reading votes on the
    characters it lines up with. The answer is the winner at each position and
    the score is the average share of the vote those winners took.
    """
    # Tidied first, then judged: a reading arrives as "SP-HyB-RMOI-ROL-RI",
    # which carries no digit at all until the numbers in its tails are resolved,
    # so judging it raw threw away every true reading of the office rack.
    # Tidying first also lines the readings up for the vote, since they then
    # differ only where the reader actually disagreed.
    kept = [
        t for t in dict.fromkeys(_tidy(r) for r in readings if r and r.strip()) if is_plausible(t)
    ]
    if not kept:
        return "", 0.0
    if len(kept) == 1:
        return kept[0], 1.0

    lengths = Counter(len(r) for r in kept)
    reference = next(
        r for r in kept if len(r) == max(lengths.items(), key=lambda kv: (kv[1], kv[0]))[0]
    )
    ballots = [Counter({c: 1}) for c in reference]
    for other in kept:
        if other == reference:
            continue
        for tag, i1, i2, j1, j2 in SequenceMatcher(None, reference, other).get_opcodes():
            if tag == "equal":
                for k in range(i2 - i1):
                    ballots[i1 + k][reference[i1 + k]] += 1
            elif tag == "replace" and (i2 - i1) == (j2 - j1):
                for k in range(i2 - i1):
                    ballots[i1 + k][other[j1 + k]] += 1
    won = "".join(b.most_common(1)[0][0] for b in ballots)
    agreement = sum(b.most_common(1)[0][1] / sum(b.values()) for b in ballots) / len(ballots)
    return _tidy(won), round(agreement, 3)


def _tidy(text: str) -> str:
    """The label as it is written: upper case, hyphens, numbers in the tails.

    A full stop between segments is the reader's version of a hyphen on this
    kind of tape, and so is a space: the labels do not carry either.
    """
    text = text.strip().upper().replace(".", "-")
    text = re.sub(r"\s*[-–—]\s*", "-", text)
    text = re.sub(r"\s+", "-", text)
    return resolve_number_tails(re.sub(r"-{2,}", "-", text).strip("-"))


def wide_enough(box) -> bool:
    x1, y1, x2, y2 = box
    return (x2 - x1) >= MIN_SIDE_PX and (y2 - y1) >= 8


def read_rails(image, rail_boxes, reader, scales=SCALES, min_agreement=MIN_AGREEMENT) -> list:
    """Every label read off the rails, best agreement first.

    `reader` is anything with easyocr's readtext(image) -> [(points, text,
    confidence)], so this is testable without a model or a reader.
    """
    found = []
    for box in rail_boxes or []:
        if not wide_enough(box):
            continue
        x1, y1, x2, y2 = (int(v) for v in box)
        crop = image[max(0, y1) : y2, max(0, x1) : x2]
        if crop is None or crop.size == 0:
            continue
        label = isolate_label(crop)
        if label.size == 0:
            continue
        readings = []
        for scale in scales:
            sized = (
                label
                if scale == 1.0
                else cv2.resize(label, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
            )
            for treated in treatments(sized):
                as_bgr = cv2.cvtColor(treated, cv2.COLOR_GRAY2BGR) if treated.ndim == 2 else treated
                try:
                    results = reader.readtext(
                        as_bgr, detail=1, paragraph=False, allowlist=ALLOWED_CHARS
                    )
                except Exception:  # one treatment failing is not the label failing
                    continue
                for item in results:
                    text = item[1] if len(item) > 1 else ""
                    conf = float(item[2]) if len(item) > 2 else 0.0
                    if conf >= 0.2 and str(text).strip():
                        readings.append(str(text).strip())
        text, agreement = vote(readings)
        if not text or agreement < min_agreement:
            continue
        found.append(
            {
                "text": text,
                "conf": agreement,
                "readings": len(readings),
                "box": [x1, y1, x2, y2],
                "y_mid": (y1 + y2) / 2,
            }
        )
    found.sort(key=lambda r: (-r["conf"], r["y_mid"]))
    return found
