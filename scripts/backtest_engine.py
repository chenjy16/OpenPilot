#!/usr/bin/env python3
"""
Strategy Backtest Engine

Runs historical backtests for trading strategies on stock data.
Uses yfinance for data and reuses indicator functions from stock_analysis.py.

Usage:
    python scripts/backtest_engine.py --strategy '{"name":"golden_cross",...}' \
        --symbol AAPL --start 2024-01-01 --end 2024-12-31 \
        --capital 100000 --commission 0.001 --slippage 0.001

Output (stdout):
    JSON with backtest results including metrics and trade records.

Exit codes:
    0 = success
    1 = error
"""

import sys
import os
import json
import argparse
import math
from datetime import datetime

import numpy as np
import pandas as pd

# Add scripts directory to path so we can import stock_analysis
sys.path.insert(0, os.path.dirname(__file__))

from stock_analysis import calculate_all_indicators, output_error, safe_float


# --- Indicator column mapping ---
INDICATOR_COLUMN_MAP = {
    "sma20": "SMA_20",
    "sma50": "SMA_50",
    "rsi14": "RSI_14",
    "macd_line": "MACD_12_26_9",
    "macd_signal": "MACDs_12_26_9",
    "macd_histogram": "MACDh_12_26_9",
    "bollinger_upper": "BBU_20_2.0",
    "bollinger_lower": "BBL_20_2.0",
    "atr14": "ATR_14",
    "obv": "OBV",
    "vwap": "VWAP",
    "kdj_k": "KDJ_K",
    "kdj_d": "KDJ_D",
    "kdj_j": "KDJ_J",
    "williams_r": "WILLIAMS_R",
    "close": "Close",
    "open": "Open",
    "high": "High",
    "low": "Low",
    "volume": "Volume",
}


def resolve_value(row, prev_row, value):
    """Resolve a condition value — either a numeric literal or an indicator name."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        col = INDICATOR_COLUMN_MAP.get(value)
        if col and col in row.index:
            v = row[col]
            return float(v) if not pd.isna(v) else None
    return None


def evaluate_condition(row, prev_row, condition):
    """Evaluate a single condition against current and previous row data.

    Returns True/False, or None if data is insufficient.
    """
    indicator_name = condition.get("indicator", "")
    comparator = condition.get("comparator", "")
    value = condition.get("value")

    col = INDICATOR_COLUMN_MAP.get(indicator_name)
    if col is None or col not in row.index:
        return None

    current_val = row[col]
    if pd.isna(current_val):
        return None
    current_val = float(current_val)

    if comparator in ("crosses_above", "crosses_below"):
        # Need previous row
        if prev_row is None:
            return None
        prev_indicator = prev_row[col] if col in prev_row.index else None
        if prev_indicator is None or pd.isna(prev_indicator):
            return None
        prev_indicator = float(prev_indicator)

        target_current = resolve_value(row, prev_row, value)
        if target_current is None:
            return None

        # Resolve previous target value
        if isinstance(value, str):
            target_col = INDICATOR_COLUMN_MAP.get(value)
            if target_col and target_col in prev_row.index:
                target_prev = prev_row[target_col]
                if pd.isna(target_prev):
                    return None
                target_prev = float(target_prev)
            else:
                return None
        else:
            target_prev = float(value)

        if comparator == "crosses_above":
            return prev_indicator <= target_prev and current_val > target_current
        else:  # crosses_below
            return prev_indicator >= target_prev and current_val < target_current
    else:
        target = resolve_value(row, prev_row, value)
        if target is None:
            return None
        if comparator == ">":
            return current_val > target
        elif comparator == "<":
            return current_val < target
        elif comparator == ">=":
            return current_val >= target
        elif comparator == "<=":
            return current_val <= target
        return None


def evaluate_condition_group(row, prev_row, group):
    """Evaluate a condition group (AND/OR) against row data.

    Conditions that return None (insufficient data) are skipped.
    For AND: all non-None results must be True (empty valid results → False).
    For OR: any non-None result being True is sufficient.
    """
    operator = group.get("operator", "AND")
    conditions = group.get("conditions", [])

    if not conditions:
        return False

    results = []
    for cond in conditions:
        result = evaluate_condition(row, prev_row, cond)
        if result is not None:
            results.append(result)

    # If all conditions returned None (no usable data), don't trigger
    if not results:
        return False

    if operator == "AND":
        return all(results)
    else:  # OR
        return any(results)


def run_backtest(df, strategy, capital=100000.0, commission=0.001, slippage=0.001):
    """Run a backtest on pre-computed indicator DataFrame.

    Args:
        df: DataFrame with OHLCV + indicator columns (from calculate_all_indicators).
        strategy: Strategy dict with entry_conditions, exit_conditions, stop_loss_rule, take_profit_rule.
        capital: Initial capital.
        commission: Commission rate (applied on both entry and exit).
        slippage: Slippage rate (applied on both entry and exit).

    Returns:
        list of trade dicts.
    """
    entry_conditions = strategy.get("entry_conditions", {})
    exit_conditions = strategy.get("exit_conditions", {})
    stop_loss_rule = strategy.get("stop_loss_rule", {})
    take_profit_rule = strategy.get("take_profit_rule", {})
    direction = strategy.get("direction", "long")  # "long" or "short"

    # Resolve stop-loss level
    sl_type = stop_loss_rule.get("type", "")
    sl_value = stop_loss_rule.get("value", 0.0)

    # Resolve take-profit level
    tp_type = take_profit_rule.get("type", "")
    tp_value = take_profit_rule.get("value", 0.0)

    def compute_sl_level(entry_p, row):
        """Compute stop-loss price level based on rule type."""
        if sl_type == "percentage" and sl_value > 0:
            if direction == "long":
                return entry_p * (1.0 - sl_value)
            else:
                return entry_p * (1.0 + sl_value)
        elif sl_type == "fixed" and sl_value > 0:
            return sl_value
        elif sl_type == "atr" and sl_value > 0:
            atr = float(row.get("ATR_14", 0)) if "ATR_14" in row.index and not pd.isna(row.get("ATR_14")) else 0
            if atr > 0:
                if direction == "long":
                    return entry_p - sl_value * atr
                else:
                    return entry_p + sl_value * atr
        return None

    def compute_tp_level(entry_p, row):
        """Compute take-profit price level based on rule type."""
        if tp_type == "percentage" and tp_value > 0:
            if direction == "long":
                return entry_p * (1.0 + tp_value)
            else:
                return entry_p * (1.0 - tp_value)
        elif tp_type == "fixed" and tp_value > 0:
            return tp_value
        elif tp_type == "risk_reward" and tp_value > 0:
            sl_level = compute_sl_level(entry_p, row)
            if sl_level is not None:
                risk = abs(entry_p - sl_level)
                if direction == "long":
                    return entry_p + risk * tp_value
                else:
                    return entry_p - risk * tp_value
        return None

    trades = []
    in_position = False
    entry_price = 0.0
    entry_time = None
    entry_cost = 0.0  # actual cost including commission + slippage

    is_long = direction != "short"

    for i in range(1, len(df)):
        row = df.iloc[i]
        prev_row = df.iloc[i - 1]
        close_price = float(row["Close"])
        date_str = str(row.name.date()) if hasattr(row.name, "date") else str(row.name)

        if not in_position:
            # Check entry conditions
            if evaluate_condition_group(row, prev_row, entry_conditions):
                if is_long:
                    entry_price = close_price * (1.0 + slippage)
                else:
                    entry_price = close_price * (1.0 - slippage)
                entry_cost = entry_price * commission
                entry_time = date_str
                in_position = True
        else:
            # Check exit conditions: stop loss, take profit, or exit signal
            exit_price = None
            exit_reason = None

            # Check stop loss
            sl_level = compute_sl_level(entry_price, row)
            if sl_level is not None:
                if is_long and close_price <= sl_level:
                    exit_price = close_price * (1.0 - slippage)
                    exit_reason = "stop_loss"
                elif not is_long and close_price >= sl_level:
                    exit_price = close_price * (1.0 + slippage)
                    exit_reason = "stop_loss"

            # Check take profit
            if exit_price is None:
                tp_level = compute_tp_level(entry_price, row)
                if tp_level is not None:
                    if is_long and close_price >= tp_level:
                        exit_price = close_price * (1.0 - slippage)
                        exit_reason = "take_profit"
                    elif not is_long and close_price <= tp_level:
                        exit_price = close_price * (1.0 + slippage)
                        exit_reason = "take_profit"

            # Check exit signal conditions
            if exit_price is None and evaluate_condition_group(row, prev_row, exit_conditions):
                if is_long:
                    exit_price = close_price * (1.0 - slippage)
                else:
                    exit_price = close_price * (1.0 + slippage)
                exit_reason = "signal"

            if exit_price is not None:
                exit_cost = exit_price * commission
                if is_long:
                    pnl = exit_price - entry_price - entry_cost - exit_cost
                else:
                    pnl = entry_price - exit_price - entry_cost - exit_cost
                pnl_pct = pnl / entry_price if entry_price != 0 else 0.0

                trades.append({
                    "open_time": entry_time,
                    "close_time": date_str,
                    "direction": direction,
                    "entry_price": round(entry_price, 4),
                    "exit_price": round(exit_price, 4),
                    "pnl": round(pnl, 4),
                    "pnl_pct": round(pnl_pct, 6),
                })
                in_position = False

    # Close any open position at the end
    if in_position and len(df) > 0:
        last_row = df.iloc[-1]
        close_price = float(last_row["Close"])
        date_str = str(last_row.name.date()) if hasattr(last_row.name, "date") else str(last_row.name)
        if is_long:
            exit_price = close_price * (1.0 - slippage)
        else:
            exit_price = close_price * (1.0 + slippage)
        exit_cost = exit_price * commission
        if is_long:
            pnl = exit_price - entry_price - entry_cost - exit_cost
        else:
            pnl = entry_price - exit_price - entry_cost - exit_cost
        pnl_pct = pnl / entry_price if entry_price != 0 else 0.0
        trades.append({
            "open_time": entry_time,
            "close_time": date_str,
            "direction": direction,
            "entry_price": round(entry_price, 4),
            "exit_price": round(exit_price, 4),
            "pnl": round(pnl, 4),
            "pnl_pct": round(pnl_pct, 6),
        })

    return trades


def compute_metrics(trades, capital, start_date, end_date):
    """Compute backtest performance metrics from trade records.

    Args:
        trades: List of trade dicts with pnl, pnl_pct fields.
        capital: Initial capital.
        start_date: Backtest start date string.
        end_date: Backtest end date string.

    Returns:
        dict with total_return, annual_return, max_drawdown, sharpe_ratio, win_rate, profit_loss_ratio.
    """
    total_trades = len(trades)

    if total_trades == 0:
        return {
            "total_return": 0.0,
            "annual_return": 0.0,
            "max_drawdown": 0.0,
            "sharpe_ratio": 0.0,
            "win_rate": 0.0,
            "profit_loss_ratio": 0.0,
            "total_trades": 0,
        }

    # Total return from sum of per-trade PnL
    total_pnl = sum(t["pnl"] for t in trades)
    total_return = total_pnl / capital if capital != 0 else 0.0

    # Annual return
    try:
        d_start = datetime.strptime(start_date, "%Y-%m-%d")
        d_end = datetime.strptime(end_date, "%Y-%m-%d")
        days = (d_end - d_start).days
        if days > 0:
            annual_return = (1.0 + total_return) ** (365.0 / days) - 1.0
        else:
            annual_return = 0.0
    except (ValueError, TypeError):
        annual_return = 0.0

    # Max drawdown (based on cumulative equity curve)
    equity = capital
    peak = capital
    max_dd = 0.0
    for t in trades:
        equity += t["pnl"]
        if equity > peak:
            peak = equity
        dd = (equity - peak) / peak if peak != 0 else 0.0
        if dd < max_dd:
            max_dd = dd

    # Win rate
    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    win_rate = len(wins) / total_trades if total_trades > 0 else 0.0

    # Profit/loss ratio
    avg_win = np.mean([t["pnl"] for t in wins]) if wins else 0.0
    avg_loss = abs(np.mean([t["pnl"] for t in losses])) if losses else 0.0
    profit_loss_ratio = avg_win / avg_loss if avg_loss > 0 else 0.0

    # Sharpe ratio (based on per-trade returns, annualized by actual trading frequency)
    returns = [t["pnl_pct"] for t in trades]
    if len(returns) > 1:
        mean_ret = np.mean(returns)
        std_ret = np.std(returns, ddof=1)
        if std_ret > 0:
            # Estimate trades per year from actual backtest duration
            try:
                d_start_s = datetime.strptime(start_date, "%Y-%m-%d")
                d_end_s = datetime.strptime(end_date, "%Y-%m-%d")
                backtest_days = max((d_end_s - d_start_s).days, 1)
                trades_per_year = total_trades * (365.0 / backtest_days)
            except (ValueError, TypeError):
                trades_per_year = total_trades  # fallback
            sharpe_ratio = mean_ret / std_ret * math.sqrt(max(trades_per_year, 1))
        else:
            sharpe_ratio = 0.0
    else:
        sharpe_ratio = 0.0

    return {
        "total_return": round(total_return, 6),
        "annual_return": round(annual_return, 6),
        "max_drawdown": round(max_dd, 6),
        "sharpe_ratio": round(sharpe_ratio, 4),
        "win_rate": round(win_rate, 4),
        "profit_loss_ratio": round(profit_loss_ratio, 4),
        "total_trades": total_trades,
    }


def run_full_backtest(df, strategy, symbol, start_date, end_date,
                      capital=100000.0, commission=0.001, slippage=0.001):
    """Run a complete backtest and return the full result JSON.

    This is the main entry point that combines trade simulation and metrics.
    """
    # Compute indicators
    df = calculate_all_indicators(df.copy())

    # Run trade simulation
    trades = run_backtest(df, strategy, capital, commission, slippage)

    # Compute metrics
    metrics = compute_metrics(trades, capital, start_date, end_date)

    result = {
        "symbol": symbol,
        "strategy": strategy.get("name", "unknown"),
        "total_return": metrics["total_return"],
        "annual_return": metrics["annual_return"],
        "max_drawdown": metrics["max_drawdown"],
        "sharpe_ratio": metrics["sharpe_ratio"],
        "win_rate": metrics["win_rate"],
        "profit_loss_ratio": metrics["profit_loss_ratio"],
        "total_trades": metrics["total_trades"],
        "trades": trades,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description="Strategy Backtest Engine")
    parser.add_argument("--strategy", required=True, help="Strategy JSON string")
    parser.add_argument("--symbol", required=True, help="Stock ticker symbol")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--capital", type=float, default=100000.0, help="Initial capital")
    parser.add_argument("--commission", type=float, default=0.001, help="Commission rate")
    parser.add_argument("--slippage", type=float, default=0.001, help="Slippage rate")

    args = parser.parse_args()

    # Parse strategy JSON
    try:
        strategy = json.loads(args.strategy)
    except json.JSONDecodeError as e:
        output_error("INVALID_STRATEGY", f"Failed to parse strategy JSON: {e}")

    symbol = args.symbol.strip().upper()
    if not symbol:
        output_error("INVALID_SYMBOL", "Stock symbol cannot be empty")

    # Validate dates
    try:
        start_dt = datetime.strptime(args.start, "%Y-%m-%d")
        end_dt = datetime.strptime(args.end, "%Y-%m-%d")
        if end_dt <= start_dt:
            output_error("INVALID_DATES", "End date must be after start date")
    except ValueError as e:
        output_error("INVALID_DATES", f"Invalid date format: {e}")

    # Fetch data using yfinance
    try:
        import yfinance as yf
    except ImportError as e:
        output_error("DEPENDENCY_ERROR", f"Missing required dependency: {e}")

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=args.start, end=args.end)
    except Exception as e:
        output_error("FETCH_ERROR", f"Failed to fetch data for {symbol}: {e}")

    if df is None or df.empty:
        output_error("INVALID_SYMBOL", f"No data available for {symbol} in the specified date range")

    if len(df) < 50:
        output_error("INSUFFICIENT_DATA",
                     f"Insufficient data for {symbol}: only {len(df)} data points (need at least 50)")

    # Run backtest
    result = run_full_backtest(df, strategy, symbol, args.start, args.end,
                               args.capital, args.commission, args.slippage)

    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        output_error("UNEXPECTED_ERROR", f"An unexpected error occurred: {e}")
