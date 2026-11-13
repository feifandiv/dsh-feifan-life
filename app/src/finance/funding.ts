import { FundingPlan, PlannedExpense } from './models';

export interface FundingPlanTotals {
  confirmed: number;
  estimated: number;
  incomeTotal: number;
  mandatory: number;
  flexible: number;
  allocated: number;
  actualSpent: number;
  outstanding: number;
  confirmedLeft: number;
  estimatedLeft: number;
  available: number;
  over: number;
  mandatoryGap: number;
  mandatorySafety: number;
}

export interface ExpenseFundingSource {
  confirmed: number;
  estimated: number;
  over: number;
}

const amountOf = (value: number): number => Math.max(0, Number(value) || 0);

export function fundingPlanTotals(plan: FundingPlan | undefined): FundingPlanTotals {
  const incomes = plan?.incomes ?? [];
  const expenses = plan?.expenses ?? [];
  const confirmed = incomes
    .filter((item) => item.status === 'confirmed')
    .reduce((sum, item) => sum + amountOf(item.amount), 0);
  const estimated = incomes
    .filter((item) => item.status === 'estimated')
    .reduce((sum, item) => sum + amountOf(item.amount), 0);
  const mandatory = expenses
    .filter((item) => item.kind === 'mandatory')
    .reduce((sum, item) => sum + amountOf(item.amount), 0);
  const flexible = expenses
    .filter((item) => item.kind === 'flexible')
    .reduce((sum, item) => sum + amountOf(item.amount), 0);
  const incomeTotal = confirmed + estimated;
  const allocated = mandatory + flexible;
  const actualSpent = expenses.reduce((sum, item) => sum + amountOf(item.actualAmount), 0);
  const outstanding = expenses.reduce(
    (sum, item) =>
      sum + (item.executionStatus === 'completed' ? 0 : Math.max(0, amountOf(item.amount) - amountOf(item.actualAmount))),
    0,
  );
  const confirmedUsed = Math.min(confirmed, allocated);
  const estimatedUsed = Math.min(estimated, Math.max(0, allocated - confirmed));
  const confirmedLeft = Math.max(0, confirmed - confirmedUsed);
  const estimatedLeft = Math.max(0, estimated - estimatedUsed);

  return {
    confirmed,
    estimated,
    incomeTotal,
    mandatory,
    flexible,
    allocated,
    actualSpent,
    outstanding,
    confirmedLeft,
    estimatedLeft,
    available: confirmedLeft + estimatedLeft,
    over: Math.max(0, allocated - incomeTotal),
    mandatoryGap: Math.max(0, mandatory - confirmed),
    mandatorySafety: Math.max(0, confirmed - mandatory),
  };
}

export function orderedFundingExpenses(plan: FundingPlan | undefined): PlannedExpense[] {
  return (plan?.expenses ?? []).slice().sort((a, b) => {
    const completedA = a.executionStatus === 'completed' ? 1 : 0;
    const completedB = b.executionStatus === 'completed' ? 1 : 0;
    if (completedA !== completedB) return completedA - completedB;
    const kindA = a.kind === 'mandatory' ? 0 : 1;
    const kindB = b.kind === 'mandatory' ? 0 : 1;
    if (kindA !== kindB) return kindA - kindB;
    if (a.amount !== b.amount) return b.amount - a.amount;
    return a.createdAt - b.createdAt;
  });
}

export function fundingSources(plan: FundingPlan | undefined): Map<string, ExpenseFundingSource> {
  const totals = fundingPlanTotals(plan);
  let confirmedLeft = totals.confirmed;
  let estimatedLeft = totals.estimated;
  const result = new Map<string, ExpenseFundingSource>();

  for (const expense of orderedFundingExpenses(plan)) {
    const amount = amountOf(expense.amount);
    const confirmed = Math.min(confirmedLeft, amount);
    confirmedLeft -= confirmed;
    const afterConfirmed = amount - confirmed;
    const estimated = Math.min(estimatedLeft, afterConfirmed);
    estimatedLeft -= estimated;
    result.set(expense.id, {
      confirmed,
      estimated,
      over: Math.max(0, afterConfirmed - estimated),
    });
  }

  return result;
}
