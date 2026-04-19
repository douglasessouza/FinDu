import streamlit as st
import requests
from datetime import datetime
import os

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000")

def get_accounts():
    try:
        r = requests.get(f"{API_URL}/accounts", timeout=5)
        return r.json()
    except:
        return []

def get_transactions():
    try:
        r = requests.get(f"{API_URL}/transactions", timeout=5)
        return r.json()
    except:
        return []

st.set_page_config(page_title="FinDu", page_icon="💰", layout="centered")
st.title("💰 FinDu")
st.caption("Personal multi-currency financial control")

page = st.sidebar.selectbox("Menu", ["Dashboard", "Accounts", "Credit Cards", "Transactions"])

@st.cache_data(ttl=3600)
def get_fx_rates():
    try:
        r = requests.get("https://api.exchangerate-api.com/v4/latest/BRL")
        data = r.json()
        brl_to_cad = data["rates"]["CAD"]
        r2 = requests.get("https://api.exchangerate-api.com/v4/latest/USD")
        data2 = r2.json()
        usd_to_cad = data2["rates"]["CAD"]
        return {"BRL_CAD": brl_to_cad, "USD_CAD": usd_to_cad}
    except:
        return {"BRL_CAD": None, "USD_CAD": None}

# --- Dashboard ---
if page == "Dashboard":
    st.header("Dashboard")

    fx = get_fx_rates()
    col1, col2 = st.columns(2)
    with col1:
        if fx["BRL_CAD"]:
            st.metric("🇨🇦 1 CAD →", f"R$ {1/fx['BRL_CAD']:.2f}")
        else:
            st.warning("FX unavailable")
    with col2:
        if fx["USD_CAD"]:
            st.metric("🇺🇸 1 USD →", f"CAD$ {fx['USD_CAD']:.2f}")
        else:
            st.warning("FX unavailable")

    st.divider()

    accounts = get_accounts()
    if not accounts:
        st.info("No accounts yet. Go to Accounts to add one!")
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
                st.metric(label=f"🏦 {acc['name']}", value=f"R$ {acc['balance']:.2f}", delta=f"Net: R$ {net:.2f}")
                total_brl += acc["balance"]
            for card in brl_cards:
                st.metric(label=f"💳 {card['name']}", value=f"R$ {card['balance']:.2f}",
                         delta=f"Due day: {card['due_day']}" if card['due_day'] else None, delta_color="inverse")
                total_brl -= card["balance"]
            st.info(f"**Total Brazil: R$ {total_brl:.2f}**")
            if fx["BRL_CAD"]:
                st.caption(f"≈ CAD$ {total_brl * fx['BRL_CAD']:.2f}")

        st.divider()

        if cad_accounts or cad_cards:
            st.subheader("🇨🇦 Canada (CAD)")
            for acc in cad_accounts:
                card_debt = sum(c["balance"] for c in cad_cards)
                net = acc["balance"] - card_debt
                st.metric(label=f"🏦 {acc['name']}", value=f"CAD$ {acc['balance']:.2f}", delta=f"Net: CAD$ {net:.2f}")
                total_cad += acc["balance"]
            for card in cad_cards:
                st.metric(label=f"💳 {card['name']}", value=f"CAD$ {card['balance']:.2f}",
                         delta=f"Due day: {card['due_day']}" if card['due_day'] else None, delta_color="inverse")
                total_cad -= card["balance"]
            st.info(f"**Total Canada: CAD$ {total_cad:.2f}**")

        st.divider()

        st.subheader("💰 Total in CAD")
        total_in_cad = total_cad
        if fx["BRL_CAD"]:
            total_in_cad += total_brl * fx["BRL_CAD"]
        st.metric("Net Worth", f"CAD$ {total_in_cad:.2f}")

# --- Accounts ---
elif page == "Accounts":
    st.header("🏦 Bank Accounts")
    accounts = [a for a in get_accounts() if a["account_type"] != "CREDIT_CARD"]
    if accounts:
        for acc in accounts:
            st.write(f"**{acc['name']}** — {acc['bank']} | {acc['currency']} {acc['balance']:.2f}")
        st.divider()
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
                st.rerun()
            else:
                st.error("Error creating account")

# --- Credit Cards ---
elif page == "Credit Cards":
    st.header("💳 Credit Cards")
    cards = [a for a in get_accounts() if a["account_type"] == "CREDIT_CARD"]
    if cards:
        for card in cards:
            st.write(f"**{card['name']}** — {card['bank']} | {card['currency']} | Limit: {card['credit_limit']} | Due: day {card['due_day']}")
        st.divider()
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
                st.rerun()
            else:
                st.error("Error creating card")

# --- Transactions ---
elif page == "Transactions":
    st.header("Transactions")
    accounts = get_accounts()
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