def test_share_link_not_found(client):
    response = client.get("/api/share/does-not-exist")
    assert response.status_code == 404
