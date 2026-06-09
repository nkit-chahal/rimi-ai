import json


def _login(client, email="tester@example.com", password="Test@12345"):
    return client.post(
        "/api/signup/request-otp",
        data=json.dumps({"email": email, "password": password, "name": "Tester"}),
        content_type="application/json",
    )


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json().get("status") == "ok"


def test_protected_upload_requires_auth(client):
    response = client.post("/api/upload")
    assert response.status_code == 401


def test_credits_check_requires_auth(client):
    response = client.post(
        "/api/credits/check",
        data=json.dumps({"toolKey": "extract"}),
        content_type="application/json",
    )
    assert response.status_code == 401
