from __future__ import annotations

import json
from pathlib import Path

import pytest

from vetscribe.evals import cli


def run_cli(*args: str) -> int:
    return cli.main(list(args))


def test_validate_cases_passes_on_repo_set(capsys: pytest.CaptureFixture[str]) -> None:
    assert run_cli("validate-cases") == 0
    assert "cases valid" in capsys.readouterr().out


def test_validate_cases_reports_errors(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    case = {
        "id": "bad-01",
        "title": "t",
        "tags": ["sick"],
        "template_id": "builtin-sick",
        "transcript": "Dog has yeast in the left ear.",
        "ground_truth": {"source": "model-generated"},
        "expectations": {
            "fields": [{"section_id": "vitals", "key": "nope", "expected": "1"}],
            "facts": [
                {"id": "a", "section_id": "ghost", "any_of": ["yeast"]},
                {"id": "b", "any_of": ["not in transcript"]},
            ],
            "not_discussed": ["physical_exam"],
            "defaults_expected": ["history"],
            "forbidden": [{"id": "f", "any_of": ["yeast"]}],
        },
    }
    (tmp_path / "bad-01.json").write_text(json.dumps(case))
    (tmp_path / "wrong-name.json").write_text(json.dumps({**case, "template_id": "custom-x"}))
    (tmp_path / "broken.json").write_text("{")
    assert run_cli("validate-cases", "--dir", str(tmp_path)) == 1
    err = capsys.readouterr().err
    for needle in (
        "ground truth must never come from a model",
        "not a key_value field",
        "unknown section 'ghost'",
        "no any_of term occurs",
        "uses normal defaults",
        "does not use normal defaults",
        "overlaps an expected fact",
        "unknown built-in template_id",
        "file name must be",
        "broken.json",
    ):
        assert needle in err, needle
    empty = tmp_path / "none"
    empty.mkdir()
    assert run_cli("validate-cases", "--dir", str(empty)) == 1


def test_run_show_list_compare(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    d = ["--results-dir", str(tmp_path)]
    assert run_cli("run", "--provider", "oracle", "--reps", "1", "--label", "orc", *d) == 0
    out = capsys.readouterr().out
    assert "fact_recall" in out and "1.000" in out
    assert (
        run_cli("run", "--provider", "null", "--reps", "1", "--tag", "dental", "--by-tag", *d) == 0
    )
    capsys.readouterr()
    assert run_cli("list", *d) == 0
    listing = capsys.readouterr().out
    ids = [line.split()[0] for line in listing.splitlines()[2:]]
    assert len(ids) == 2
    null_id, oracle_id = ids  # newest first
    assert run_cli("show", oracle_id, *d) == 0
    assert "orc" in capsys.readouterr().out
    assert run_cli("show", oracle_id, "--json", *d) == 0
    assert json.loads(capsys.readouterr().out)["run_id"] == oracle_id
    assert run_cli("show", "missing", *d) == 2
    assert run_cli("compare", null_id, oracle_id, *d) == 0
    out = capsys.readouterr().out
    assert "better" in out and "verdict" in out
    assert run_cli("compare", null_id, oracle_id, "--json", *d) == 0
    assert "shared_cases" in capsys.readouterr().out
    assert run_cli("compare", "x", "y", *d) == 2


def test_fail_under_exit_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    d = ["--results-dir", str(tmp_path), "--reps", "1"]
    ok = run_cli("run", "--provider", "oracle", "--fail-under", "fact_recall=0.9", *d)
    assert ok == 0
    bad = run_cli("run", "--provider", "null", "--fail-under", "fact_recall=0.5", *d)
    assert bad == 1
    assert "FAIL-UNDER violated" in capsys.readouterr().err
    # a metric that is missing from the run also fails the gate
    assert run_cli("run", "--provider", "oracle", "--fail-under", "judge_faithfulness=0.5", *d) == 1
    with pytest.raises(SystemExit):
        run_cli("run", "--provider", "oracle", "--fail-under", "bogus=1", *d)


def test_run_config_errors_exit_2(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = run_cli(
        "run", "--provider", "oracle", "--case-id", "nope", "--results-dir", str(tmp_path)
    )
    assert code == 2 and "unknown case ids" in capsys.readouterr().err
