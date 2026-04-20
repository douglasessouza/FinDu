import streamlit as st
import requests
import os

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000")

CATEGORIES = [
    "Housing", "Food", "Transport", "Health", "Education",
    "Subscriptions", "Entertainment", "Leisure", "Travel",
    "Clothing", "Phone", "Car", "Insurance", "Investments",
    "Salary", "Other Income", "Transfer", "Other"
]

def get_accounts():
    try:
        r = requests.get(f"{API_URL}/accounts", timeout=15)
        if r.status_code in [200, 201]:
            return r.json()
        return []
    except Exception as e:
        st.error(f"GET /accounts falhou: {e}")
        return []

def get_recurring_expenses():
    try:
        r = requests.get(f"{API_URL}/recurring-expenses", timeout=15)
        if r.status_code in [200, 201]:
            return r.json()
        return []
    except Exception as e:
        return []

def post_data(endpoint, payload):
    try:
        r = requests.post(f"{API_URL}/{endpoint}", json=payload, timeout=15)
        return r
    except Exception as e:
        st.error(f"POST /{endpoint} falhou: {e}")
        return None

def fmt(amount, currency):
    if currency in ["BRL", "EUR"]:
        return f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{amount:,.2f}"

st.set_page_config(page_title="FinDu", page_icon="💰", layout="centered")
st.title("💰 FinDu")
st.caption("Personal multi-currency financial control")

page = st.sidebar.selectbox("Menu", ["Debug", "Dashboard", "Accounts", "Credit Cards", "Recurring Expenses", "Spending by Category", "Transactions"])

@st.cache_data(ttl=3600)
def get_fx_rates():
    try:
        r = requests.get("https://api.exchangerate-api.com/v4/latest/BRL", timeout=10)
        data = r.json()
        brl_to_cad = data["rates"]["CAD"]
        r2 = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=10)
        data2 = r2.json()
        usd_to_cad = data2["rates"]["CAD"]
        return {"BRL_CAD": brl_to_cad, "USD_CADsd_to_cad}
    except:
        return {"BRL_CAD": None, "USD_CAD": None}

if page == "Debug":
    st.header("🔧 Debug")
    st.write(f"**API_URL:** `{API_URL}`")
    st.divider()
    st.subheader("GET /accounts")
    try:
        r = requests.get(f"{API_URL}/accounts", timeout=15)
        st.write(f"Status: `{r.status_code}`")
        st.write(f"Response: `{r.text[:300]}`")
    except Exception as e:
        st.error(f"ERRO: {e}")
    st.divider()
    st.subheader("POST /accounts")
    try:
        payload = {"name": "Debug Test", "bank": "Debug", "account_type": "CHECKING", "currency": "BRL", "balance": 1.0, "credit_limit": None, "closing_day": None, "due_day": None}
        r2 = requests.post(f"{API_URL}/accounts", json=payload, timeout=15)
        st.write(f"Status: `{r2.status_code}`")
        st.write(f"Response: `{r2.text[:300]}`")
    except Exception as e:
        st.error(f"ERRO: {e}")

elif page == "Dashboard":
    st.header("Dashboard")
    fx = get_fx_rates()
    col1, col2 = st.columns(2)
   ith col1:
        if fx["BRL_CAD"]:
            st.metric("🇨🇦 1 CAD →", f"R$ {fmt(1/fx['BRL_CAD'], 'BRL')}")
    with col2:
        if fx["USD_CAD"]:
            st.metric("🇺🇸 1 USD →", f"CAD$ {fmt(fx['USD_CAD'], 'CAD')}")
    st.divider()
    accounts = get_accounts()
    if not accounts:
        st.info("No accounts yet.")
    else:
        brl_accounts = [a for a in accounts if a["currency"] == "BRL" and a["account_type"] != "CREDIT_CARD"]
        brl_cards = [a for a in accounts if a["currency"] == "BRL" and a["account_type"] == "CREDIT_CARD"]
        cad_accounts = [a for a in accounts if a["currency"] == "CAD" and a["account_type"] != "CREDIT_CARD"]
        cad_cards = [a for a in accounts if a["currency"] == "CAD" and a["account_type"] == "CREDIT_CARD"]
        total_brl = 0
        total_cad = 0
        if brl_accounts or brl_cards:
            st.subheader("🇧🇷 Brazil (BRL)")
            for acc in brl_accounts:
                card_debt = sum(c["balance"] for c in brl_cards)
                net = acc["balance"] - card_debt
                st.metric(label=f"🏦 {acc['name']}", value=f"R$ {fmt(acc['balance'], 'BRL')}", delta=f"Net: R$ {fmt(net, 'BRL')}")
                total_brl += acc["balance"]
            for card in brl_cards:
                st.metric(label=f"💳 {card['name']}", value=f"R$ {fmt(card['balance'], 'BRL')}", delta_color="inverse")
                total_brl -= card["balance"]
            st.info(f"**Total Brazil: R$ {fmt(total_brl, 'BRL')}**")
            if fx["BRL_CAD"]:
                st.caption(f"≈ CAD$ {fmt(total_brl * fx['BRL_CAD'], 'CAD')}")
        st.divider()
        if cad_accounts or cad_cards:
            st.subheader("🇨🇦 Canada (CAD)")
            for acc in cad_accounts:
                card_debt = sum(c["balance"] for c in cad_cards)
                net = acc["balance"] - card_debt
                st.metric(label=f"🏦 {acc['name']}", value=f"CAD$ {fmt(acc['balance'], 'CAD')}", delta=f"Net: CAD$ {fmt(net, 'CAD')}")
         ance"]
            for card in cad_cards:
                st.metric(label=f"💳 {card['name']}", value=f"CAD$ {fmt(card['balance'], 'CAD')}", delta_color="inverse")
                total_cad -= card["balance"]
            st.info(f"**Total Canada: CAD$ {fmt(total_cad, 'CAD')}**")
        st.divider()
        st.subheader("💰 Total in CAD")
        total_in_cad = total_cad
        if fx["BRL_CAD"]:
            total_in_cad += total_brl * fx["BRL_CAD"]
        st.metric("Net Worth", f"CAD$ {fmt(total_in_cad, 'CAD')}")

elif page == "Accounts":
    st.header("🏦 Bank Accounts")
    accounts = [a for a in get_accounts() if a["account_type"] != "CREDIT_CARD"]
    if accounts:
        for acc in accounts:
            st.write(f"**{acc['name']}** — {acc['bank']} | {acc['currency']} {fmt(acc['balance'], acc['currency'])}")
        st.divider()
    with st.form("new_account"):
        name = st.text_input("Account name")
        bank = st.text_input("Bank")
        account_type = st.selectbox("Type", ["CHECKIVINGS"])
        currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
        balance = st.number_input("Initial balance", value=0.0)
        submitted = st.form_submit_button("Add Account")
        if submitted:
            payload = {"name": name, "bank": bank, "account_type": account_type,
                      "currency": currency, "balance": balance,
                      "credit_limit": None, "closing_day": None, "due_day": None}
            r = post_data("accounts", payload)
            if r is not None and r.status_code in [200, 201]:
                st.success(f"Account '{name}' created!")
                st.rerun()
            else:
                status = r.status_code if r is not None else "None"
                text = r.text if r is not None else "No response"
                st.error(f"Error {status}: {text}")

elif page == "Credit Cards":
    st.header("💳 Credit Cards")
    cards = [a for a in get_accounts() if a["account_type"] == "CREDIT_CARD"]
    if cards:
        for card in cards:
            st.write(f"**{card['name']}** — {card['bank']} | {card['currency']} | Limit: {fmt(card['credit_limit'], card['currency'])} | Due: day {card['due_day']}")
        st.divider()
    with st.form("new_card"):
        name = st.text_input("Card name")
        bank = st.text_input("Bank")
        currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
        credit_limit = st.number_input("Credit limit", value=0.0)
        closing_day = st.number_input("Closing day", min_value=1, max_value=31, value=1)
        due_day = st.number_input("Due day", min_value=1, max_value=31, value=10)
        submitted = st.form_submit_button("Add Credit Card")
        if submitted:
            payload = {"name": name, "bank": bank, "account_type": "CREDIT_CARD",
                      "currency": currency, "balance": 0.0,
                      "credit_limit": credit_limit, "closing_day": int(closing_day), "due_day": int(due_day)}
            r = post_data("accounts", payload)
            if r is not None and r.status_code in [200, 201]:
                st.success(f"Card '{name}' created!")
                st.rerun()
            else:
                status = r.status_code if r is not None else "None"
                text = r.text if r is not None else "No response"
                st.error(f"Error {status}: {text}")

elif page == "Recurring Expenses":
    st.header("🔄 Recurring Expenses")
    expenses = get_recurring_expenses()
    if expenses:
        for exp in expenses:
            st.write(f"**{exp['name']}** — {exp['currency']} {fmt(exp['amount'], exp['currency'])} | Due: day {exp['due_day']} | {exp['category'] or 'No category'}")
        st.divider()
    with st.form("new_recurring"):
        name = st.text_input("Name")
        amount = st.number_input("Amount", value=0.0)
        currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
        due_day = st.number_input("Due day", min_value=1, max_value=31, value=1)
        category = st.selectbox("Category", CAT
        submitted = st.form_submit_button("Add Recurring Expense")
        if submitted:
            payload = {"name": name, "amount": amount, "currency": currency,
                      "due_day": int(due_day), "category": category}
            r = post_data("recurring-expenses", payload)
            if r is not None and r.status_code in [200, 201]:
                st.success(f"'{name}' added!")
                st.rerun()
            else:
                status = r.status_code if r is not None else "None"
                text = r.text if r is not None else "No response"
                st.error(f"Error {status}: {text}")

elif page == "Spending by Category":
    import plotly.express as px
    import pandas as pd
    st.header("📊 Spending by Category")
    currency_filter = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
    try:
        r = requests.get(f"{API_URL}/spending-by-category", params={"currency": currency_filter}, timeout=15)
        data = r.json()
        if not data:
           t.info("No transactions yet.")
        else:
            expenses = {k: v for k, v in data.items() if v < 0}
            income = {k: v for k, v in data.items() if v > 0}
            if expenses:
                st.subheader("💸 Expenses")
                df = pd.DataFrame(list(expenses.items()), columns=["Category", "Amount"])
                df["Amount"] = df["Amount"].abs()
                df = df.sort_values("Amount", ascending=False)
                fig = px.bar(df, x="Category", y="Amount", title="Expenses by Category", color="Category")
                st.plotly_chart(fig, use_container_width=True)
            if income:
                st.subheader("💰 Income")
                df2 = pd.DataFrame(list(income.items()), columns=["Category", "Amount"])
                df2 = df2.sort_values("Amount", ascending=False)
                st.dataframe(df2)
    except Exception as e:
        st.error(f"Could not load spending data: {e}")

elif page == "Transactions":
    st.header("Transactions")
    accoun get_accounts()
    if not accounts:
        st.warning("Create an account first!")
    else:
        with st.form("new_transaction"):
            account = st.selectbox("Account", [f"{a['id']} - {a['name']}" for a in accounts])
            description = st.text_input("Description")
            amount = st.number_input("Amount (negative = expense)", value=0.0)
            currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
            date = st.date_input("Date")
            category = st.selectbox("Category", CATEGORIES)
            submitted = st.form_submit_button("Add Transaction")
            if submitted:
                account_id = int(account.split(" - ")[0])
                payload = {"account_id": account_id, "description": description,
                          "amount": amount, "currency": currency,
                          "date": str(date) + "T00:00:00", "category": category}
                r = post_data("transactions", payload)
                if r is not None and r.status_code in [200, 201]:
                    st.success("Transaction added!")
                else:
                    status = r.status_code if r is not None else "None"
                    text = r.text if r is not None else "No response"
                    st.error(f"Error {status}: {text}")
