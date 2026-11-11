import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Demo } from '../src/demo';

async function demo(page: Page) {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Настройте OWNER_PASSWORD. Доступ закрыт.' }),
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Посмотреть демопанель' }).click();
  await expect(page.getByRole('heading', { name: 'Всё под вашим контролем.' })).toBeVisible();
}

test('desktop overview and all navigation routes render without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await demo(page);
  await page.screenshot({ path: 'test-results/sova-overview.png', fullPage: true });
  for (const [nav, heading] of [
    ['Песочницы', 'Песочницы.'],
    ['Модели и ИИ', 'Модели и поведение.'],
    ['Активность', 'Журнал активности.'],
    ['Внешний вид', 'Внешний вид.'],
    ['Безопасность', 'Безопасность.'],
    ['Как это работает', 'Как всё устроено.'],
  ]) {
    await page
      .getByRole('navigation')
      .getByRole('button', { name: nav, exact: nav !== 'Песочницы' })
      .click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});

test('password login, incorrect password, session expiry and logout', async ({ page }) => {
  const example = new Demo();
  const fixture = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk0123456789_-';
  let signedIn = false;
  await page.route('**/api/session', (route) =>
    route.fulfill(
      signedIn
        ? { json: { email: 'Владелец', access: 'owner', backend_configured: true } }
        : { status: 401, json: { detail: 'Введите пароль владельца.' } },
    ),
  );
  await page.route('**/api/login', async (route) => {
    const body = route.request().postDataJSON();
    if (body.password !== fixture)
      return route.fulfill({ status: 401, json: { detail: 'Неверный пароль.' } });
    signedIn = true;
    return route.fulfill({
      json: { email: 'Владелец', access: 'owner', backend_configured: true },
    });
  });
  await page.route('**/api/logout', (route) => {
    signedIn = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/v1/**', async (route) => {
    if (!signedIn) return route.fulfill({ status: 401, json: { detail: 'Сессия завершена' } });
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    return route.fulfill({ json: await example.request(path, 'GET') });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByLabel('Пароль владельца', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/sova-password-login.png', fullPage: true });
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
  await page.getByLabel('Пароль владельца', { exact: true }).fill('x'.repeat(43));
  await page.getByRole('button', { name: 'Войти в пространство' }).click();
  await expect(page.getByText('Неверный пароль.', { exact: true })).toBeVisible();
  await page.getByLabel('Пароль владельца', { exact: true }).fill(fixture);
  await page.getByRole('button', { name: 'Войти в пространство' }).click();
  await expect(page.getByRole('heading', { name: 'Всё под вашим контролем.' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await expect(page.getByLabel('Пароль владельца', { exact: true })).toHaveValue('');
  await page.getByLabel('Пароль владельца', { exact: true }).fill(fixture);
  await page.getByRole('button', { name: 'Войти в пространство' }).click();
  await expect(page.getByRole('heading', { name: 'Всё под вашим контролем.' })).toBeVisible();
  signedIn = false;
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect(page.getByLabel('Пароль владельца', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Всё под вашим контролем.' })).toHaveCount(0);
});

test('status, sandbox profile, materials and model settings work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await demo(page);
  await page.getByLabel('Ручной статус аккаунта').selectOption('online');
  await expect(page.getByText('Сейчас отвечаете вы')).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Песочницы' }).click();
  await page.getByRole('button', { name: 'Настроить чат 1001' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Ваше имя', { exact: true }).fill('Тестовый владелец');
  await dialog.getByRole('button', { name: 'Сохранить профиль' }).click();
  await dialog.getByRole('button', { name: 'Заметка', exact: true }).click();
  await dialog.getByLabel('Заголовок', { exact: true }).fill('Новая заметка');
  await dialog.getByLabel('Информация о вас', { exact: true }).fill('Секрет только этой песочницы');
  await dialog.getByRole('button', { name: 'Добавить в песочницу' }).click();
  await expect(dialog.getByText('Новая заметка', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Контекст', exact: true }).click();
  await expect(dialog.getByText('Секрет только этой песочницы', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть окно' }).click();
  await page.getByRole('button', { name: 'Настроить чат 1002' }).click();
  await dialog.getByRole('button', { name: 'Контекст', exact: true }).click();
  await expect(dialog.getByText('Секрет только этой песочницы', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Закрыть окно' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Модели и ИИ' }).click();
  await page.getByLabel('Модель', { exact: true }).fill('new-vision-model');
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Обновить данные', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('new-vision-model');
  await page.getByRole('button', { name: 'Применить настройки' }).click();
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('new-vision-model');
});

test('mobile, dark theme, keyboard and accessibility', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Внешний вид' }).click();
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Океан', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Обзор', exact: true }).click();
  await page.screenshot({
    path: 'test-results/sova-mobile-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('real-mode disconnected state never pretends the bot is connected', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: { email: 'owner@example.com', access: 'owner', backend_configured: false },
    }),
  );
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Добавьте BOT_API_URL и BOT_ADMIN_TOKEN' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Нет связи с ботом' })).toBeVisible();
  await expect(page.getByText('Добавьте BOT_API_URL и BOT_ADMIN_TOKEN')).toBeVisible();
  await expect(page.getByText('Telegram подключён', { exact: true })).toHaveCount(0);
});

test('light theme pages and sandbox dialog meet accessibility checks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await demo(page);
  for (const label of [
    'Обзор',
    'Песочницы',
    'Модели и ИИ',
    'Активность',
    'Внешний вид',
    'Безопасность',
    'Как это работает',
  ]) {
    await page
      .getByRole('navigation')
      .getByRole('button', { name: label, exact: label !== 'Песочницы' })
      .click();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      label,
    ).toEqual([]);
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Песочницы' }).click();
  await page.getByRole('button', { name: 'Настроить чат 1001' }).click();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
});
