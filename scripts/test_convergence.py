"""
Property-based tests for multi-timeframe convergence scoring.

Feature: quant-copilot-enhancement, Property 2: 多时间框架共振评分有界性与一致性

Validates: Requirements 2.3, 2.5

For any set of timeframe signals (daily/weekly/monthly), convergence_score
should always be in [0, 100]. When all timeframe signals are in the same
direction, convergence_score >= 80.
"""

import sys
import os

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

# Add scripts directory to path so we can import stock_analysis
sys.path.insert(0, os.path.dirname(__file__))

from stock_analysis import (
    compute_convergence_score,
    determine_signal_direction,
)


# --- Hypothesis strategies for generating timeframe indicator results ---

@st.composite
def indicator_result(draw):
    """Generate a single timeframe indicator result dict with realistic values."""
    rsi = draw(st.one_of(
        st.none(),
        st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False),
    ))
    macd_histogram = draw(st.one_of(
        st.none(),
        st.floats(min_value=-10.0, max_value=10.0, allow_nan=False, allow_infinity=False),
    ))
    sma20 = draw(st.one_of(
        st.none(),
        st.floats(min_value=1.0, max_value=1000.0, allow_nan=False, allow_infinity=False),
    ))
    sma50 = draw(st.one_of(
        st.none(),
        st.floats(min_value=1.0, max_value=1000.0, allow_nan=False, allow_infinity=False),
    ))
    # If one SMA is None, both should be None for consistency
    if sma20 is None or sma50 is None:
        sma20 = None
        sma50 = None

    return {
        "rsi14": rsi,
        "macd_histogram": macd_histogram,
        "sma20": sma20,
        "sma50": sma50,
    }


@st.composite
def bullish_indicator_result(draw):
    """Generate an indicator result that is definitively bullish.

    RSI > 50, MACD histogram > 0, SMA20 > SMA50.
    """
    rsi = draw(st.floats(min_value=50.01, max_value=100.0, allow_nan=False, allow_infinity=False))
    macd_histogram = draw(st.floats(min_value=0.01, max_value=10.0, allow_nan=False, allow_infinity=False))
    sma50 = draw(st.floats(min_value=1.0, max_value=500.0, allow_nan=False, allow_infinity=False))
    sma20 = draw(st.floats(min_value=sma50 + 0.01, max_value=sma50 + 500.0, allow_nan=False, allow_infinity=False))

    return {
        "rsi14": rsi,
        "macd_histogram": macd_histogram,
        "sma20": sma20,
        "sma50": sma50,
    }


@st.composite
def bearish_indicator_result(draw):
    """Generate an indicator result that is definitively bearish.

    RSI <= 50, MACD histogram <= 0, SMA20 <= SMA50.
    """
    rsi = draw(st.floats(min_value=0.0, max_value=49.99, allow_nan=False, allow_infinity=False))
    macd_histogram = draw(st.floats(min_value=-10.0, max_value=-0.01, allow_nan=False, allow_infinity=False))
    sma20 = draw(st.floats(min_value=1.0, max_value=500.0, allow_nan=False, allow_infinity=False))
    sma50 = draw(st.floats(min_value=sma20 + 0.01, max_value=sma20 + 500.0, allow_nan=False, allow_infinity=False))

    return {
        "rsi14": rsi,
        "macd_histogram": macd_histogram,
        "sma20": sma20,
        "sma50": sma50,
    }


@st.composite
def timeframe_results_any(draw):
    """Generate a dict of timeframe results with random indicator values.

    Each timeframe may be present or None.
    """
    results = {}
    for tf in ["daily", "weekly", "monthly"]:
        present = draw(st.booleans())
        if present:
            results[tf] = draw(indicator_result())
        else:
            results[tf] = None
    return results


@st.composite
def timeframe_results_all_bullish(draw):
    """Generate timeframe results where ALL timeframes are bullish."""
    return {
        "daily": draw(bullish_indicator_result()),
        "weekly": draw(bullish_indicator_result()),
        "monthly": draw(bullish_indicator_result()),
    }


@st.composite
def timeframe_results_all_bearish(draw):
    """Generate timeframe results where ALL timeframes are bearish."""
    return {
        "daily": draw(bearish_indicator_result()),
        "weekly": draw(bearish_indicator_result()),
        "monthly": draw(bearish_indicator_result()),
    }


class TestConvergenceScoreBoundedness:
    """
    Feature: quant-copilot-enhancement, Property 2: 多时间框架共振评分有界性与一致性

    Validates: Requirements 2.3, 2.5
    """

    @given(tf_results=timeframe_results_any())
    @settings(max_examples=100)
    def test_score_always_in_0_100(self, tf_results):
        """convergence_score should always be in [0, 100] for any input."""
        score = compute_convergence_score(tf_results)
        assert isinstance(score, int), f"Score should be int, got {type(score)}"
        assert 0 <= score <= 100, f"Score {score} out of bounds [0, 100]"

    @given(tf_results=timeframe_results_all_bullish())
    @settings(max_examples=100)
    def test_all_bullish_score_gte_80(self, tf_results):
        """When all timeframes signal bullish, convergence_score >= 80."""
        # Verify all are indeed bullish
        for tf in ["daily", "weekly", "monthly"]:
            direction = determine_signal_direction(tf_results[tf])
            assert direction == "bullish", f"{tf} should be bullish, got {direction}"

        score = compute_convergence_score(tf_results)
        assert score >= 80, (
            f"All-bullish score should be >= 80, got {score}. "
            f"Results: {tf_results}"
        )

    @given(tf_results=timeframe_results_all_bearish())
    @settings(max_examples=100)
    def test_all_bearish_score_gte_80(self, tf_results):
        """When all timeframes signal bearish, convergence_score >= 80."""
        # Verify all are indeed bearish
        for tf in ["daily", "weekly", "monthly"]:
            direction = determine_signal_direction(tf_results[tf])
            assert direction == "bearish", f"{tf} should be bearish, got {direction}"

        score = compute_convergence_score(tf_results)
        assert score >= 80, (
            f"All-bearish score should be >= 80, got {score}. "
            f"Results: {tf_results}"
        )

    @given(tf_results=timeframe_results_any())
    @settings(max_examples=100)
    def test_empty_timeframes_score_zero(self, tf_results):
        """When all timeframes are None, score should be 0."""
        all_none = {tf: None for tf in ["daily", "weekly", "monthly"]}
        score = compute_convergence_score(all_none)
        assert score == 0, f"All-None score should be 0, got {score}"
