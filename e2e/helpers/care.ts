import { expect,type Page } from '@playwright/test';
export async function startCareEditor(page:Page,kind:'service'|'expense'|'plan') {
  await page.getByRole('button',{name:{service:'הוספת טיפול',expense:'הוספת הוצאה',plan:'הוספת תזכורת לטיפול'}[kind],exact:true}).click();
  const chooser=page.getByRole('heading',{name:kind==='service'?'מה בוצע ברכב?':kind==='expense'?'על מה ההוצאה?':'למה נזכיר לך?',exact:true});
  if(await chooser.isVisible()) {
    await page.getByRole('dialog').getByRole('button',{name:kind==='expense'?'אחר':'טיפול תקופתי',exact:true}).click();
    if(kind==='service')await page.getByRole('button',{name:'המשך לפרטי הטיפול',exact:true}).click();
  }
}
export async function setCareTitle(page:Page,title:string) {
  const dialog=page.getByRole('dialog'),field=dialog.getByLabel('תיאור',{exact:true});
  if(!await field.isVisible())await dialog.getByText('עוד פרטים',{exact:true}).click();
  await field.fill(title);
}
export async function addCareJob(page:Page,job:string) {
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'שינוי סוג הרשומה'}).click();
  const choice=dialog.getByRole('button',{name:job,exact:true});await expect(choice).toHaveAttribute('aria-pressed','false');await choice.click();
  await dialog.getByRole('button',{name:'המשך לפרטי הטיפול',exact:true}).click();
}
export async function setExpenseKind(page:Page,kind:string) {
  await page.getByRole('dialog').getByRole('button',{name:'שינוי סוג הרשומה'}).click();
  await page.getByRole('dialog').getByRole('button',{name:kind,exact:true}).click();
}
