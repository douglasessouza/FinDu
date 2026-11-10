import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRecurringForMonth, recurrenceDates } from '../src/utils/recurrence.ts'
import { projectCalendarMonths } from '../src/utils/calendarProjection.ts'
import { calculateMonthlyPlan } from '../src/utils/monthlyPlan.ts'
import type { RecurringExpense, MonthlyDashboardResponse } from '../src/services/api.ts'
const car: RecurringExpense = { id:22,name:'Car Bi-Weekly',amount:362.78,currency:'CAD',due_day:6,type:'EXPENSE',category:'Car',payment_method:'DEBIT',payment_account_id:11,frequency:'BIWEEKLY',anchor_date:'2026-11-06',start_month:'2026-11',valid_until:'2027-12-31' }
test('14-day cadence drifts across months and January has three payments',()=>{
 assert.deepEqual(recurrenceDates(car,'2026-11'),['2026-11-06','2026-11-20'])
 assert.deepEqual(recurrenceDates(car,'2026-12'),['2026-12-04','2026-12-18'])
 assert.deepEqual(recurrenceDates(car,'2027-01'),['2027-01-01','2027-01-15','2027-01-29'])
 assert.deepEqual(recurrenceDates({...car,valid_until:'2027-01-15'},'2027-01'),['2027-01-01','2027-01-15'])
 assert.deepEqual(recurrenceDates(car,'2026-10'),[])
})
test('UTC date arithmetic handles leap February and preserves exact 14-day intervals',()=>{
 assert.deepEqual(recurrenceDates({...car,anchor_date:'2028-02-02',start_month:'2028-02',valid_until:undefined},'2028-03'),['2028-03-01','2028-03-15','2028-03-29'])
})
test('monthly occurrences have independent identities and retain the editable source',()=>{
 const rows=expandRecurringForMonth([car],'2027-01')
 assert.deepEqual(rows.map(r=>r.due_day),[1,15,29])
 assert.equal(new Set(rows.map(r=>r.id)).size,3)
 assert.ok(rows.every(r=>r.recurring_source_id===22))
 assert.equal(rows.reduce((s,r)=>s+r.amount,0).toFixed(2),'1088.34')
 const monthly={...car,frequency:'MONTHLY' as const}
 assert.deepEqual(expandRecurringForMonth([monthly],'2027-01'),[monthly])
})
test('two actual installments settle independently and a manual payment settles only one occurrence',()=>{
 const cards={month:'2026-11',cards:[],total_charges:0,total_credits:0,total_payments:0,total_amount_due:0,currency:null,totals_by_currency:{}}
 const data:MonthlyDashboardResponse={month:'2026-11',accounts:[{id:11,name:'RBC',bank:'RBC',account_type:'CHECKING',currency:'CAD',balance:1000}],recurring:[car],payments:[],previous_month_overrides:[],overrides:[],matches:[],checking_transactions:[{id:965,account_id:11,date:'2026-11-06',description:'Toyota Finance',amount:-362.78,currency:'CAD',category:'Car'}],card_transactions_due:[],card_transactions_current:[],card_summaries:cards,card_summaries_due:cards}
 assert.equal(projectCalendarMonths([data],'CAD','2026-11',()=>0)['2026-11'].remainingExpenses,362.78)
 const rows=expandRecurringForMonth([car],'2026-11')
 data.payments=[{id:1,month:data.month,item_type:'recurring',item_id:rows[1].id,item_name:car.name,paid_at:''}]
 assert.equal(projectCalendarMonths([data],'CAD','2026-11',()=>0)['2026-11'].remainingExpenses,0)
 const plan=calculateMonthlyPlan('2027-01','CAD',[car],[],[],[],[])
 assert.equal(plan.fixedPlanned,1088.34)
})

test('explicit budget coverage keeps using the schedule source ID and applies once',()=>{
 const result=calculateMonthlyPlan('2027-01','CAD',[car],[{id:1,category:'Car',amount:362.78,currency:'CAD',start_month:'2026-11',items:[{id:9,name:'Transport envelope',amount:362.78}]}],[{id:1,budget_item_id:9,recurring_id:22,amount:362.78}],[],[])
 assert.equal(result.variableAllowance,0)
 assert.equal(result.totalPlanned,1088.34)
})

test('a saved source match resolves to its exact dated installment without settling its sibling',async()=>{
 const { recurringMatchItem }=await import('../src/utils/recurrence.ts')
 const rows=expandRecurringForMonth([car],'2026-11')
 assert.equal(recurringMatchItem(rows,22,'2026-11-06')?.id,rows[0].id)
 assert.equal(recurringMatchItem(rows,22,'2026-11-20')?.id,rows[1].id)
 assert.equal(recurringMatchItem(rows,22,'2026-10-23'),undefined)
})
