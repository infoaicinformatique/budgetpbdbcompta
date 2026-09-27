import { employeeMonth, employeeBonusFor, employeePresenceDays } from './excel-grid/scripts/check-budget-app.mjs';

const employee = {
  id: 'e1', companyId: 'c1', grossMonthly: 2000, employerRate: 0.42, employeeRate: 0.22,
  startDate: '', endDate: '', bonuses: [{ month: 11, amount: 1000 }], raises: [],
};
const m = employeeMonth(employee, 2026, 11);
console.log(JSON.stringify(m, null, 2));
console.log('presenceDays', employeePresenceDays(employee, 2026, 11));
console.log('bonusFor', employeeBonusFor(employee, 11));
