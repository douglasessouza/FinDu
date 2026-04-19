import streamlit as st
import requests

API_URL = "http://localhost:8000"

st.set_page_config(page_title="FinDu", page_icon="💰", layout="centered")
st.title("💰 FinDu")
st.caption("Personal multi-currency financial control")

page = st.sidebar.selectbox("Menu", ["Dashboard", "Accounts", "Credit Cards", "Transactions"])

# --- Dashboard ---
if page == "Dashboard":
    st.header("Dashboard")
    accounts = requests.get(f"{API_URL}/accounts").json()
    if not accounts:
        st.info("No accounts yet. Go to Accounts to add one!")
    else:
        checking = [a for a in accounts if a['account_type'] in ['CHECKING', 'SAVINGS']]
        cards = [a for a in accounts if a['account_type'] == 'CREDIT_CARD']
        if checking:
            st.subheader("🏦 Bank Accounts")
            for acc in checking:
                st.metric(label=f"{acc['name']} ({acc['bank']})", value=f"{acc['currency']} {acc['balance']:.2f}")
        if cards:
            st.subheader("💳 Credit Cards")
            for acc in cards:
                st.metric(label=f"{acc['name']} ({acc['bank']})", value=f"{acc['currency']} {acc['balance']:.2f}", delta=f"Limit: {acc['currency']} {acc['credit_limit']:.2f}" if acc['credit_limit'] else None)

# --- Accounts ---
elif page == "Accounts":
    st.header("🏦 Bank Accounts")
    with st.form("new_account"):
        name = st.text_input("Account name", placeholder="e.g. Nubank Personal")
        bank = st.text_input("Bank", placeholder="e.g. Nubank")
        account_type = st.selectbox("Type", ["CHECKING", "SAVINGS"])
        currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
        balance = st.number_input("Initial balance", value=0.0)
        submitted = st.form_submit_button("Add Account")
        if submitted:
            payload = {"name": name, "bank": bank, "account_type": account_type,
                      "currency": currency, "balance": balance,
                      "credit_limit": None, "closing_day": None, "due_day": None}
            r = requests.post(f"{API_URL}/accounts", json=payload)
            if r.status_code == 200:
                st.success(f"Account '{name}' created!")
            else:
                st.error("Error creating account")

# --- Credit Cards ---
elif page == "Credit Cards":
    st.header("💳 Credit Cards")
    with st.form("new_card"):
        name = st.text_input("Card name", placeholder="e.g. Nubank Black")
        bank = st.text_input("Bank", placeholder="e.g. Nubank")
        currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
        credit_limit = st.number_input("Credit limit", value=0.0)
        closing_day = st.number_input("Closing day", min_value=1, max_value=31, value=1)
        due_day = st.number_input("Due day", min_value=1, max_value=31, value=10)
        submitted = st.form_submit_button("Add Credit Card")
        if submitted:
            payload = {"name": name, "bank": bank, "account_type": "CREDIT_CARD",
                      "currency": currency, "balance": 0.0,
                      "credit_limit": credit_limit, "closing_day": int(closing_day), "due_day": int(due_day)}
            r = requests.post(f"{API_URL}/accounts", json=payload)
            if r.status_code == 200:
                st.success(f"Card '{name}' created!")
            else:
                st.error("Error creating card")

# --- Transactions ---
elif page == "Transactions":
    st.header("Transactions")
    accounts = requests.get(f"{API_URL}/accounts").json()
    if not accounts:
        st.warning("Create an account first!")
    else:
        with st.form("new_transaction"):
            account = st.selectbox("Account", [f"{a['id']} - {a['name']}" for a in accounts])
            description = st.text_input("Description")
            amount = st.number_input("Amount (negative = expense)", value=0.0)
            currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
            date = st.date_input("Date")
            category = st.text_input("Category", placeholder="e.g. food, transport")
            submitted = st.form_submit_button("Add Transaction")
            if submitted:
                account_id = int(account.split(" - ")[0])
                payload = {"account_id": account_id, "description": description,
                          "amount": amount, "currency": currency,
                          "date": str(date) + "T00:00:00", "category": category}
                r = requests.post(f"{API_URL}/transactions", json=payload)
                if r.status_code == 200:
                    st.success("Transaction added!")
                else:
                    st.error("Error adding transaction")