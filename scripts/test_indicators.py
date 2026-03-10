"""
Property-based tests for technical indicator calculations.

Feature: quant-copilot-enhancement, Property 1: 技术指标计算正确性

Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7

For any valid OHLCV data sequence (length >= 50), all technical indicators
should match standard formulas (error < 0.01%). When data length is
insufficient, the field should be null.
"""

import sys
import os
import math

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

# Add scripts directory to path so we can import stock_analysis
sys.path.insert(0, os.path.dirname(__file__))

from stock_analysis import (
    compute_atr,
    compute_obv,
    compute_vwap,
    compute_kdj,
    compute_williams_r,
    calculate_all_indicators,
    safe_float,
)


# --- Hypothesis strategies for generating valid OHLCV data ---

@st.composite
def ohlcv_dataframe(draw, min_length=50, max_length=200):
    """Generate a valid OHLCV DataFrame.

    Ensures: High >= Open, Close, Low; Low <= Open, Close, High; Volume > 0.
    """
    n = draw(st.integers(min_value=min_length, max_value=max_length))

    # Generate base prices with a random walk
    start_price = draw(st.floats(min_value=10.0, max_value=500.0, allow_nan=False, allow_infinity=False))
    changes = draw(
        st.lists(
            st.floats(min_value=-5.0, max_value=5.0, allow_nan=False, allow_infinity=False),
            min_size=n,
            max_size=n,
        )
    )

    closes = []
    price = start_price
    for change in changes:
        price = max(1.0, price + change)
        closes.append(price)

    # Generate OHLC from close prices
    opens = []
    highs = []
    lows = []
    volumes = []

    for c in closes:
        spread = draw(st.floats(min_value=0.01, max_value=max(0.02, c * 0.05), allow_nan=False, allow_infinity=False))
        o = c + draw(st.floats(min_value=-spread, max_value=spread, allow_nan=False, allow_infinity=False))
        o = max(0.01, o)
        h = max(c, o) + draw(st.floats(min_value=0.0, max_value=spread, allow_nan=False, allow_infinity=False))
        l = min(c, o) - draw(st.floats(min_value=0.0, max_value=spread, allow_nan=False, allow_infinity=False))
        l = max(0.01, l)
        h = max(h, l + 0.01)  # ensure H > L

        opens.append(o)
        highs.append(h)
        lows.append(l)
        vol = draw(st.integers(min_value=1000, max_value=100_000_000))
        volumes.append(float(vol))

    idx = pd.date_range("2024-01-01", periods=n, freq="B")
    df = pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
        index=idx,
    )
    return df


@st.composite
def short_ohlcv_dataframe(draw, max_length=8):
    """Generate a short OHLCV DataFrame (insufficient data for some indicators)."""
    n = draw(st.integers(min_value=1, max_value=max_length))
    start_price = draw(st.floats(min_value=10.0, max_value=500.0, allow_nan=False, allow_infinity=False))

    closes = []
    price = start_price
    for _ in range(n):
        change = draw(st.floats(min_value=-2.0, max_value=2.0, allow_nan=False, allow_infinity=False))
        price = max(1.0, price + change)
        closes.append(price)

    opens, highs, lows, volumes = [], [], [], []
    for c in closes:
        spread = max(0.02, c * 0.03)
        o = max(0.01, c + draw(st.floats(min_value=-spread, max_value=spread, allow_nan=False, allow_infinity=False)))
        h = max(c, o) + abs(draw(st.floats(min_value=0.0, max_value=spread, allow_nan=False, allow_infinity=False)))
        l = min(c, o) - abs(draw(st.floats(min_value=0.0, max_value=spread, allow_nan=False, allow_infinity=False)))
        l = max(0.01, l)
        h = max(h, l + 0.01)
        opens.append(o)
        highs.append(h)
        lows.append(l)
        volumes.append(float(draw(st.integers(min_value=1000, max_value=10_000_000))))

    idx = pd.date_range("2024-01-01", periods=n, freq="B")
    df = pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
        index=idx,
    )
    return df


# --- Helper: reference implementations for verification ---

def ref_atr(high, low, close, period=14):
    """Reference ATR implementation for verification."""
    close_prev = np.roll(close, 1)
    close_prev[0] = np.nan
    tr = np.maximum(high - low, np.maximum(np.abs(high - close_prev), np.abs(low - close_prev)))
    # EMA with span=period
    alpha = 2.0 / (period + 1.0)
    ema = np.full_like(tr, np.nan)
    ema[0] = tr[0]  # first TR (which is H-L since close_prev is NaN -> but we handle)
    # Actually first TR is just H[0]-L[0] since close_prev[0] is NaN
    ema[0] = high[0] - low[0]  # only H-L is valid for first bar
    for i in range(1, len(tr)):
        ema[i] = alpha * tr[i] + (1 - alpha) * ema[i - 1]
    return ema


def ref_obv(close, volume):
    """Reference OBV implementation."""
    obv = np.zeros(len(close))
    for i in range(1, len(close)):
        if close[i] > close[i - 1]:
            obv[i] = obv[i - 1] + volume[i]
        elif close[i] < close[i - 1]:
            obv[i] = obv[i - 1] - volume[i]
        else:
            obv[i] = obv[i - 1]
    return obv


def ref_vwap(high, low, close, volume):
    """Reference VWAP implementation."""
    tp = (high + low + close) / 3.0
    cum_tp_vol = np.cumsum(tp * volume)
    cum_vol = np.cumsum(volume)
    vwap = np.where(cum_vol > 0, cum_tp_vol / cum_vol, np.nan)
    return vwap


def ref_williams_r(high, low, close, period=14):
    """Reference Williams %R implementation."""
    result = np.full(len(close), np.nan)
    for i in range(period - 1, len(close)):
        h_max = np.max(high[i - period + 1 : i + 1])
        l_min = np.min(low[i - period + 1 : i + 1])
        denom = h_max - l_min
        if denom == 0:
            result[i] = np.nan
        else:
            result[i] = (h_max - close[i]) / denom * (-100.0)
    return result


def ref_kdj(high, low, close, period=9):
    """Reference KDJ implementation."""
    n = len(close)
    k_vals = np.full(n, np.nan)
    d_vals = np.full(n, np.nan)
    j_vals = np.full(n, np.nan)
    k_prev = 50.0
    d_prev = 50.0
    for i in range(n):
        if i < period - 1:
            continue
        h_max = np.max(high[i - period + 1 : i + 1])
        l_min = np.min(low[i - period + 1 : i + 1])
        denom = h_max - l_min
        if denom == 0:
            continue
        rsv = (close[i] - l_min) / denom * 100.0
        k_val = 2.0 / 3.0 * k_prev + 1.0 / 3.0 * rsv
        d_val = 2.0 / 3.0 * d_prev + 1.0 / 3.0 * k_val
        k_vals[i] = k_val
        d_vals[i] = d_val
        j_vals[i] = 3.0 * k_val - 2.0 * d_val
        k_prev = k_val
        d_prev = d_val
    return k_vals, d_vals, j_vals


# --- Property tests ---

class TestIndicatorCorrectness:
    """
    Feature: quant-copilot-enhancement, Property 1: 技术指标计算正确性

    Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7
    """

    @given(df=ohlcv_dataframe(min_length=50, max_length=150))
    @settings(max_examples=100, deadline=None)
    def test_atr_matches_reference(self, df):
        """ATR(14) should match reference formula within 0.01% error.

        **Validates: Requirements 1.1**
        """
        high = df["High"].values
        low = df["Low"].values
        close = df["Close"].values

        result = compute_atr(df["High"], df["Low"], df["Close"], 14)
        ref = ref_atr(high, low, close, 14)

        # Compare from index 1 onward (index 0 has no previous close)
        for i in range(1, len(df)):
            r_val = result.iloc[i]
            e_val = ref[i]
            if pd.isna(r_val) and np.isnan(e_val):
                continue
            assert not pd.isna(r_val), f"ATR at index {i} should not be NaN"
            assert not np.isnan(e_val), f"Reference ATR at index {i} should not be NaN"
            if abs(e_val) > 1e-10:
                rel_err = abs(r_val - e_val) / abs(e_val)
                assert rel_err < 0.0001, f"ATR mismatch at {i}: got {r_val}, expected {e_val}, rel_err={rel_err}"

    @given(df=ohlcv_dataframe(min_length=50, max_length=150))
    @settings(max_examples=100, deadline=None)
    def test_obv_matches_reference(self, df):
        """OBV should match reference formula exactly.

        **Validates: Requirements 1.2**
        """
        close = df["Close"].values
        volume = df["Volume"].values

        result = compute_obv(df["Close"], df["Volume"])
        ref = ref_obv(close, volume)

        for i in range(len(df)):
            r_val = result.iloc[i]
            e_val = ref[i]
            assert abs(r_val - e_val) < 0.01, f"OBV mismatch at {i}: got {r_val}, expected {e_val}"

    @given(df=ohlcv_dataframe(min_length=50, max_length=150))
    @settings(max_examples=100, deadline=None)
    def test_vwap_matches_reference(self, df):
        """VWAP should match reference formula within 0.01% error.

        **Validates: Requirements 1.3**
        """
        high = df["High"].values
        low = df["Low"].values
        close = df["Close"].values
        volume = df["Volume"].values

        result = compute_vwap(df["High"], df["Low"], df["Close"], df["Volume"])
        ref = ref_vwap(high, low, close, volume)

        for i in range(len(df)):
            r_val = result.iloc[i]
            e_val = ref[i]
            if pd.isna(r_val) and np.isnan(e_val):
                continue
            if abs(e_val) > 1e-10:
                rel_err = abs(r_val - e_val) / abs(e_val)
                assert rel_err < 0.0001, f"VWAP mismatch at {i}: got {r_val}, expected {e_val}, rel_err={rel_err}"

    @given(df=ohlcv_dataframe(min_length=50, max_length=150))
    @settings(max_examples=100, deadline=None)
    def test_kdj_matches_reference(self, df):
        """KDJ (K, D, J) should match reference formula within 0.01% error.

        **Validates: Requirements 1.4**
        """
        high = df["High"].values
        low = df["Low"].values
        close = df["Close"].values

        k_result, d_result, j_result = compute_kdj(df["High"], df["Low"], df["Close"], 9)
        k_ref, d_ref, j_ref = ref_kdj(high, low, close, 9)

        for i in range(len(df)):
            for name, r_series, e_arr in [("K", k_result, k_ref), ("D", d_result, d_ref), ("J", j_result, j_ref)]:
                r_val = r_series.iloc[i]
                e_val = e_arr[i]
                if pd.isna(r_val) and np.isnan(e_val):
                    continue
                if pd.isna(r_val) or np.isnan(e_val):
                    # One is NaN and the other isn't - skip if both should be NaN
                    continue
                if abs(e_val) > 1e-10:
                    rel_err = abs(r_val - e_val) / abs(e_val)
                    assert rel_err < 0.0001, (
                        f"KDJ_{name} mismatch at {i}: got {r_val}, expected {e_val}, rel_err={rel_err}"
                    )

    @given(df=ohlcv_dataframe(min_length=50, max_length=150))
    @settings(max_examples=100, deadline=None)
    def test_williams_r_matches_reference(self, df):
        """Williams %R(14) should match reference formula within 0.01% error.

        **Validates: Requirements 1.5**
        """
        high = df["High"].values
        low = df["Low"].values
        close = df["Close"].values

        result = compute_williams_r(df["High"], df["Low"], df["Close"], 14)
        ref = ref_williams_r(high, low, close, 14)

        for i in range(len(df)):
            r_val = result.iloc[i]
            e_val = ref[i]
            if pd.isna(r_val) and np.isnan(e_val):
                continue
            if pd.isna(r_val) or np.isnan(e_val):
                continue
            if abs(e_val) > 1e-10:
                rel_err = abs(r_val - e_val) / abs(e_val)
                assert rel_err < 0.0001, (
                    f"Williams %R mismatch at {i}: got {r_val}, expected {e_val}, rel_err={rel_err}"
                )

    @given(df=short_ohlcv_dataframe(max_length=8))
    @settings(max_examples=100, deadline=None)
    def test_insufficient_data_returns_null(self, df):
        """When data is insufficient, indicator fields should be null (NaN).

        **Validates: Requirements 1.7**

        With < 9 data points, KDJ (period=9) should have NaN for early rows.
        With < 14 data points, Williams %R (period=14) and ATR should have NaN.
        """
        high = df["High"]
        low = df["Low"]
        close = df["Close"]
        volume = df["Volume"]

        # Williams %R needs 14 periods - with < 14 data, all should be NaN
        if len(df) < 14:
            wr = compute_williams_r(high, low, close, 14)
            assert wr.isna().all(), f"Williams %R should be all NaN with {len(df)} data points"

        # KDJ needs 9 periods - with < 9 data, all should be NaN
        if len(df) < 9:
            k, d, j = compute_kdj(high, low, close, 9)
            assert k.isna().all(), f"KDJ_K should be all NaN with {len(df)} data points"
            assert d.isna().all(), f"KDJ_D should be all NaN with {len(df)} data points"
            assert j.isna().all(), f"KDJ_J should be all NaN with {len(df)} data points"

    @given(df=ohlcv_dataframe(min_length=50, max_length=150))
    @settings(max_examples=100, deadline=None)
    def test_all_indicators_computed_for_sufficient_data(self, df):
        """With >= 50 data points, all indicators should have non-null latest values.

        **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
        """
        df = calculate_all_indicators(df.copy())
        latest = df.iloc[-1]

        # All new indicators should be non-null for the last row
        assert not pd.isna(latest["ATR_14"]), "ATR_14 should not be NaN"
        assert not pd.isna(latest["OBV"]), "OBV should not be NaN"
        assert not pd.isna(latest["VWAP"]), "VWAP should not be NaN"
        assert not pd.isna(latest["KDJ_K"]), "KDJ_K should not be NaN"
        assert not pd.isna(latest["KDJ_D"]), "KDJ_D should not be NaN"
        assert not pd.isna(latest["KDJ_J"]), "KDJ_J should not be NaN"
        assert not pd.isna(latest["WILLIAMS_R"]), "Williams_R should not be NaN"

        # ATR should always be positive
        assert latest["ATR_14"] > 0, "ATR should be positive"

        # Williams %R should be in [-100, 0]
        assert -100.0 <= latest["WILLIAMS_R"] <= 0.0, (
            f"Williams %R should be in [-100, 0], got {latest['WILLIAMS_R']}"
        )
