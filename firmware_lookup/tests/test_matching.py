from firmware_lookup.matching import find_ambiguous_candidates, match_model


def test_exact_match():
    assert match_model("TL-SG1016DE", ["TL-SG1016DE", "TL-SG1024DE"]) == ("TL-SG1016DE", 1.0, "exact")


def test_normalized_match():
    matched, score, method = match_model("tl sg1016de", ["TL-SG1016DE"])
    assert matched == "TL-SG1016DE"
    assert method == "normalized"


def test_contains_match_unique():
    matched, score, method = match_model(
        "ioLogik 2500", ["ioLogik 2500 Series", "EDR-8010 Series"],
    )
    assert matched == "ioLogik 2500 Series"
    assert method == "contains"


def test_ambiguous_model_never_guesses():
    """The spec's own example: a bare model name that matches multiple
    real SKUs must never silently pick one."""
    matched, score, method = match_model(
        "Catalyst 9300", ["Catalyst 9300-48P", "Catalyst 9300-24P"],
    )
    assert matched is None
    assert method == "ambiguous"

    candidates = find_ambiguous_candidates(
        "Catalyst 9300", ["Catalyst 9300-48P", "Catalyst 9300-24P"],
    )
    assert set(candidates) == {"Catalyst 9300-48P", "Catalyst 9300-24P"}


def test_zero_candidates_is_none_not_ambiguous():
    matched, score, method = match_model("TotallyFake9999", ["Catalyst 9300-48P"])
    assert matched is None
    assert method == "none"


def test_fuzzy_match_accepted_when_unambiguous():
    matched, score, method = match_model("GS108Ev3", ["GS108Ev3", "GS748Tv4"])
    assert matched == "GS108Ev3"
    assert method == "exact"


def test_empty_inputs_never_raise():
    assert match_model("", ["a", "b"]) == (None, 0.0, "none")
    assert match_model("model", []) == (None, 0.0, "none")
