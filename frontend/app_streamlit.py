import streamlit as st
import requests
import os
import json
import pandas as pd
from datetime import datetime, date

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

CATEGORIES = ["Housing","Food","Restaurant","Coffee","Transport","Gas","Health","Wellness","Education","Subscriptions","Entertainment","Leisure","Travel","Clothing","Phone","Car","Insurance","Investments","Salary","Other Income","Transfer","Other"]

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
        st.error(f"Connection error: {e}")
        return None

def delete_data(endpoint, id):
    try:
        return requests.delete(f"{API_URL}/{endpoint}/{id}", timeout=15)
    except Exception as e:
        st.error(f"Error: {e}")
        return None

def fmt(v, c):
    if c in ["BRL","EUR"]:
        return f"{v:,.2f}".replace(",","X").replace(".",",").replace("X",".")
    return f"{v:,.2f}"

def parse_statement(uploaded, from_date):
    """Auto-detect bank format and return normalized dataframe."""
    filename = uploaded.name.lower()

    # --- AMEX XLS / XLSX ---
    if filename.endswith(".xls") or filename.endswith(".xlsx"):
        import io
        file_bytes = uploaded.read()
        engine = "xlrd" if filename.endswith(".xls") else "openpyxl"

        # Read without header to find the real header row
        raw_scan = pd.read_excel(io.BytesIO(file_bytes), engine=engine, header=None)

        header_idx = None
        for i, row in raw_scan.iterrows():
            vals = [str(v).strip() for v in row.values]
            if "Date" in vals and "Description" in vals and "Amount" in vals:
                header_idx = i
                break

        if header_idx is None:
            return None, "Could not find transaction header in Amex file."

        # Re-read with the correct header row
        df_raw = pd.read_excel(io.BytesIO(file_bytes), engine=engine, header=header_idx)
        df_raw.columns = [str(c).strip() for c in df_raw.columns]

        df = df_raw[["Date", "Description", "Amount"]].copy()
        df.columns = ["date", "description", "amount"]
        df = df.dropna(subset=["description", "date"])
        df = df[df["description"].str.strip() != ""]

        # Clean amount: remove $, commas → make negative (credit card charges)
        df["amount"] = (
            df["amount"].astype(str)
            .str.replace("$", "", regex=False)
            .str.replace(",", "", regex=False)
            .str.strip()
        )
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1

        # Parse date: "25 Apr. 2026" → remove dot before parsing
        df["date_parsed"] = pd.to_datetime(
            df["date"].astype(str).str.strip().str.replace(".", "", regex=False),
            format="%d %b %Y",
            errors="coerce"
        )
        df["date"] = df["date_parsed"].dt.strftime("%-m/%-d/%Y")
        bank = "Amex"

    else:
        # --- CSV formats (RBC, BMO) ---
        content = uploaded.read().decode("utf-8-sig", errors="ignore")
        uploaded.seek(0)

        raw = pd.read_csv(uploaded)
        uploaded.seek(0)
        cols = [c.strip().lower() for c in raw.columns]

        if "transaction date" in cols and "cad$" in cols:
            # RBC Chequing or Credit
            raw.columns = [c.strip() for c in raw.columns]
            df = raw.rename(columns={"Transaction Date": "date", "Description 1": "description", "CAD$": "amount"})
            df = df[["date", "description", "amount"]].dropna(subset=["amount"])
            df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
            df["date_parsed"] = pd.to_datetime(df["date"])
            bank = f"RBC {raw['Account Type'].iloc[0]}" if "Account Type" in raw.columns else "RBC"

        elif "transaction amount" in cols:
            # BMO format
            raw.columns = [c.strip() for c in raw.columns]
            df = raw.rename(columns={"Transaction Date": "date", "Transaction Amount": "amount", "Description": "description"})
            df = df[["date", "description", "amount"]].dropna(subset=["amount"])
            df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1
            df["date_parsed"] = pd.to_datetime(df["date"].astype(str), format="%Y%m%d")
            df["date"] = df["date_parsed"].dt.strftime("%-m/%-d/%Y")
            bank = "BMO"

        else:
            return None, f"Unrecognized format. Columns: {list(raw.columns)}"

    df = df.dropna(subset=["amount", "date_parsed"])
    df = df[df["date_parsed"] >= pd.Timestamp(from_date)]
    df = df.drop(columns=["date_parsed"])
    return df, bank


st.set_page_config(page_title="FinDu", page_icon="💰", layout="centered")
st.title("💰 FinDu")
st.caption("Personal multi-currency financial control")
page = st.sidebar.selectbox("Menu", ["Dashboard","Monthly View","Accounts","Credit Cards","Recurring Expenses","Transactions","Import Statement","Debug"])

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
        st.error(f"GET failed: {e}")
    if st.button("Test POST /accounts"):
        try:
            p = {"name":"Debug","bank":"Debug","account_type":"CHECKING","currency":"BRL","balance":1.0,"credit_limit":None,"closing_day":None,"due_day":None}
            r2 = requests.post(f"{API_URL}/accounts", json=p, timeout=15)
            st.write(f"POST status: {r2.status_code}")
            st.write(f"Response: {r2.text[:300]}")
        except Exception as e:
            st.error(f"POST failed: {e}")

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
                st.metric(f"🏦 {a['name']}", f"R$ {fmt(a['balance'],'BRL')}", f"Future: R$ {fmt(futuro,'BRL')}")
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
                st.metric(f"🏦 {a['name']}", f"CAD$ {fmt(a['balance'],'CAD')}", f"Future: CAD$ {fmt(futuro,'CAD')}")
                total_cad += a["balance"]
            for c in cad_cards:
                st.metric(f"💳 {c['name']}", f"CAD$ {fmt(c['balance'],'CAD')}", delta_color="inverse")
                total_cad -= c["balance"]
            st.info(f"Total Canada: CAD$ {fmt(total_cad,'CAD')}")
        st.divider()
        total_bruto = total_cad + (total_brl * fx["BRL_CAD"] if fx["BRL_CAD"] else 0)
        total_exp_cad = sum(e["amount"] for e in recurring if e["currency"]=="CAD" and e.get("type")!="INCOME")
        total_exp_brl = sum(e["amount"] for e in recurring if e["currency"]=="BRL" and e.get("type")!="INCOME")
        total_futuro = total_bruto - total_exp_cad - (total_exp_brl * fx["BRL_CAD"] if fx["BRL_CAD"] else 0)
        st.subheader("💰 Net Worth (CAD)")
        st.caption(f"🇧🇷 R$ {fmt(total_brl,'BRL')} ≈ CAD$ {fmt(total_brl*fx['BRL_CAD'] if fx['BRL_CAD'] else 0,'CAD')} + 🇨🇦 CAD$ {fmt(total_cad,'CAD')}")
        st.metric("Total", f"CAD$ {fmt(total_bruto,'CAD')}", f"Future (after monthly expenses): CAD$ {fmt(total_futuro,'CAD')}")

elif page == "Monthly View":
    import calendar
    st.header("📅 Monthly View")
    today = date.today()
    if "mv_year" not in st.session_state:
        st.session_state.mv_year = today.year
    if "mv_month" not in st.session_state:
        st.session_state.mv_month = today.month
    col_prev, col_title, col_next = st.columns([1,3,1])
    with col_prev:
        if st.button("←"):
            if st.session_state.mv_month == 1:
                st.session_state.mv_month = 12
                st.session_state.mv_year -= 1
            else:
                st.session_state.mv_month -= 1
            st.rerun()
    with col_title:
        st.subheader(f"{calendar.month_name[st.session_state.mv_month]} {st.session_state.mv_year}")
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
    accounts = get_accounts()
    fx = get_fx()
    for currency, flag, symbol in [("CAD","🇨🇦","CAD$"),("BRL","🇧🇷","R$")]:
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
            st.metric("Expenses", f"{symbol} {fmt(total_expense,currency)}")
        with col2:
            st.metric("Income", f"{symbol} {fmt(total_income,currency)}")
            st.metric("Balance", f"{symbol} {fmt(balance,currency)}")
        st.divider()

elif page == "Accounts":
    st.header("🏦 Bank Accounts")
    accounts = [a for a in get_accounts() if a["account_type"]!="CREDIT_CARD"]
    for a in accounts:
        col1, col2 = st.columns([5,1])
        with col1:
            st.write(f"**{a['name']}** — {a['bank']} | {a['currency']} {fmt(a['balance'],a['currency'])}")
        with col2:
            if st.button("🗑️", key=f"del_{a['id']}"):
                r = delete_data("accounts", a["id"])
                if r is not None and r.status_code in [200,204]:
                    st.success("Deleted!")
                    st.rerun()
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
        col1, col2 = st.columns([6,1])
        with col1:
            closing = f" | Closes: day {c['closing_day']}" if c.get('closing_day') else ""
            st.write(f"**{c['name']}** — {c['bank']} | {c['currency']} | Limit: {fmt(c['credit_limit'],c['currency'])}{closing} | Due: day {c['due_day']}")
        with col2:
            if st.button("🗑️", key=f"del_card_{c['id']}"):
                r = delete_data("accounts", c["id"])
                if r is not None and r.status_code in [200,204]:
                    st.success("Deleted!")
                    st.rerun()
    if cards:
        st.divider()
    with st.form("new_card"):
        name = st.text_input("Card name")
        bank = st.text_input("Bank")
        currency = st.selectbox("Currency", ["BRL","CAD","USD","EUR"])
        limit = st.number_input("Credit limit", value=0.0)
        current_balance = st.number_input("Current balance (amount you already owe)", value=0.0, min_value=0.0, help="Current outstanding balance. Leave 0 if starting fresh.")
        closing = st.number_input("Closing day", min_value=1, max_value=31, value=1)
        due = st.number_input("Due day", min_value=1, max_value=31, value=10)
        if st.form_submit_button("Add Credit Card"):
            r = post_data("accounts", {"name":name,"bank":bank,"account_type":"CREDIT_CARD","currency":currency,"balance":current_balance,"credit_limit":limit,"closing_day":int(closing),"due_day":int(due)})
            if r is not None and r.status_code in [200,201]:
                st.success("Card created!")
                st.rerun()
            else:
                st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

elif page == "Recurring Expenses":
    st.header("🔄 Recurring Expenses & Income")
    expenses = get_recurring()
    income_list = [e for e in expenses if e.get("type")=="INCOME"]
    expense_list = [e for e in expenses if e.get("type")!="INCOME"]
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
    tab1, tab2 = st.tabs(["➕ Add Expense","➕ Add Income"])
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
            date_input = st.date_input("Date")
            category = st.selectbox("Category", CATEGORIES)
            if st.form_submit_button("Add Transaction"):
                account_id = int(account.split(" - ")[0])
                r = post_data("transactions", {"account_id":account_id,"description":description,"amount":amount,"currency":currency,"date":str(date_input)+"T00:00:00","category":category})
                if r is not None and r.status_code in [200,201]:
                    st.success("Transaction added!")
                else:
                    st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

elif page == "Import Statement":
    st.header("📂 Import Bank Statement")
    st.caption("Supports RBC (Chequing & Credit), Amex XLS, and BMO CSV.")
    accounts = get_accounts()
    if not accounts:
        st.warning("Please create an account first.")
    else:
        col1, col2 = st.columns(2)
        with col1:
            account_options = [f"{a['id']} | {a['name']} ({a['currency']}) — {'Credit Card' if a['account_type']=='CREDIT_CARD' else 'Chequing/Savings'}" for a in accounts]
            selected_account = st.selectbox("Select account to import into", account_options)
            account_id = int(selected_account.split("|")[0].strip())
            selected_acc = next(a for a in accounts if a["id"]==account_id)
            is_credit = selected_acc["account_type"] == "CREDIT_CARD"
        with col2:
            from_date = st.date_input("Import transactions from", value=date.today().replace(day=1))
        st.divider()

        # ✅ Aceita CSV, XLS e XLSX
        uploaded = st.file_uploader("📁 Upload statement file (CSV or XLS)", type=["csv", "xls", "xlsx"])

        if uploaded:
            try:
                df, bank_detected = parse_statement(uploaded, from_date)
                if df is None:
                    st.error(bank_detected)
                elif df.empty:
                    st.warning("No transactions found after the selected date.")
                else:
                    st.success(f"✅ **{bank_detected}** — **{len(df)} transactions** from **{df['date'].min()}** to **{df['date'].max()}**")
                    st.dataframe(df, use_container_width=True)
                    st.divider()
                    if st.button("🤖 Analyze with AI", type="primary"):
                        with st.spinner("AI is reading and categorizing... (15-30 seconds)"):
                            recurring = get_recurring()
                            recurring_names = [e["name"] for e in recurring]
                            account_type_hint = "credit card" if is_credit else "chequing/debit"
                            credit_note = "IMPORTANT: This is a credit card statement. Payments like 'Payment - Thank You' or 'PAYMENT RECEIVED' must be categorized as 'Transfer'. Focus on categorizing actual purchases." if is_credit else ""
                            prompt = f"""You are a financial assistant analyzing a Canadian bank statement ({selected_acc['bank']} {account_type_hint}, {bank_detected}).
{credit_note}

Transactions:
{df.to_csv(index=False)}

Recurring expenses already registered: {recurring_names}

Return a JSON array. Each item must have:
- "date": original date string
- "description": clean merchant name (remove codes like "CONTACTLESS INTERAC PURCHASE - 1234 ")
- "amount": numeric (negative = expense, positive = income/payment)
- "category": one of: {", ".join(CATEGORIES)}
- "is_recurring": true if matches known recurring or clearly a regular bill
- "recurring_match": matching recurring name or null

Return ONLY the JSON array, no markdown."""
                            try:
                                resp = requests.post(
                                    "https://api.anthropic.com/v1/messages",
                                    headers={"Content-Type":"application/json","x-api-key":ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
                                    json={"model":"claude-sonnet-4-6","max_tokens":4000,"messages":[{"role":"user","content":prompt}]},
                                    timeout=60
                                )
                                ai_text = resp.json()["content"][0]["text"]
                                analyzed = json.loads(ai_text)
                                st.session_state["analyzed"] = analyzed
                                st.session_state["import_account_id"] = account_id
                                st.session_state["import_is_credit"] = is_credit
                                st.rerun()
                            except Exception as e:
                                st.error(f"AI error: {e}")
                                st.write(resp.json() if "resp" in locals() else "No response")
            except Exception as e:
                st.error(f"Error reading file: {e}")

        if "analyzed" in st.session_state:
            analyzed = st.session_state["analyzed"]
            acc_id = st.session_state["import_account_id"]
            is_credit_import = st.session_state.get("import_is_credit", False)
            st.subheader(f"📋 Review & Confirm ({len(analyzed)} transactions)")
            st.caption("Edit any field before importing.")
            edited = st.data_editor(
                analyzed,
                column_config={
                    "date": st.column_config.TextColumn("Date", width="small"),
                    "description": st.column_config.TextColumn("Description", width="large"),
                    "amount": st.column_config.NumberColumn("Amount", format="%.2f", width="small"),
                    "category": st.column_config.SelectboxColumn("Category", options=CATEGORIES, width="medium"),
                    "is_recurring": st.column_config.CheckboxColumn("Recurring?", width="small"),
                    "recurring_match": st.column_config.TextColumn("Match", width="medium"),
                },
                use_container_width=True,
                num_rows="fixed",
                height=400
            )
            total_expenses = abs(sum(t['amount'] for t in analyzed if t['amount']<0))
            total_income = sum(t['amount'] for t in analyzed if t['amount']>0)
            if is_credit_import:
                st.info("💳 Credit card import — payments are categorized as Transfer.")
                st.metric("Total charges this period", f"CAD$ {fmt(total_expenses,'CAD')}")
            else:
                col1, col2 = st.columns(2)
                with col1:
                    st.metric("Total Expenses", f"CAD$ {fmt(total_expenses,'CAD')}")
                with col2:
                    st.metric("Total Income", f"CAD$ {fmt(total_income,'CAD')}")
            st.divider()
            col1, col2 = st.columns(2)
            with col1:
                if st.button("✅ Import All Transactions", type="primary"):
                    success = 0
                    errors = 0
                    with st.spinner("Importing..."):
                        for t in edited:
                            try:
                                for fmt_str in ["%m/%d/%Y", "%Y%m%d", "%d %b. %Y", "%d/%m/%Y"]:
                                    try:
                                        date_obj = datetime.strptime(str(t["date"]).strip(), fmt_str)
                                        break
                                    except:
                                        continue
                                r = post_data("transactions", {
                                    "account_id": acc_id,
                                    "description": t["description"],
                                    "amount": float(t["amount"]),
                                    "currency": "CAD",
                                    "date": date_obj.strftime("%Y-%m-%dT%H:%M:%S"),
                                    "category": t["category"]
                                })
                                if r and r.status_code in [200,201]:
                                    success += 1
                                else:
                                    errors += 1
                            except Exception as e:
                                errors += 1
                    st.success(f"✅ Imported {success} transactions!")
                    if errors:
                        st.warning(f"⚠️ {errors} failed.")
                    del st.session_state["analyzed"]
                    st.rerun()
            with col2:
                if st.button("🗑️ Clear and start over"):
                    del st.session_state["analyzed"]
                    st.rerun()