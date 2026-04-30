import streamlit as st
import requests
import os
import json
import pandas as pd
from datetime import datetime, date
from collections import defaultdict

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

def patch_account(account_id, data):
    try:
        return requests.patch(f"{API_URL}/accounts/{account_id}", json=data, timeout=15)
    except:
        return None

def fmt(v, c):
    if c in ["BRL","EUR"]:
        return f"{v:,.2f}".replace(",","X").replace(".",",").replace("X",".")
    return f"{v:,.2f}"

def parse_statement(uploaded, from_date):
    content = uploaded.read().decode("utf-8-sig", errors="ignore")
    uploaded.seek(0)
    if ";" in content.split("\n")[0] or "Transaction Details" in content[:500]:
        lines = content.split("\n")
        header_idx = next((i for i, l in enumerate(lines) if l.startswith("Date;") or ("Description" in l and "Amount" in l and ";" in l)), None)
        if header_idx is None:
            return None, "Could not find header row in Amex file."
        import io
        raw = pd.read_csv(io.StringIO(content), sep=";", skiprows=header_idx)
        raw.columns = [c.strip() for c in raw.columns]
        df = raw[["Date","Description","Amount"]].copy()
        df.columns = ["date","description","amount"]
        df = df.dropna(subset=["description"])
        df = df[df["description"].str.strip() != ""]
        df["amount"] = df["amount"].astype(str).str.replace("$","",regex=False).str.replace(",","",regex=False).str.strip()
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1
        df["date_parsed"] = pd.to_datetime(df["date"].str.strip(), format="%d %b. %Y", errors="coerce")
        df["date"] = df["date_parsed"].dt.strftime("%-m/%-d/%Y")
        bank = "Amex"
    else:
        raw = pd.read_csv(uploaded)
        uploaded.seek(0)
        cols = [c.strip().lower() for c in raw.columns]
        if "transaction date" in cols and "cad$" in cols:
            raw.columns = [c.strip() for c in raw.columns]
            df = raw.rename(columns={"Transaction Date":"date","Description 1":"description","CAD$":"amount"})
            df = df[["date","description","amount"]].dropna(subset=["amount"])
            df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
            df["date_parsed"] = pd.to_datetime(df["date"])
            bank = f"RBC {raw['Account Type'].iloc[0]}" if "Account Type" in raw.columns else "RBC"
        elif "transaction amount" in cols:
            raw.columns = [c.strip() for c in raw.columns]
            df = raw.rename(columns={"Transaction Date":"date","Transaction Amount":"amount","Description":"description"})
            df = df[["date","description","amount"]].dropna(subset=["amount"])
            df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1
            df["date_parsed"] = pd.to_datetime(df["date"].astype(str), format="%Y%m%d")
            df["date"] = df["date_parsed"].dt.strftime("%-m/%-d/%Y")
            bank = "BMO"
        else:
            return None, f"Unrecognized format. Columns: {list(raw.columns)}"
    df = df.dropna(subset=["amount","date_parsed"])
    df = df[df["date_parsed"] >= pd.Timestamp(from_date)]
    df = df.drop(columns=["date_parsed"])
    return df, bank

st.set_page_config(page_title="FinDu", page_icon="💰", layout="centered")
st.title("💰 FinDu")
st.caption("Personal multi-currency financial control")

if "current_page" not in st.session_state:
    st.session_state.current_page = "Dashboard"

page = st.sidebar.selectbox(
    "Menu",
    ["Dashboard","Monthly View","Card Summary","Transactions","Accounts","Credit Cards","Recurring Expenses","Import Statement","Debug"],
    index=["Dashboard","Monthly View","Card Summary","Transactions","Accounts","Credit Cards","Recurring Expenses","Import Statement","Debug"].index(st.session_state.current_page)
)
st.session_state.current_page = page

@st.cache_data(ttl=3600)
def get_fx():
    try:
        r1 = requests.get("https://api.exchangerate-api.com/v4/latest/BRL", timeout=10)
        r2 = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=10)
        return {"BRL_CAD": r1.json()["rates"]["CAD"], "USD_CAD": r2.json()["rates"]["CAD"]}
    except:
        return {"BRL_CAD": None, "USD_CAD": None}

# ─────────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────────
elif page == "Dashboard":
    st.header("📊 Dashboard")
    st.caption(f"Today: {date.today().strftime('%B %d, %Y')}")
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
    checking = [a for a in accounts if a["account_type"] != "CREDIT_CARD"]
    cards = [a for a in accounts if a["account_type"] == "CREDIT_CARD"]
    cad_checking = [a for a in checking if a["currency"] == "CAD"]
    cad_cards = [a for a in cards if a["currency"] == "CAD"]
    brl_checking = [a for a in checking if a["currency"] == "BRL"]
    brl_cards_list = [a for a in cards if a["currency"] == "BRL"]

    if cad_checking or cad_cards:
        st.subheader("🇨🇦 Canada (CAD)")
        total_cad_cash = 0
        for a in cad_checking:
            st.metric(f"🏦 {a['name']}", f"CAD$ {fmt(a['balance'],'CAD')}")
            total_cad_cash += a["balance"]
        total_cards_due = 0
        if cad_cards:
            st.write("**💳 Card payments due:**")
            for card in cad_cards:
                try:
                    summary = requests.get(f"{API_URL}/accounts/{card['id']}/statement-summary", timeout=10).json()
                    due_groups = defaultdict(float)
                    for month, data in summary.items():
                        due = data.get("payment_due_date","")[:10]
                        charges = data.get("charges", 0)
                        if due and charges > 0:
                            due_groups[due] += charges
                    for due, total in sorted(due_groups.items()):
                        due_dt = datetime.strptime(due, "%Y-%m-%d").date()
                        days_left = (due_dt - date.today()).days
                        if days_left >= -30:
                            status = "🔴 OVERDUE" if days_left < 0 else f"⏳ {days_left}d" if days_left <= 7 else f"📅 {due}"
                            col1, col2 = st.columns([3,1])
                            with col1:
                                st.write(f"  • **{card['name']}**: CAD$ {fmt(total,'CAD')} (due {due})")
                            with col2:
                                st.caption(status)
                            total_cards_due += total
                except:
                    pass
            if total_cards_due > 0:
                st.caption(f"Total due: CAD$ {fmt(total_cards_due,'CAD')}")
        st.divider()
        cad_rec = sum(e["amount"] for e in recurring if e["currency"]=="CAD" and e.get("type")!="INCOME")
        cad_inc = sum(e["amount"] for e in recurring if e["currency"]=="CAD" and e.get("type")=="INCOME")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("💰 In Bank", f"CAD$ {fmt(total_cad_cash,'CAD')}")
            st.metric("💳 Cards Due", f"- CAD$ {fmt(total_cards_due,'CAD')}", delta_color="inverse")
            st.metric("🔄 Recurring", f"- CAD$ {fmt(cad_rec,'CAD')}", delta_color="inverse")
        with col2:
            net = total_cad_cash - total_cards_due - cad_rec
            st.metric("📊 Net Position", f"CAD$ {fmt(net,'CAD')}")
            if cad_inc > 0:
                st.metric("📈 + Income", f"CAD$ {fmt(cad_inc,'CAD')}")
                st.metric("🎯 After Income", f"CAD$ {fmt(net+cad_inc,'CAD')}")
    st.divider()

    if brl_checking or brl_cards_list:
        st.subheader("🇧🇷 Brazil (BRL)")
        total_brl_cash = 0
        for a in brl_checking:
            st.metric(f"🏦 {a['name']}", f"R$ {fmt(a['balance'],'BRL')}")
            total_brl_cash += a["balance"]
        brl_rec = sum(e["amount"] for e in recurring if e["currency"]=="BRL" and e.get("type")!="INCOME")
        brl_inc = sum(e["amount"] for e in recurring if e["currency"]=="BRL" and e.get("type")=="INCOME")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("💰 In Bank", f"R$ {fmt(total_brl_cash,'BRL')}")
            st.metric("🔄 Recurring", f"- R$ {fmt(brl_rec,'BRL')}", delta_color="inverse")
        with col2:
            net_brl = total_brl_cash - brl_rec
            st.metric("📊 Net Position", f"R$ {fmt(net_brl,'BRL')}")
            if brl_inc > 0:
                st.metric("🎯 After Income", f"R$ {fmt(net_brl+brl_inc,'BRL')}")
        if fx["BRL_CAD"]:
            st.caption(f"≈ CAD$ {fmt(total_brl_cash*fx['BRL_CAD'],'CAD')}")
    st.divider()

    st.subheader("💰 Net Worth (CAD)")
    total_cad_cash = sum(a["balance"] for a in cad_checking) if cad_checking else 0
    total_brl_cash = sum(a["balance"] for a in brl_checking) if brl_checking else 0
    total_bruto = total_cad_cash + (total_brl_cash * fx["BRL_CAD"] if fx["BRL_CAD"] else 0)
    st.caption(f"🇧🇷 R$ {fmt(total_brl_cash,'BRL')} ≈ CAD$ {fmt(total_brl_cash*fx['BRL_CAD'] if fx['BRL_CAD'] else 0,'CAD')} + 🇨🇦 CAD$ {fmt(total_cad_cash,'CAD')}")
    st.metric("Total assets", f"CAD$ {fmt(total_bruto,'CAD')}")

# ─────────────────────────────────────────────────────────────────
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
    current_month_str = f"{st.session_state.mv_year}-{st.session_state.mv_month:02d}"

    for currency, flag, symbol in [("CAD","🇨🇦","CAD$"),("BRL","🇧🇷","R$")]:
        st.subheader(f"{flag} {currency}")
        income_rec = [e for e in recurring if e["currency"]==currency and e.get("type")=="INCOME"]
        expense_rec = [e for e in recurring if e["currency"]==currency and e.get("type")!="INCOME"]
        total_rec_income = sum(e["amount"] for e in income_rec)
        total_rec_expense = sum(e["amount"] for e in expense_rec)

        card_accounts = [a for a in accounts if a["currency"]==currency and a["account_type"]=="CREDIT_CARD"]
        checking_accounts = [a for a in accounts if a["currency"]==currency and a["account_type"]!="CREDIT_CARD"]
        account_balance = sum(a["balance"] for a in checking_accounts)

        # Card charges for this statement month
        card_charges = 0
        card_breakdown = {}
        for acc in card_accounts:
            try:
                summary = requests.get(f"{API_URL}/accounts/{acc['id']}/statement-summary", timeout=10).json()
                if current_month_str in summary:
                    charges = summary[current_month_str].get("charges", 0)
                    card_charges += charges
                    card_breakdown[acc["name"]] = charges
            except:
                pass

        # Chequing transactions this month (already paid — for info only)
        checking_expenses = 0
        checking_income = 0
        category_totals = defaultdict(float)
        for acc in checking_accounts:
            try:
                txs = requests.get(f"{API_URL}/accounts/{acc['id']}/transactions", timeout=10).json()
                for t in txs:
                    if t["date"][:7] == current_month_str:
                        if t["amount"] < 0:
                            checking_expenses += abs(t["amount"])
                            cat = t.get("category") or "Other"
                            category_totals[cat] += abs(t["amount"])
                        elif t["amount"] > 0:
                            checking_income += t["amount"]
            except:
                pass

        # Summary metrics
        col1, col2 = st.columns(2)
        with col1:
            st.metric("🏦 In Bank", f"{symbol} {fmt(account_balance,currency)}")
            st.metric("💳 Card charges", f"{symbol} {fmt(card_charges,currency)}")
            st.metric("🔄 Recurring expenses", f"- {symbol} {fmt(total_rec_expense,currency)}")
        with col2:
            st.metric("📈 Recurring income", f"{symbol} {fmt(total_rec_income,currency)}")
            balance = account_balance + total_rec_income - total_rec_expense - card_charges
            st.metric("📊 Balance", f"{symbol} {fmt(balance,currency)}")

        # Recurring details
        if income_rec or expense_rec:
            with st.expander("Recurring details"):
                if income_rec:
                    st.write("**Income:**")
                    for e in income_rec:
                        st.write(f"  • {e['name']}: {symbol} {fmt(e['amount'],currency)} (day {e['due_day']})")
                if expense_rec:
                    st.write("**Expenses:**")
                    for e in expense_rec:
                        st.write(f"  • {e['name']}: {symbol} {fmt(e['amount'],currency)} (day {e['due_day']})")

        # Card breakdown
        if card_breakdown:
            with st.expander(f"Card charges breakdown — {current_month_str}"):
                for card_name, amount in card_breakdown.items():
                    st.write(f"  • {card_name}: {symbol} {fmt(amount,currency)}")

        # Chequing transactions (info only — already paid)
        if checking_expenses > 0 or checking_income > 0:
            with st.expander(f"Chequing transactions (already paid from bank)"):
                st.caption("These are debit transactions already deducted from your bank balance.")
                col1, col2 = st.columns(2)
                with col1:
                    st.metric("Spent", f"{symbol} {fmt(checking_expenses,currency)}")
                with col2:
                    st.metric("Received", f"{symbol} {fmt(checking_income,currency)}")
                if category_totals:
                    st.write("**By category:**")
                    for cat, amount in sorted(category_totals.items(), key=lambda x: -x[1]):
                        st.write(f"  • {cat}: {symbol} {fmt(amount,currency)}")
        st.divider()

# ─────────────────────────────────────────────────────────────────
elif page == "Card Summary":
    st.header("💳 Card Summary")
    accounts = get_accounts()
    cards = [a for a in accounts if a["account_type"]=="CREDIT_CARD"]
    if not cards:
        st.info("No credit cards registered.")
    else:
        selected_card = st.selectbox("Select card", [f"{c['id']} | {c['name']} ({c['bank']})" for c in cards])
        card_id = int(selected_card.split("|")[0].strip())
        card = next(c for c in cards if c["id"]==card_id)
        st.divider()
        try:
            summary = requests.get(f"{API_URL}/accounts/{card_id}/statement-summary", timeout=10).json()
            if not summary:
                st.info("No transactions imported yet for this card.")
            else:
                due_groups = defaultdict(float)
                for month, data in summary.items():
                    due = data.get("payment_due_date","")[:10]
                    if due:
                        due_groups[due] += data.get("charges", 0)
                st.subheader("💰 Upcoming Payments")
                for due_date, total in sorted(due_groups.items()):
                    st.metric(f"Due {due_date}", f"CAD$ {fmt(total,'CAD')}")
                st.divider()
                st.subheader("📅 By Statement Period")
                for month, data in sorted(summary.items(), reverse=True):
                    due = data.get("payment_due_date","")[:10] if data.get("payment_due_date") else "—"
                    total = data.get("charges", 0)
                    col1, col2, col3 = st.columns(3)
                    with col1:
                        st.metric(f"📅 {month}", f"CAD$ {fmt(total,'CAD')}")
                    with col2:
                        st.caption(f"Transactions: {data['count']}")
                    with col3:
                        st.caption(f"Due: {due}")
                    if st.button(f"View transactions — {month}", key=f"view_{month}"):
                        st.session_state["current_page"] = "Transactions"
                        st.session_state["nav_account_id"] = card_id
                        st.session_state["nav_month"] = month
                        st.rerun()
        except Exception as e:
            st.error(f"Error loading summary: {e}")

# ─────────────────────────────────────────────────────────────────
elif page == "Transactions":
    st.header("💸 Transactions")
    accounts = get_accounts()
    if not accounts:
        st.info("No accounts yet.")
    else:
        default_acc_idx = 0
        default_month = f"{date.today().year}-{date.today().month:02d}"
        nav_id = st.session_state.pop("nav_account_id", None)
        default_month = st.session_state.pop("nav_month", default_month)
        if nav_id:
            ids = [a["id"] for a in accounts]
            if nav_id in ids:
                default_acc_idx = ids.index(nav_id)
        selected = st.selectbox("Select account or card",
            [f"{a['id']} | {a['name']} ({a['bank']}) — {'Card' if a['account_type']=='CREDIT_CARD' else 'Account'}" for a in accounts],
            index=default_acc_idx)
        acc_id = int(selected.split("|")[0].strip())
        acc = next(a for a in accounts if a["id"]==acc_id)
        is_card = acc["account_type"] == "CREDIT_CARD"
        if is_card:
            month_filter = st.text_input("Filter by statement month (e.g. 2026-04)", value=default_month)
        st.divider()
        try:
            txs = requests.get(f"{API_URL}/accounts/{acc_id}/transactions", timeout=10).json()
            if is_card and month_filter:
                txs = [t for t in txs if t.get("statement_month")==month_filter]
            if not txs:
                st.info("No transactions found.")
            else:
                cols_to_show = ["id","date","description","amount","category","statement_month"] if is_card else ["id","date","description","amount","category"]
                df = pd.DataFrame(txs)[cols_to_show]
                df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
                edited = st.data_editor(
                    df,
                    column_config={
                        "id": st.column_config.NumberColumn("ID", width="small"),
                        "date": st.column_config.TextColumn("Date", width="small"),
                        "description": st.column_config.TextColumn("Description", width="large"),
                        "amount": st.column_config.NumberColumn("Amount", format="%.2f", width="small"),
                        "category": st.column_config.SelectboxColumn("Category", options=CATEGORIES, width="medium"),
                        "statement_month": st.column_config.TextColumn("Statement", width="small"),
                    },
                    use_container_width=True, num_rows="fixed", height=400
                )
                col1, col2 = st.columns(2)
                with col1:
                    if st.button("💾 Save category changes", type="primary"):
                        updated = 0
                        for _, row in edited.iterrows():
                            orig = next((t for t in txs if t["id"]==row["id"]), None)
                            if orig and orig["category"] != row["category"]:
                                requests.patch(f"{API_URL}/transactions/{row['id']}", json={"category": row["category"]}, timeout=10)
                                updated += 1
                        st.success(f"Updated {updated} transactions!")
                with col2:
                    if is_card:
                        charges = sum(abs(t["amount"]) for t in txs if t["amount"] < 0)
                        payments = sum(t["amount"] for t in txs if t["amount"] > 0)
                        st.metric("Total Charges", f"CAD$ {fmt(charges,'CAD')}")
                        if payments > 0:
                            st.caption(f"Payments: CAD$ {fmt(payments,'CAD')}")
                    else:
                        total = sum(t["amount"] for t in txs)
                        st.metric("Total", f"CAD$ {fmt(total,'CAD')}")
        except Exception as e:
            st.error(f"Error: {e}")

# ─────────────────────────────────────────────────────────────────
elif page == "Accounts":
    st.header("🏦 Bank Accounts")
    accounts = [a for a in get_accounts() if a["account_type"]!="CREDIT_CARD"]
    for a in accounts:
        col1, col2, col3 = st.columns([4,1,1])
        with col1:
            st.write(f"**{a['name']}** — {a['bank']} | {a['currency']} {fmt(a['balance'],a['currency'])}")
        with col2:
            if st.button("✏️", key=f"edit_{a['id']}"):
                st.session_state[f"editing_{a['id']}"] = True
        with col3:
            if st.button("🗑️", key=f"del_{a['id']}"):
                r = delete_data("accounts", a["id"])
                if r is not None and r.status_code in [200,204]:
                    st.success("Deleted!")
                    st.rerun()
        if st.session_state.get(f"editing_{a['id']}"):
            new_bal = st.number_input(f"New balance for {a['name']}", value=float(a["balance"]), key=f"bal_{a['id']}")
            if st.button(f"Save", key=f"save_{a['id']}"):
                patch_account(a["id"], {"balance": new_bal})
                st.session_state.pop(f"editing_{a['id']}", None)
                st.success("Balance updated!")
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

# ─────────────────────────────────────────────────────────────────
elif page == "Credit Cards":
    st.header("💳 Credit Cards")
    cards = [a for a in get_accounts() if a["account_type"]=="CREDIT_CARD"]
    for c in cards:
        col1, col2 = st.columns([6,1])
        with col1:
            st.write(f"**{c['name']}** — {c['bank']} | {c['currency']} | Limit: {fmt(c['credit_limit'],c['currency'])} | Closes: day {c['closing_day']} | Due: day {c['due_day']}")
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
        current_balance = st.number_input("Current balance (amount you already owe)", value=0.0, min_value=0.0)
        closing = st.number_input("Closing day", min_value=1, max_value=31, value=1)
        due = st.number_input("Due day", min_value=1, max_value=31, value=10)
        if st.form_submit_button("Add Credit Card"):
            r = post_data("accounts", {"name":name,"bank":bank,"account_type":"CREDIT_CARD","currency":currency,"balance":current_balance,"credit_limit":limit,"closing_day":int(closing),"due_day":int(due)})
            if r is not None and r.status_code in [200,201]:
                st.success("Card created!")
                st.rerun()
            else:
                st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

# ─────────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────────
elif page == "Import Statement":
    st.header("📂 Import Bank Statement")
    st.caption("Supports RBC (Chequing & Credit), Amex CSV, and BMO CSV.")
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

        # Reconciliation UI (shown after import)
        
            if "reconcile_acc_id" in st.session_state:
            r_acc_id = st.session_state["reconcile_acc_id"]
            r_acc = next((a for a in accounts if a["id"]==r_acc_id), None)
            auto_balance = st.session_state.get("reconcile_new_balance", float(r_acc["balance"]) if r_acc else 0.0)
            st.subheader("💰 Confirm Account Balance")
            st.caption("We calculated the new balance automatically. Please confirm or correct it.")
            if r_acc:
                st.write(f"Account: **{r_acc['name']}**")
            st.info(f"Calculated new balance: **CAD$ {fmt(auto_balance,'CAD')}**")
            new_bal = st.number_input("Confirm or correct balance:", value=auto_balance, key="new_bal_input")
            with col1:
                if st.button("✅ Update balance", type="primary"):
                    patch_account(r_acc_id, {"balance": new_bal})
                    st.success(f"✅ Balance updated to CAD$ {fmt(new_bal,'CAD')}!")
                    del st.session_state["reconcile_acc_id"]
                    st.rerun()
            with col2:
                if st.button("Skip"):
                    del st.session_state["reconcile_acc_id"]
                    st.rerun()
            st.divider()

        uploaded = st.file_uploader("📁 Upload CSV file (RBC, Amex, or BMO)", type=["csv"])
        if uploaded:
            try:
                df, bank_detected = parse_statement(uploaded, from_date)
                if df is None:
                    st.error(bank_detected)
                elif df.empty:
                    st.warning("No transactions found after the selected date.")
                else:
                    try:
                        last_tx = requests.get(f"{API_URL}/accounts/{account_id}/last-transaction", timeout=10).json()
                        last_date = last_tx.get("last_date")
                        if last_date:
                            last_dt = pd.Timestamp(last_date)
                            new_df = df[pd.to_datetime(df["date"]) > last_dt]
                            st.info(f"📅 Last transaction: **{last_dt.strftime('%b %d, %Y')}**. Found **{len(new_df)} new transactions** out of {len(df)}.")
                            df = new_df
                        else:
                            st.info("No previous transactions found. Showing all transactions.")
                    except:
                        pass
                    if df.empty:
                        st.success("✅ All transactions already registered!")
                    else:
                        st.success(f"✅ **{bank_detected}** — **{len(df)} new transactions**")
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
                use_container_width=True, num_rows="fixed", height=400
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
                                date_obj = None
                                for fmt_str in ["%m/%d/%Y","%Y%m%d","%d %b. %Y","%d/%m/%Y"]:
                                    try:
                                        date_obj = datetime.strptime(str(t["date"]).strip(), fmt_str)
                                        break
                                    except:
                                        continue
                                if not date_obj:
                                    errors += 1
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
                    # For chequing: auto-calculate and update balance
                    if not is_credit_import:
                        net = sum(float(t.get("amount", 0)) for t in edited)
                        current_balance = float(selected_acc.get("balance", 0))
                        new_balance = round(current_balance + net, 2)
                        patch_result = patch_account(acc_id, {"balance": new_balance})
                        if patch_result and patch_result.status_code in [200, 201]:
                            st.info(f"💰 Account balance automatically updated: CAD$ {fmt(new_balance,'CAD')}")
                        st.session_state["reconcile_acc_id"] = acc_id
                        st.session_state["reconcile_new_balance"] = new_balance
                    del st.session_state["analyzed"]
                    st.rerun()
            with col2:
                if st.button("🗑️ Clear and start over"):
                    del st.session_state["analyzed"]
                    st.rerun()