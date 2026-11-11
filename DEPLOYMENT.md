# Публикация Sova на Cloudflare Pages

В репозитории находятся сайт, Cloudflare Functions и обновлённый Python-бот.
База, Telegram-сессия и реальные секреты в Git не входят.

## Схема работы

```text
Ваш браузер → Cloudflare Access → Pages Function → HTTPS Cloudflare Tunnel → Python API
                                                                                ↓
                                                                        Telegram и ваш ИИ
```

Cloudflare Pages размещает React-сайт и защищённый proxy. Постоянный Telegram-клиент
запускается отдельно на Windows/Linux-компьютере или VPS. Обычная публикация сайта
не запускает Python/Telethon. Когда компьютер с ботом выключен, сайт покажет ошибку связи.

## 1. Разместить сайт из GitHub

В Cloudflare откройте **Workers & Pages → Create application → Pages → Connect to Git**
(названия разделов могут немного отличаться в панели). Выберите репозиторий
`alter413/site_on_chatgpt` и ветку `main`.

| Настройка | Значение |
| --- | --- |
| Framework preset | None |
| Root directory | корень репозитория, оставить пустым |
| Build command | `npm run build` |
| Build output directory | `web-dist` |
| NODE_VERSION | `22` |

Установка npm-зависимостей выполняется Cloudflare по package-lock.json. Локальная
проверка той же сборки: `npm ci` → `npm run build`.

В корне уже есть `functions/api/[[path]].ts`, `wrangler.toml` и `_routes.json`.
Не переносите в Cloudflare только папку исходников `src`: нужны сборка и Functions.
Загрузка готовой папки через обычный drag-and-drop не заменяет публикацию Functions;
используйте Git integration либо Wrangler.

Без дальнейшей настройки сайт безопасно показывает вход и демопанель. API управления
возвращает 503 и ничего не проксирует.

## 2. Защитить личный вход Cloudflare Access

Для production удобно добавить свой домен, например `sova.example.com`, в Pages →
Custom domains. Встроенная защита preview deployments не заменяет защиту production.
Публичный pages.dev адрес при этом не открывает управление: Function всё равно
требует действительный JWT нужного Access-приложения и email владельца.

В **Cloudflare Zero Trust → Access → Applications**:

1. Создайте приложение **Self-hosted** для полного домена сайта, без ограничения пути.
2. Добавьте **Allow policy** с единственным конкретным email владельца. Не ставьте Everyone
   и не добавляйте Bypass для API.
3. Выберите One-time PIN или свой identity provider. Включите MFA у провайдера, если нужно.
4. Скопируйте **Application Audience (AUD)** этого приложения.
5. Скопируйте свой team domain вида `https://your-team.cloudflareaccess.com`.

В Pages → Settings → Variables and Secrets добавьте для **Production**:

| Переменная | Пример / источник |
| --- | --- |
| `OWNER_EMAIL` | ваш единственный email из Access policy |
| `CF_ACCESS_TEAM_DOMAIN` | `https://your-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | AUD именно приложения сайта |

Не добавляйте префикс `VITE_`: это серверные переменные. После изменения выполните
новый deployment. Для preview либо настройте соответствующую Access-защиту и
переменные отдельно, либо оставьте preview без секретов: его API будет закрыт.

Сервер проверяет криптографическую подпись RS256 по ключам Cloudflare, issuer,
audience, exp/iat/sub/email и точное совпадение email. Заголовок с email без
подписанного JWT доступа не даёт. Сам по себе токен Python API также не авторизует вход на сайт.

Если открываете сайт на другом production-домене, этот домен тоже должен быть покрыт
Access-приложением. Кнопка входа обновляет `/`: Cloudflare перехватывает запрос и
предлагает авторизацию. Выход выполняется через `/cdn-cgi/access/logout`.

## 3. Запустить обновлённого бота

На компьютере с ботом:

```powershell
git clone https://github.com/alter413/site_on_chatgpt.git
cd site_on_chatgpt
$env:PYTHONUTF8 = "1"
uv sync --locked
uv run python -m sandbox_bot
```

Или запустите `start.cmd`. Если переносите прежнего бота, используйте прежнюю папку данных:

```powershell
uv run python -m sandbox_bot --data-dir "C:\путь\к\прежней\data"
```

Это сохраняет сессию, профили и материалы. Таблицы статистики создадутся автоматически;
старая переписка для их заполнения не читается.

Токен управления при запуске задайте постоянным случайным значением не короче 24 символов.
Он должен совпасть с `BOT_ADMIN_TOKEN` на Cloudflare. Можно задать его в окружении
процесса как `SANDBOX_ADMIN_TOKEN`. Не вводите реальные токены в README или команды,
которые собираетесь публиковать. Приложение предлагает генерацию токена при первом вводе.

Для проверки настройки сайта без Telegram допустим `--api-only`, но изменение
модели и реальные диалоги в этом режиме недоступны.

## 4. Подключить Cloudflare Tunnel

Нужен постоянный HTTPS-адрес API, например `https://bot-api.example.com`.
Создайте managed tunnel в Zero Trust, установите и запустите `cloudflared` по команде
из панели Cloudflare на той же машине, что и Python-бот.

Для опубликованного hostname туннеля:

| Поле | Значение |
| --- | --- |
| Hostname | `bot-api.example.com` |
| Service type | HTTP |
| Service URL | `localhost:8765` |

Сам Python API слушает только 127.0.0.1. Открывать 8765 в роутере не нужно.
Если cloudflared и Python в разных контейнерах, localhost — разные сетевые пространства:
запускайте их с общей сетью/на одном хосте либо отдельно настройте внутреннюю маршрутизацию.

В Pages добавьте **Secrets**:

| Переменная | Значение |
| --- | --- |
| `BOT_API_URL` | `https://bot-api.example.com`, без `/api/v1`, query и login/password |
| `BOT_ADMIN_TOKEN` | тот же секрет, что у Python-бота |

Для дополнительного ограничения доступа к самому Tunnel можно создать второе
Access-приложение для `bot-api.example.com` с политикой **Service Auth** и service token.
Тогда добавьте в Pages ещё два секрета:

- `BOT_ACCESS_CLIENT_ID`
- `BOT_ACCESS_CLIENT_SECRET`

Не используйте для Tunnel обычную email-login страницу, если не задали service token:
proxy не следует редиректам и покажет ошибку. Если отдельной Access-защиты у Tunnel
нет, API бота всё равно требует длинный bearer-токен; сохранность этого токена критична.

Пересоберите сайт после настройки. Войдите владельцем, убедитесь, что подключён Telegram,
наполните одну тестовую песочницу, включите её и переключите статус с «Онлайн».

## 5. Что доступно в панели

- Глобальный ручной статус и быстрая остановка автоответов.
- Список личных диалогов, разрешения, профиль и материалы отдельно для каждого чата.
- Загрузка файлов, заметки, удаление с подтверждением, просмотр разрешённого контекста.
- Base URL, название модели, загрузка списка `/models`, замена API key, стиль и длина ответа.
- Ключ Tavily и отдельное разрешение поиска для каждого чата.
- Графики ответов/пропусков, распределение по часам, результаты обработки, расход токенов.
- Журнал метаданных с фильтрами, пагинацией и CSV. Тексты переписки не сохраняются.
- Светлая/тёмная/системная тема, три акцента, плотность, название и интервал обновления.

Оформление хранится локально в этом браузере; секретов в localStorage нет.
Выбор модели и адрес провайдера сохраняются как несекретные подсказки следующего запуска.
Стиль и длина восстанавливаются автоматически. Новые ключи живут только в памяти бота
и после перезапуска вводятся снова. При смене хоста провайдера требуется новый API key,
чтобы старый ключ не был случайно отправлен другому провайдеру.

Статистика начинается с событий новой версии. Использование токенов зависит от
поля usage в ответе провайдера; если провайдер его не возвращает, расход не известен
и счётчик остаётся нулевым. Денежные расходы не оцениваются по выдуманным тарифам.
Временные границы графиков — UTC; время событий показывается в часовом поясе браузера.
Хранятся последние 20 000 событий, поэтому очень активная установка может иметь
неполный 30-дневный период после ротации.

## Локальная разработка сайта

```powershell
npm ci
npm run dev
```

Откройте http://127.0.0.1:5173 и нажмите «Посмотреть демопанель».
Демо использует только локальную память и никогда не вызывает API бота.
Для локального Cloudflare runtime: `npm run build` → `npm run pages:dev`.
Пример серверных переменных лежит в `.dev.vars.example`, реальные `.dev.vars` исключены из Git.
Локальный runtime без действительного Access JWT не даёт управлять ботом; обхода
авторизации для разработки в production-коде нет.

## Проверки перед публикацией

```powershell
uv sync --locked --extra dev
uv run pytest -q
uv run ruff check .
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run format:check
```

Готовая конфигурация CI в `.github/workflows/checks.yml` запускает эти проверки
в GitHub Actions. GitHub не получает Telegram-сессию, ключи ИИ и секреты Cloudflare.

## Если что-то не работает

| Симптом | Что проверить |
| --- | --- |
| API 503 `not_configured` | OWNER_EMAIL, TEAM_DOMAIN и AUD заданы в нужной среде и выполнен redeploy |
| API 401 | Домен защищён Access; вход выполнен тем же email, совпадают issuer и AUD |
| Нет связи с ботом | Python запущен, cloudflared работает, BOT_API_URL корректный |
| Ошибка редиректа backend | Tunnel Access настроен на Service Auth и переданы его service secrets |
| Смена модели недоступна | Бот запущен без --api-only |
| Нет списка моделей | Провайдер поддерживает GET /models; иначе введите имя модели вручную |
| Ошибка 422 при смене провайдера | Введите ключ нового провайдера, проверьте HTTPS и поля |
| Не удаётся загрузить файл | 8 МБ, поддерживаемый формат, UTF-8, лимит песочницы 200000 символов |
| Бот молчит | Не online, чат enabled, Telegram подключён, модель и ключ корректны |
| После перезапуска молчит | Это ожидаемо: статус намеренно становится online |

Документация Cloudflare:
[Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/),
[Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/),
[проверка Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[Tunnel для приложения](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
