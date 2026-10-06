def test_budget_item_treatment_changes_future_months_without_changing_budget(client):
    budget = client.post('/category-budgets', json={
        'category': 'Housing', 'currency': 'CAD', 'start_month': '2026-09',
        'items': [{'name': 'Provident', 'amount': 150}, {'name': 'Other', 'amount': 80}],
    }).json()
    item_id = budget['items'][0]['id']
    response = client.put(f'/budget-items/{item_id}/treatment', json={
        'effective_month': '2026-10', 'treatment': 'EXCLUDED',
    })
    assert response.status_code == 200
    assert client.get('/budget-item-treatments', params={'month': '2026-09'}).json() == []
    october = client.get('/budget-item-treatments', params={'month': '2026-10'}).json()
    assert october[0]['budget_item_id'] == item_id
    assert october[0]['treatment'] == 'EXCLUDED'
    assert client.get('/category-budgets', params={'month': '2026-10'}).json()[0]['amount'] == 230
    client.put(f'/budget-items/{item_id}/treatment', json={
        'effective_month': '2026-12', 'treatment': 'VARIABLE',
    })
    assert client.get('/budget-item-treatments', params={'month': '2026-11'}).json()[0]['treatment'] == 'EXCLUDED'
    assert client.get('/budget-item-treatments', params={'month': '2026-12'}).json()[0]['treatment'] == 'VARIABLE'


def test_new_rent_budget_and_unchanged_new_version_stay_outside_flexible(client):
    budget = client.post('/category-budgets', json={
        'category': 'Rent', 'currency': 'CAD', 'start_month': '2026-10',
        'items': [{'name': 'Rent', 'amount': 2600}],
    }).json()
    old_id = budget['items'][0]['id']
    assert client.get('/budget-item-treatments', params={'month': '2026-10'}).json()[0]['budget_item_id'] == old_id
    adjusted = client.post(f"/category-budgets/{budget['id']}/adjust", json={
        'start_month': '2027-01', 'items': [{'name': 'Rent', 'amount': 2600}],
    }).json()
    new_id = adjusted['current']['items'][0]['id']
    assert client.get('/budget-item-treatments', params={'month': '2026-12'}).json()[0]['budget_item_id'] == old_id
    assert {row['budget_item_id'] for row in client.get('/budget-item-treatments', params={'month': '2027-01'}).json()} == {old_id, new_id}
