def test_public_pricing_catalogue_requires_no_login(client):
    response = client.get("/api/billing/plans")

    assert response.status_code == 200
    body = response.get_json()
    assert body["success"] is True
    assert body["creditExpiryDays"] == 30
    assert body["proDurationDays"] == 30
    assert body["customTopUp"]["minAmountInr"] == 100

    plans = {plan["id"]: plan for plan in body["plans"]}
    assert plans["starter"]["priceLabel"] == "₹528"
    assert plans["creator"]["credits"] == 14520
    assert plans["pro"]["track"] == "pro"
    assert plans["scale"]["checkoutEnabled"] is True
