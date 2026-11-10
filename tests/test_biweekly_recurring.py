from datetime import datetime
from app.models import Account, AccountTypeEnum, CurrencyEnum

def test_biweekly_schedule_persists_and_validates_anchor_and_payment_route(client, db_session):
    account = Account(name='RBC', bank='RBC', account_type=AccountTypeEnum.CHECKING, currency=CurrencyEnum.CAD, balance=1000)
    db_session.add(account)
    db_session.commit()
    payload = dict(name='Car', amount=362.78, currency='CAD', due_day=6, type='EXPENSE', payment_method='DEBIT', payment_account_id=account.id, frequency='BIWEEKLY', anchor_date='2026-11-06', start_month='2026-11', valid_until='2027-12-31T00:00:00')
    response = client.post('/recurring-expenses',json=payload)
    assert response.status_code == 200
    assert response.json().get('frequency') == 'BIWEEKLY'
    assert response.json().get('anchor_date') == '2026-11-06'
    recurring_id=response.json()['id']
    assert client.patch(f'/recurring-expenses/{recurring_id}',json={'anchor_date':None}).status_code == 400
    assert client.post('/recurring-expenses',json={**payload,'anchor_date':None}).status_code == 400
    assert client.post('/recurring-expenses',json={**payload,'frequency':'WEEKLY'}).status_code == 422
    assert client.patch(f'/recurring-expenses/{recurring_id}',json={'payment_method':'UNSET','payment_account_id':None}).status_code == 400
    monthly=client.post('/recurring-expenses',json={k:v for k,v in payload.items() if k not in ('frequency','anchor_date')})
    assert monthly.status_code == 200
    assert monthly.json()['frequency'] == 'MONTHLY'
