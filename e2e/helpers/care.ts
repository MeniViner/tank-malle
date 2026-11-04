import { expect,type Page } from '@playwright/test';
export async function startCareEditor(page:Page,kind:'service'|'expense'|'plan') {
  if(kind!=='plan'&&new URL(page.url()).pathname==='/history') {
    await page.getByTestId('journal-add').click();
    await expect(page.getByTestId('journal-add-menu')).toBeVisible();
  }
  await page.getByRole('button',{name:{service:'הוספת טיפול',expense:'הוספת הוצאה',plan:'תזכורת'}[kind],exact:true}).click();
  const form=page.getByTestId('care-entry');
  await expect(form).toBeVisible();
  // The mounted form restores its step synchronously. Inspect only after its
  // heading is rendered, so a restored detail step is not mistaken for a
  // chooser that has not appeared yet.
  await expect(form.getByRole('heading')).toBeVisible();
  const choosing=kind==='plan'
    ? await form.getByRole('heading',{name:'למה נזכיר לך?',exact:true}).isVisible()
    : await page.getByTestId('care-step').getAttribute('data-step')==='1';
  if(choosing) {
    await form.getByTestId(kind==='expense'?'care-category-other':'care-job-periodic').click();
    if(kind==='service')await form.getByTestId('care-next').click();
  }
  await expect(form.getByTestId('care-save')).toBeVisible();
}
export async function setCareTitle(page:Page,title:string) {
  const form=page.getByTestId('care-entry'),field=form.getByTestId('care-title');
  if(!await field.isVisible())await form.locator('details').filter({has:page.getByTestId('care-title')}).locator('summary').click();
  await field.fill(title);
}
export async function addCareJob(page:Page,job:string) {
  const form=page.getByTestId('care-entry');await page.getByTestId('care-back').click();
  await expect(page.getByTestId('care-step')).toHaveAttribute('data-step','1');
  const choice=form.getByRole('button',{name:job,exact:true});await expect(choice).toHaveAttribute('aria-pressed','false');await choice.click();
  await form.getByTestId('care-next').click();
}
export async function setExpenseKind(page:Page,kind:string) {
  await page.getByTestId('care-back').click();
  await expect(page.getByTestId('care-step')).toHaveAttribute('data-step','1');
  await page.getByTestId('care-entry').getByRole('button',{name:kind,exact:true}).click();
}

export async function openCareHistory(page:Page) { await page.getByRole('navigation').getByRole('link',{name:'יומן',exact:true}).click(); }
export async function openCareRecord(page:Page,action:'edit'|'delete'='edit') {
  await page.getByTestId(/^journal-entry-(serviceEvents|vehicleExpenses)\//).first().click();
  await expect(page.getByTestId('journal-entry-sheet')).toBeVisible();
  await page.getByTestId('journal-entry-'+action).click();
}
export async function openCareCosts(page:Page) { await page.getByTestId('tab-vehicle').click();await page.locator('a[href="/vehicle?tab=costs"]').click(); }
