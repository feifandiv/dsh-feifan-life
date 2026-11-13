// 财务记账插件 · 视图共用工具
import { FinanceStore } from '../store';
import { formatMoney } from '../calc';

// 顶部 5 张统计卡（取当前账本）—— 仅数据看板视图使用
export function renderStatCards(host: HTMLElement, store: FinanceStore): void {
  const s = store.currentStats();
  const b = store.current();
  const sym = store.get().settings.currencySymbol;
  const wrap = host.createDiv('fl-stats');
  const mk = (label: string, value: number, cls?: 'income' | 'expense') => {
    const c = wrap.createDiv('fl-stat');
    c.createDiv({ cls: 'fl-stat-label', text: label });
    c.createDiv({
      cls: 'fl-stat-value' + (cls ? ' ' + cls : ''),
      text: formatMoney(value, sym),
    });
  };
  mk('本月收入', s.monthlyIncome, 'income');
  mk('本月支出', s.monthlyExpense, 'expense');
  mk('本月盈亏', s.monthlyProfit, s.monthlyProfit >= 0 ? 'income' : 'expense');
  mk('本月预算', b.monthlyBudget);
  mk('预算额度', s.budgetRemaining, s.budgetRemaining >= 0 ? 'income' : 'expense');
}
