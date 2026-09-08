import app.main as main


def test_disabled_password_login_cannot_bypass_google_login(client, monkeypatch):
    monkeypatch.setattr(main, "APP_PASSWORD", None)
    monkeypatch.setattr(main, "AUTH_ENABLED", True)
    monkeypatch.setattr(main, "GOOGLE_AUTH_ENABLED", True)
    response = client.post("/auth/login", json={"password": ""})
    assert response.status_code == 403
    assert "token" not in response.json()
    assert client.get("/auth/me").status_code == 401


def test_configured_password_requires_correct_secret(client, monkeypatch):
    monkeypatch.setattr(main, "APP_PASSWORD", "test-only-password")
    monkeypatch.setattr(main, "AUTH_ENABLED", True)
    assert client.post("/auth/login", json={"password": "wrong"}).status_code == 401
    response = client.post("/auth/login", json={"password": "test-only-password"})
    assert response.status_code == 200
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + response.json()["token"]}).status_code == 200


def test_google_only_mode_rejects_tokens_outside_owner_allowlist(client, monkeypatch):
    monkeypatch.setattr(main, "APP_PASSWORD", None)
    monkeypatch.setattr(main, "AUTH_ENABLED", True)
    monkeypatch.setattr(main, "GOOGLE_AUTH_ENABLED", True)
    monkeypatch.setattr(main, "ALLOWED_GOOGLE_EMAILS", {"owner@example.com"})
    for subject in ("douglas", "password", "other@example.com"):
        token = main.create_auth_token(subject)
        assert client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
    token = main.create_auth_token("owner@example.com")
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 200
