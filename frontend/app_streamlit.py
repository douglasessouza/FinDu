import streamlit as st
import requests
import os

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000")

CATEGORIES = ["Housing","Food","Transport","Health","Education","Subscriptions","Entertainment","Leisure","Travel","Clothing","Phone","Car","Insurance","Investments","Salary","Other Income","Transfer","Other"]

def get_accounts():
    try:
        r = requests.get(f"{API_URL}/accounts", timeout=15)
        return r.json() if r.status_code == 200 else []
    except:
        return []

def get_recurring():
    try:
        r = requests.get(f"{API_URL}/recurring-expenses", timeout=15)
        return r.json() if r.status_code == 200 else []
    except:
        return []

def post_data(endpoint, payload):
    try:
        return requests.post(f"{API_URL}/{endpoint}", json=payload, timeout=15)
    except Exception as e:
        st.error(f"Erro de conexao: {e}")
        return None

def delete_data(endpoint, id):
    try:
        return requests.delete(f"{API_URL}/{endpoint}/{id}", timeout=15)
    except Exception as e:
        st.error(f"Erro: {e}")
        return None

def fmt(v, c):
    if c in ["BRL","EUR"]:
        return f"{v:,.2f}".replace(",","X").replace(".",",").replace("X",".")
    return f"{v:,.2f}"

st.set_page_config(page_title="FinDu", page_icon="💰", layout="centered")
st.title("💰 FinDu")
st.caption("Personal multi-currency financial control")
page = st.sidebar.selectbox("Menu", ["Debug","Dashboard","Monthly View","Accounts","Credit Cards","Recurring Expenses","Transactions"])

@st.cache_data(ttl=3600)
def get_fx():
    try:
        r1 = requests.get("https://api.exchangerate-api.com/v4/latest/BRL", timeout=10)
        r2 = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=10)
        return {"BRL_CAD": r1.json()["rates"]["CAD"], "USD_CAD": r2.json()["rates"]["CAD"]}
    except:
        return {"BRL_CAD": None, "USD_CAD": None}

if page == "Debug":
    st.header("Debug")
    st.write(f"API_URL: {API_URL}")
    try:
        r = requests.get(f"{API_URL}/accounts", timeout=15)
        st.write(f"GET status: {r.status_code}")
        st.write(f"Response: {r.text[:300]}")
    except Exception as e:
        st.error(f"GET falhou: {e}")
    if st.button("Testar POST /accounts"):
        try:
            p = {"name":"Debug","bank":"Debug","account_type":"CHECKING","currency":"BRL","balance":1.0,"credit_limit":None,"closing_day":None,"due_day":None}
            r2 = requests.post(f"{API_URL}/accounts", json=p, timeout=15)
            st.write(f"POST status: {r2.status_code}")
            st.write(f"Response: {r2.text[:300]}")
        except Exception as e:
            st.error(f"POST falhou: {e}")

elif page == "Dashboard":
    st.header("Dashboard")
    fx = get_fx()
    c1, c2 = st.columns(2)
    with c1:
        if fx["BRL_CAD"]:
            st.metric("🇨🇦 1 CAD", f"R$ {fmt(1/fx['BRL_CAD'],'BRL')}")
    with c2:
        if fx["USD_CAD"]:
            st.metric("🇺🇸 1 USD", f"CAD$ {fmt(fx['USD_CAD'],'CAD')}")
    st.divider()
    accounts = get_accounts()
    recurring = get_recurring()
    if not accounts:
        st.info("No accounts yet.")
    else:
        brl_acc = [a for a in accounts if a["currency"]=="BRL" and a["account_type"]!="CREDIT_CARD"]
        brl_cards = [a for a in accounts if a["currency"]=="BRL" and a["account_type"]=="CREDIT_CARD"]
        cad_acc = [a for a in accounts if a["currency"]=="CAD" and a["account_type"]!="CREDIT_CARD"]
        cad_cards = [a for a in accounts if a["currency"]=="CAD" and a["account_type"]=="CREDIT_CARD"]
        total_brl = 0
        total_cad = 0
        if brl_acc or brl_cards:
            st.subheader("🇧🇷 Brazil (BRL)")
            brl_exp = sum(e["amount"] for e in recurring if e["currency"]=="BRL" and e.get("type")!="INCOME")
            brl_debt = sum(c["balance"] for c in brl_cards)
            for a in brl_acc:
                futuro = a["balance"] - brl_exp - brl_debt
                st.metric(f"🏦 {a['name']}", f"R$ {fmt(a['balance'],'BRL')}", f"Futuro: R$ {fmt(futuro,'BRL')}")
                total_brl += a["balance"]
            for c in brl_cards:
                st.metric(f"💳 {c['name']}", f"R$ {fmt(c['balance'],'BRL')}", delta_color="inverse")
                total_brl -= c["balance"]
            st.info(f"Total Brazil: R$ {fmt(total_brl,'BRL')}")
            if fx["BRL_CAD"]:
                st.caption(f"≈ CAD$ {fmt(total_brl*fx['BRL_CAD'],'CAD')}")
        st.divider()
        if cad_acc or cad_cards:
            st.subheader("🇨🇦 Canada (CAD)")
            cad_exp = sum(e["amount"] for e in recurring if e["currency"]=="CAD" and e.get("type")!="INCOME")
            cad_debt = sum(c["balance"] for c in cad_cards)
            for a in cad_acc:
                futuro = a["balance"] - cad_exp - cad_debt
                st.metric(f"🏦 {a['name']}", f"CAD$ {fmt(a['balance'],'CAD')}", f"Futuro: CAD$ {fmt(futuro,'CAD')}")
                total_cad += a["balance"]
            for c in cad_cards:
                st.metric(f"💳 {c['name']}", f"CAD$ {fmt(c['balance'],'CAD')}", delta_color="inverse")
                total_cad -= c["balance"]
            st.info(f"Total Canada: CAD$ {fmt(total_cad,'CAD')}")
        st.divider()
        total_exp_cad = sum(e["amount"] for e in recurring if e["currency"]=="CAD" and e.get("type")!="INCOME")
        total_exp_brl = sum(e["amount"] for e in recurring if e["currency"]=="BRL" and e.get("type")!="INCOME")
        total_exp_brl_in_cad = total_exp_brl * fx["BRL_CAD"] if fx["BRL_CAD"] else 0
        total_bruto = total_cad + (total_brl * fx["BRL_CAD"] if fx["BRL_CAD"] else 0)
        total_futuro = total_bruto - total_exp_cad - total_exp_brl_in_cad
        st.subheader("💰 Net Worth (CAD)")
        st.caption(f"Soma de todos os saldos convertidos para CAD — 🇧🇷 R$ {fmt(total_brl,'BRL')} ≈ CAD$ {fmt(total_brl * fx['BRL_CAD'] if fx['BRL_CAD'] else 0,'CAD')} + 🇨🇦 CAD$ {fmt(total_cad,'CAD')}")
        st.metric("Total atual", f"CAD$ {fmt(total_bruto,'CAD')}", f"Futuro (após despesas do mês): CAD$ {fmt(total_futuro,'CAD')}")

elif page == "Monthly View":
    from datetime import date
    import calendar
    st.header("📅 Monthly View")
    today = date.today()
    if "mv_year" not in st.session_state:
        st.session_state.mv_year = today.year
    if "mv_month" not in st.session_state:
        st.session_state.mv_month = today.month
    col_prev, col_title, col_next = st.columns([1, 3, 1])
    with col_prev:
        if st.button("←"):
            if st.session_state.mv_month == 1:
                st.session_state.mv_month = 12
                st.session_state.mv_year -= 1
            else:
                st.session_state.mv_month -= 1
            st.rerun()
    with col_title:
        month_name = calendar.month_name[st.session_state.mv_month]
        st.subheader(f"{month_name} {st.session_state.mv_year}")
    with col_next:
        if st.button("→"):
            if st.session_state.mv_month == 12:
                st.session_state.mv_month = 1
                st.session_state.mv_year += 1
            else:
                st.session_state.mv_month += 1
            st.rerun()
    st.divider()
    recurring = get_recurring()
    fx = get_fx()
    accounts = get_accounts()
    for currency, flag, symbol in [("CAD", "🇨🇦", "CAD$"), ("BRL", "🇧🇷", "R$")]:
        st.subheader(f"{flag} {currency}")
        income = [e for e in recurring if e["currency"]==currency and e.get("type")=="INCOME"]
        expenses = [e for e in recurring if e["currency"]==currency and e.get("type")!="INCOME"]
        total_income = sum(e["amount"] for e in income)
        total_expense = sum(e["amount"] for e in expenses)
        account_balance = sum(a["balance"] for a in accounts if a["currency"]==currency and a["account_type"]!="CREDIT_CARD")
        balance = account_balance + total_income - total_expense
        if income:
            st.write("**Income**")
            for e in income:
                st.write(f"  • {e['name']}: {symbol} {fmt(e['amount'],currency)} (day {e['due_day']})")
        if expenses:
            st.write("**Expenses**")
            for e in expenses:
                st.write(f"  • {e['name']}: {symbol} {fmt(e['amount'],currency)} (day {e['due_day']})")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("In Bank", f"{symbol} {fmt(account_balance,currency)}")
        with col2:
            st.metric("Income", f"{symbol} {fmt(total_income,currency)}")
        col3, col4 = st.columns(2)
        with col3:
            st.metric("Expenses", f"{symbol} {fmt(total_expense,currency)}")
        with col4:
            st.metric("Balance", f"{symbol} {fmt(balance,currency)}")
        st.divider()

elif page == "Accounts":
    st.header("🏦 Bank Accounts")
    accounts = [a for a in get_accounts() if a["account_type"]!="CREDIT_CARD"]
    for a in accounts:
        col1, col2 = st.columns([5, 1])
        with col1:
            st.write(f"**{a['name']}** — {a['bank']} | {a['currency']} {fmt(a['balance'],a['currency'])}")
        with col2:
            if st.button("🗑️", key=f"del_{a['id']}"):
                r = delete_data("accounts", a["id"])
                if r is not None and r.status_code in [200,204]:
                    st.success("Account deleted!")
                    st.rerun()
                else:
                    st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")
    if accounts:
        st.divider()
    with st.form("new_account"):
        name = st.text_input("Account name")
        bank = st.text_input("Bank")
        atype = st.selectbox("Type", ["CHECKING","SAVINGS"])
        currency = st.selectbox("Currency", ["BRL","CAD","USD","EUR"])
        balance = st.number_input("Initial balance", value=0.0)
        if st.form_submit_button("Add Account"):
            r = post_data("accounts", {"name":name,"bank":bank,"account_type":atype,"currency":currency,"balance":balance,"credit_limit":None,"closing_day":None,"due_day":None})
            if r is not None and r.status_code in [200,201]:
                st.success("Account created!")
                st.rerun()
            else:
                st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

elif page == "Credit Cards":
    st.header("💳 Credit Cards")
    cards = [a for a in get_accounts() if a["account_type"]=="CREDIT_CARD"]
    for c in cards:
        st.write(f"**{c['name']}** — {c['bank']} | {c['currency']} | Limit: {fmt(c['credit_limit'],c['currency'])} | Due: day {c['due_day']}")
    if cards:
        st.divider()
    with st.form("new_card"):
        name = st.text_input("Card name")
        bank = st.text_input("Bank")
        currency = st.selectbox("Currency", ["BRL","CAD","USD","EUR"])
        limit = st.number_input("Credit limit", value=0.0)
        closing = st.number_input("Closing day", min_value=1, max_value=31, value=1)
        due = st.number_input("Due day", min_value=1, max_value=31, value=10)
        if st.form_submit_button("Add Credit Card"):
            r = post_data("accounts", {"name":name,"bank":bank,"account_type":"CREDIT_CARD","currency":currency,"balance":0.0,"credit_limit":limit,"closing_day":int(closing),"due_day":int(due)})
            if r is not None and r.status_code in [200,201]:
                st.success("Card created!")
                st.rerun()
            else:
                st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

elif page == "Recurring Expenses":
    st.header("🔄 Recurring Expenses & Income")

    expenses = get_recurring()
    income_list = [e for e in expenses if e.get("type") == "INCOME"]
    expense_list = [e for e in expenses if e.get("type") != "INCOME"]

    if income_list:
        st.subheader("💰 Income")
        for e in income_list:
            col1, col2 = st.columns([6,1])
            with col1:
                st.write(f"**{e['name']}** — {e['currency']} {fmt(e['amount'],e['currency'])} | Receive: day {e['due_day']} | {e['category'] or 'No category'}")
            with col2:
                if st.button("🗑️", key=f"del_inc_{e['id']}"):
                    delete_data("recurring-expenses", e["id"])
                    st.rerun()
        st.divider()

    if expense_list:
        st.subheader("💸 Expenses")
        for e in expense_list:
            col1, col2 = st.columns([6,1])
            with col1:
                st.write(f"**{e['name']}** — {e['currency']} {fmt(e['amount'],e['currency'])} | Due: day {e['due_day']} | {e['category'] or 'No category'}")
            with col2:
                if st.button("🗑️", key=f"del_exp_{e['id']}"):
                    delete_data("recurring-expenses", e["id"])
                    st.rerun()
        st.divider()

    tab1, tab2 = st.tabs(["➕ Add Expense", "➕ Add Income"])

    with tab1:
        with st.form("new_expense"):
            name = st.text_input("Name", placeholder="e.g. Rent, Netflix")
            amount = st.number_input("Amount", value=0.0, min_value=0.0)
            currency = st.selectbox("Currency", ["BRL","CAD","USD","EUR"])
            due = st.number_input("Due day", min_value=1, max_value=31, value=1)
            category = st.selectbox("Category", CATEGORIES)
            if st.form_submit_button("Add Expense"):
                r = post_data("recurring-expenses", {"name":name,"amount":amount,"currency":currency,"due_day":int(due),"category":category,"type":"EXPENSE"})
                if r is not None and r.status_code in [200,201]:
                    st.success("Expense added!")
                    st.rerun()
                else:
                    st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

    with tab2:
        with st.form("new_income"):
            name = st.text_input("Name", placeholder="e.g. Salary, Freelance")
            amount = st.number_input("Amount", value=0.0, min_value=0.0)
            currency = st.selectbox("Currency", ["BRL","CAD","USD","EUR"])
            due = st.number_input("Receive day", min_value=1, max_value=31, value=1)
            category = st.selectbox("Category", ["Salary","Other Income","Transfer","Other"])
            if st.form_submit_button("Add Income"):
                r = post_data("recurring-expenses", {"name":name,"amount":amount,"currency":currency,"due_day":int(due),"category":category,"type":"INCOME"})
                if r is not None and r.status_code in [200,201]:
                    st.success("Income added!")
                    st.rerun()
                else:
                    st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

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
            currency = st.selectbox("Currency", ["BRL","CAD","USD","EUR"])
            date = st.date_input("Date")
            category = st.selectbox("Category", CATEGORIES)
            if st.form_submit_button("Add Transaction"):
                account_id = int(account.split(" - ")[0])
                r = post_data("transactions", {"account_id":account_id,"description":description,"amount":amount,"currency":currency,"date":str(date)+"T00:00:00","category":category})
                if r is not None and r.status_code in [200,201]:
                    st.success("Transaction added!")
                else:
                    st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")