import { test } from '@playwright/test';
import { completeTcoFlow, filteredJournalTcoFlow, missingTcoFlow, preciseTestCostFlow, responsiveTcoFlow } from './helpers/tco';

test.use({ viewport: { width: 390, height: 844 } });
test('TCO totals deduplicate fixed invoices, annualise by twelve and agree across Home and Insights', async ({ page }) => { await completeTcoFlow(page); });
test('a missing insurance cost is added through its real nested sheet and removes exactly that missing item', async ({ page }) => { await missingTcoFlow(page); });
test('the optional annual test cost preserves exact decimals and unknown metadata through save and reload', async ({ page }) => { await preciseTestCostFlow(page); });
test('TCO component rows open the real Journal with its matching filter and time window', async ({ page }) => { await filteredJournalTcoFlow(page); });
test('TCO fits all responsive widths, dark mint, and stays absent for an empty vehicle', async ({ page }) => { await responsiveTcoFlow(page); });
