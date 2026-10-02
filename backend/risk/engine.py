def position_size(balance: float, risk_percent: float, stop_distance: float, pip_value: float = 1.0) -> dict[str, float]:
    if balance <= 0 or stop_distance <= 0 or pip_value <= 0 or not 0 < risk_percent <= 5:
        raise ValueError("Balance and stop distance must be positive; risk must be between 0 and 5 percent")
    risk_amount = balance * risk_percent / 100
    return {"risk_amount": round(risk_amount, 2), "position_size": round(risk_amount / (stop_distance * pip_value), 4)}
