"""
Property-based tests for the backtest engine.

Feature: quant-copilot-enhancement, Property 3: 回测引擎确定性与指标一致性

Validates: Requirements 3.2, 3.4

For any same strategy parameters and historical data, the backtest engine
should produce exactly the same results each run. And the sum of per-trade
PnL (after commission and slippage) should equal the total return.

Test framework: pytest + hypothesis
Minimum 100 iterations.
"""

import sys
import os
import math

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(__file__))

from stock_analysis import calculate_all_indicators
from backtest_engine import (
    run_backtest,
    compute_metrics,
    run_full_backtest,
    evaluate_condition,
    evaluate_condition_group,
    resolve_value,
)


# --- Hypothesis strategies for generating synthetic data ---

@st.composite
def synthetic_ohlcv(draw, min_length=60, max_length=200):
    """Generate synthetic OHLCV DataFrame suitable for backtesting.

    Ensures enough data for indicator computation (>= 50 rows).
    """
    n = draw(st.integers(min_value=min_length, max_value=max_length))
    start_price = draw(st.floats(min_value=20.0, max_value=300.0,
                                  allow_nan=False, allow_infinity=False))

    closes = []
    price = start_price
    for _ in range(n):
        change = draw(st.floats(min_value=-3.0, max_value=3.0,
                                 allow_nan=False, allow_infinity=False))
        price = max(1.0, price + change)
        closes.append(price)

    opens, highs, lows, volumes = [], [], [], []
    for c in closes:
        spread = max(0.02, c * 0.03)
        o = max(0.01, c + draw(st.floats(min_value=-spread, max_value=spread,
                                          allow_nan=False, allow_infinity=False)))
        h = max(c, o) + abs(draw(st.floats(min_value=0.01, max_value=spread,
                                            allow_nan=False, allow_infinity=False)))
        l = min(c, o) - abs(draw(st.floats(min_value=0.01, max_value=spread,
                                            allow_nan=False, allow_infinity=False)))
        l = max(0.01, l)
        h = max(h, l + 0.01)
        opens.append(o)
        highs.append(h)
        lows.append(l)
        volumes.append(float(draw(st.integers(min_value=10000, max_value=50_000_000))))

    idx = pd.date_range("2024-01-01", periods=n, freq="B")
    df = pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
        index=idx,
    )
    return df


@st.composite
def simple_strategy(draw):
    """Generate a simple strategy with SMA crossover conditions."""
    # Use SMA-based strategies since they're always computable with enough data
    indicators = ["sma20", "sma50"]
    comparators_cross = ["crosses_above", "crosses_below"]
    comparators_simple = [">", "<", ">=", "<="]

    entry_type = draw(st.sampled_from(["cross", "simple"]))
    if entry_type == "cross":
        entry_cond = {
            "indicator": "sma20",
            "comparator": "crosses_above",
            "value": "sma50",
        }
        exit_cond = {
            "indicator": "sma20",
            "comparator": "crosses_below",
            "value": "sma50",
        }
    else:
        ind = draw(st.sampled_from(["rsi14", "williams_r"]))
        comp = draw(st.sampled_from(comparators_simple))
        val = draw(st.floats(min_value=-100.0, max_value=100.0,
                              allow_nan=False, allow_infinity=False))
        entry_cond = {"indicator": ind, "comparator": comp, "value": val}
        # Exit with opposite comparator
        opp = {">" : "<", "<": ">", ">=": "<=", "<=": ">="}.get(comp, "<")
        exit_cond = {"indicator": ind, "comparator": opp, "value": val}

    sl_pct = draw(st.floats(min_value=0.01, max_value=0.20,
                             allow_nan=False, allow_infinity=False))
    tp_pct = draw(st.floats(min_value=0.01, max_value=0.30,
                             allow_nan=False, allow_infinity=False))

    strategy = {
        "name": "test_strategy",
        "entry_conditions": {
            "operator": "AND",
            "conditions": [entry_cond],
        },
        "exit_conditions": {
            "operator": "OR",
            "conditions": [exit_cond],
        },
        "stop_loss_rule": {"type": "percentage", "value": round(sl_pct, 4)},
        "take_profit_rule": {"type": "percentage", "value": round(tp_pct, 4)},
    }
    return strategy


@st.composite
def backtest_params(draw):
    """Generate valid backtest parameters (capital, commission, slippage)."""
    capital = draw(st.floats(min_value=1000.0, max_value=1_000_000.0,
                              allow_nan=False, allow_infinity=False))
    commission = draw(st.floats(min_value=0.0, max_value=0.01,
                                 allow_nan=False, allow_infinity=False))
    slippage = draw(st.floats(min_value=0.0, max_value=0.01,
                               allow_nan=False, allow_infinity=False))
    return round(capital, 2), round(commission, 6), round(slippage, 6)


# --- Property tests ---

class TestBacktestDeterminismAndConsistency:
    """
    Feature: quant-copilot-enhancement, Property 3: 回测引擎确定性与指标一致性

    Validates: Requirements 3.2, 3.4
    """

    @given(
        df=synthetic_ohlcv(min_length=60, max_length=150),
        strategy=simple_strategy(),
        params=backtest_params(),
    )
    @settings(max_examples=100, deadline=None)
    def test_determinism_same_inputs_same_outputs(self, df, strategy, params):
        """For identical inputs, the backtest engine must produce identical results.

        **Validates: Requirements 3.2**

        Running the same backtest twice with the same data and strategy
        should yield exactly the same trades and metrics.
        """
        capital, commission, slippage = params

        result1 = run_full_backtest(
            df.copy(), strategy, "TEST", "2024-01-01", "2024-12-31",
            capital, commission, slippage,
        )
        result2 = run_full_backtest(
            df.copy(), strategy, "TEST", "2024-01-01", "2024-12-31",
            capital, commission, slippage,
        )

        # Results must be identical
        assert result1["total_return"] == result2["total_return"], \
            f"total_return differs: {result1['total_return']} vs {result2['total_return']}"
        assert result1["annual_return"] == result2["annual_return"], \
            f"annual_return differs: {result1['annual_return']} vs {result2['annual_return']}"
        assert result1["max_drawdown"] == result2["max_drawdown"], \
            f"max_drawdown differs: {result1['max_drawdown']} vs {result2['max_drawdown']}"
        assert result1["sharpe_ratio"] == result2["sharpe_ratio"], \
            f"sharpe_ratio differs: {result1['sharpe_ratio']} vs {result2['sharpe_ratio']}"
        assert result1["win_rate"] == result2["win_rate"], \
            f"win_rate differs: {result1['win_rate']} vs {result2['win_rate']}"
        assert result1["profit_loss_ratio"] == result2["profit_loss_ratio"], \
            f"profit_loss_ratio differs"
        assert result1["total_trades"] == result2["total_trades"], \
            f"total_trades differs: {result1['total_trades']} vs {result2['total_trades']}"

        # Trade records must be identical
        assert len(result1["trades"]) == len(result2["trades"]), \
            f"Trade count differs: {len(result1['trades'])} vs {len(result2['trades'])}"
        for i, (t1, t2) in enumerate(zip(result1["trades"], result2["trades"])):
            assert t1 == t2, f"Trade {i} differs: {t1} vs {t2}"

    @given(
        df=synthetic_ohlcv(min_length=60, max_length=150),
        strategy=simple_strategy(),
        params=backtest_params(),
    )
    @settings(max_examples=100, deadline=None)
    def test_pnl_sum_equals_total_return(self, df, strategy, params):
        """Sum of per-trade PnL (after commission and slippage) should equal total return.

        **Validates: Requirements 3.4**

        The total_return metric is defined as sum(trade_pnl) / capital.
        This property verifies that relationship holds.
        """
        capital, commission, slippage = params
        assume(capital > 0)

        result = run_full_backtest(
            df.copy(), strategy, "TEST", "2024-01-01", "2024-12-31",
            capital, commission, slippage,
        )

        trades = result["trades"]
        total_return = result["total_return"]

        if len(trades) == 0:
            assert total_return == 0.0, \
                f"With no trades, total_return should be 0, got {total_return}"
            return

        # Sum of per-trade PnL
        pnl_sum = sum(t["pnl"] for t in trades)
        expected_return = pnl_sum / capital

        # Allow small floating point tolerance due to rounding
        assert abs(total_return - round(expected_return, 6)) < 1e-4, (
            f"PnL sum / capital = {expected_return}, but total_return = {total_return}. "
            f"PnL sum = {pnl_sum}, capital = {capital}, trades = {len(trades)}"
        )

    @given(
        df=synthetic_ohlcv(min_length=60, max_length=150),
        strategy=simple_strategy(),
        params=backtest_params(),
    )
    @settings(max_examples=100, deadline=None)
    def test_trade_pnl_consistent_with_prices(self, df, strategy, params):
        """Each trade's PnL should be consistent with entry/exit prices and costs.

        **Validates: Requirements 3.4**

        For each trade: pnl = exit_price - entry_price - entry_commission - exit_commission
        where entry_commission = entry_price * commission_rate
        and exit_commission = exit_price * commission_rate.
        """
        capital, commission, slippage = params

        # Compute indicators first
        df_with_indicators = calculate_all_indicators(df.copy())

        trades = run_backtest(df_with_indicators, strategy, capital, commission, slippage)

        for i, trade in enumerate(trades):
            entry_p = trade["entry_price"]
            exit_p = trade["exit_price"]
            reported_pnl = trade["pnl"]

            # Recompute expected PnL
            entry_comm = entry_p * commission
            exit_comm = exit_p * commission
            expected_pnl = exit_p - entry_p - entry_comm - exit_comm

            assert abs(reported_pnl - round(expected_pnl, 4)) < 1e-3, (
                f"Trade {i} PnL mismatch: reported={reported_pnl}, "
                f"expected={expected_pnl} (entry={entry_p}, exit={exit_p}, "
                f"commission={commission})"
            )

    @given(
        df=synthetic_ohlcv(min_length=60, max_length=150),
        strategy=simple_strategy(),
        params=backtest_params(),
    )
    @settings(max_examples=100, deadline=None)
    def test_max_drawdown_non_positive(self, df, strategy, params):
        """Max drawdown should always be <= 0 (it represents a loss from peak).

        **Validates: Requirements 3.2**
        """
        capital, commission, slippage = params
        assume(capital > 0)

        result = run_full_backtest(
            df.copy(), strategy, "TEST", "2024-01-01", "2024-12-31",
            capital, commission, slippage,
        )

        assert result["max_drawdown"] <= 0.0, \
            f"Max drawdown should be <= 0, got {result['max_drawdown']}"

    @given(
        df=synthetic_ohlcv(min_length=60, max_length=150),
        strategy=simple_strategy(),
        params=backtest_params(),
    )
    @settings(max_examples=100, deadline=None)
    def test_win_rate_bounded(self, df, strategy, params):
        """Win rate should always be in [0, 1].

        **Validates: Requirements 3.2**
        """
        capital, commission, slippage = params

        result = run_full_backtest(
            df.copy(), strategy, "TEST", "2024-01-01", "2024-12-31",
            capital, commission, slippage,
        )

        assert 0.0 <= result["win_rate"] <= 1.0, \
            f"Win rate should be in [0, 1], got {result['win_rate']}"
