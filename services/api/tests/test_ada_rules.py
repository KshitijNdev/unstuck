import pytest

from app.rules import ada2010 as r


# ---- Table 208.2 -----------------------------------------------------------
@pytest.mark.parametrize("total,want", [
    (0, 0), (1, 1), (25, 1), (26, 2), (50, 2), (51, 3), (75, 3), (76, 4), (100, 4), (101, 5),
    (150, 5), (151, 6), (200, 6), (201, 7), (300, 7), (301, 8), (400, 8), (401, 9), (500, 9),
    (501, 11), (550, 11), (551, 12), (1000, 20), (1001, 21), (1100, 21), (1101, 22),
])
def test_table_208_2_boundaries(total, want):
    assert r.required_accessible_spaces(total) == want


def test_special_facilities():
    assert r.required_accessible_spaces(100, "hospital_outpatient") == 10
    assert r.required_accessible_spaces(100, "rehabilitation") == 20
    assert r.required_accessible_spaces(100, "outpatient_physical_therapy") == 20
    assert r.required_accessible_spaces(5, "hospital_outpatient") == 1  # table floor still applies


@pytest.mark.parametrize("bad", [-1, 2.5, "10", True, None])
def test_required_spaces_rejects_bad_totals(bad):
    with pytest.raises(ValueError):
        r.required_accessible_spaces(bad)


def test_unknown_kind_rejected():
    with pytest.raises(ValueError):
        r.required_accessible_spaces(10, "casino")


@pytest.mark.parametrize("n,want", [(0, 0), (1, 1), (6, 1), (7, 2), (12, 2), (13, 3)])
def test_van_rounding(n, want):
    assert r.required_van_spaces(n) == want


# ---- parking facility screen ----------------------------------------------
def test_parking_fail_and_pass():
    count, van = r.check_parking_facility(75, 2, 1, method="field")
    assert count.status == r.FAIL and count.required["value"] == 3
    assert van.status == r.PASS and van.required["value"] == 1
    assert count.legal_compliance_determination is False


def test_parking_unknown_total_never_defaults():
    count, van = r.check_parking_facility(None, 2, 1, method="field")
    assert count.status == r.FIELD and van.status == r.FIELD
    assert count.required is None and count.observed is None


def test_parking_partial_unknowns():
    count, van = r.check_parking_facility(40, None, None, method="field")
    assert count.status == r.FIELD and count.required["value"] == 2
    assert van.status == r.FIELD and van.required["value"] == 1
    count, van = r.check_parking_facility(40, 2, None, method="manual")
    assert count.status == r.PASS and van.status == r.FIELD


@pytest.mark.parametrize("method", ["image_estimate", None])
def test_parking_untrusted_counts_not_screened(method):
    count, van = r.check_parking_facility(75, 0, 0, method=method)
    assert count.status == r.FIELD and van.status == r.FIELD


def test_parking_inconsistent_counts():
    with pytest.raises(ValueError):
        r.check_parking_facility(10, 11, 0, method="field")
    with pytest.raises(ValueError):
        r.check_parking_facility(10, 1, 2, method="field")
    with pytest.raises(ValueError):
        r.check_parking_facility(10, 1, 1, method="guess")


def test_multi_facility_is_per_lot_not_summed():
    # Two 20-space lots need 1 + 1 = 2; one summed 40-space lot would also say 2,
    # but two 30-space lots need 2 + 2 = 4 while a summed 60 would say only 3.
    per_lot = sum(r.required_accessible_spaces(n) for n in (30, 30))
    assert per_lot == 4 and r.required_accessible_spaces(60) == 3


# ---- doors §404.2.3 --------------------------------------------------------
@pytest.mark.parametrize("width,depth,want", [
    (31.99, 4, r.FAIL), (32, 4, r.PASS), (32, 24, r.PASS), (32, 24.01, r.FAIL),
    (35.99, 25, r.FAIL), (36, 25, r.PASS), (30, 4, r.FAIL), (40, 30, r.PASS),
])
def test_door_thresholds_field_measured(width, depth, want):
    assert r.check_door(width, depth, "field").status == want


def test_door_missing_width():
    res = r.check_door(None, None, None)
    assert res.status == r.FIELD and res.observed is None


def test_door_unknown_depth_only_decides_when_depth_cannot_matter():
    assert r.check_door(30, None, "field").status == r.FAIL
    assert r.check_door(36, None, "field").status == r.PASS
    assert r.check_door(34, None, "field").status == r.FIELD


def test_door_image_estimate_never_pass_fail():
    assert r.check_door(20, 4, "image_estimate").status == r.FIELD
    assert r.check_door(48, 4, "image_estimate").status == r.FIELD
    assert r.check_door(30, 4, None).status == r.FIELD


def test_door_borderline_non_field_forces_review():
    res = r.check_door(31.7, 4, "model_metric")
    assert res.status == r.FIELD and res.borderline
    res = r.check_door(32.3, 4, "manual")
    assert res.status == r.FIELD and res.borderline
    # A field tape measurement is trusted at the threshold, but still flagged borderline.
    res = r.check_door(31.7, 4, "field")
    assert res.status == r.FAIL and res.borderline
    assert r.check_door(32, 4, "model_metric").status == r.PASS


def test_door_synthetic_method_compares_but_is_labelled():
    res = r.check_door(30, 4, r.SYNTHETIC_METHOD)
    assert res.status == r.FAIL and res.observed["method"] == r.SYNTHETIC_METHOD


@pytest.mark.parametrize("args", [(-1, 4, "field"), (30, -2, "field"), ("30", 4, "field"), (30, 4, "eyeball")])
def test_door_bad_input(args):
    with pytest.raises(ValueError):
        r.check_door(*args)


# ---- route width §403.5.1 --------------------------------------------------
@pytest.mark.parametrize("width,length,want", [
    (36, None, r.PASS), (35.99, 24, r.PASS), (35.99, 24.01, r.FAIL), (32, 24, r.PASS),
    (31.99, 10, r.FAIL), (34, None, r.FIELD), (None, None, r.FIELD),
])
def test_route_width(width, length, want):
    assert r.check_route_width(width, length, "field").status == want


def test_route_estimate_and_borderline():
    assert r.check_route_width(30, None, "image_estimate").status == r.FIELD
    assert r.check_route_width(35.8, 10, "manual").status == r.FIELD
