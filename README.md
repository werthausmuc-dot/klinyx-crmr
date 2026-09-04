# Kliny X CRM

CRM для клінінгової компанії Kliny X: клієнтська база, календар завдань,
нагадування та рахунки. Кожен співробітник заходить під власним логіном і
паролем — акаунти Claude тут ні до чого.

Застосунок написаний на чистому Node.js **без жодних зовнішніх пакетів**
(немає `express`, `bcrypt` тощо — усе на вбудованих модулях `http`,
`crypto`, `fs`). Це означає:

- не потрібно робити `npm install` — можна одразу запускати `node server.js`;
- не потрібні компілятори / build tools для нативних модулів;
- усі дані зберігаються в одному файлі `data/db.json` — просто зробити бекап.

## Вимоги

- Node.js версії 18 або новіше на сервері.
- Ніякої бази даних встановлювати не треба.

Перевірити версію Node:

```bash
node -v
```

## Швидкий старт (локально / для перевірки)

```bash
cd klinyx-crm-app
cp .env.example .env
# відкрийте .env і встановіть SESSION_SECRET (див. інструкцію в самому файлі)
node server.js
```

Відкрийте `http://localhost:3000` — оскільки користувачів ще немає, застосунок
покаже форму створення першого адміністратора. Створіть її (це будете ви),
потім у розділі **Команда** додайте облікові записи для співробітників.

## Розгортання на власному сервері (VPS)

Підходить будь-який VPS з Ubuntu/Debian (Hetzner, DigitalOcean, і т.п.).

### 1. Встановіть Node.js на сервері

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

### 2. Скопіюйте проєкт на сервер

Наприклад, через `scp` з вашого комп'ютера:

```bash
scp -r klinyx-crm-app your-user@your-server:/opt/klinyx-crm
```

### 3. Налаштуйте `.env`

```bash
cd /opt/klinyx-crm
cp .env.example .env
nano .env
```

Обов'язково задайте `SESSION_SECRET` — довгий випадковий рядок:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Якщо сайт буде працювати через HTTPS (рекомендовано, див. крок 5), встановіть
`COOKIE_SECURE=true`.

### 4. Запустіть застосунок як фонову службу (pm2)

```bash
sudo npm install -g pm2
cd /opt/klinyx-crm
pm2 start server.js --name klinyx-crm
pm2 save
pm2 startup   # виконайте команду, яку pm2 виведе на екран, щоб автозапуск працював після перезавантаження сервера
```

Перевірити, чи працює: `pm2 logs klinyx-crm` і `curl http://localhost:3000/api/auth/me`.

### 5. Відкрийте доступ через домен + HTTPS (nginx + Let's Encrypt)

Встановіть nginx і certbot:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Створіть конфіг `/etc/nginx/sites-available/klinyx-crm`:

```
server {
    listen 80;
    server_name crm.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/klinyx-crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d crm.your-domain.com
```

Після цього не забудьте виставити `COOKIE_SECURE=true` в `.env` і
перезапустити застосунок (`pm2 restart klinyx-crm`), інакше вхід через
браузер може не зберігати сесію на HTTPS.

Тепер CRM доступна на `https://crm.your-domain.com`, і кожен співробітник
заходить туди зі своїм логіном.

## Розгортання через Docker (альтернатива)

Якщо вам зручніше через Docker:

```bash
docker compose up -d --build
```

Це підніме застосунок на порту 3000 з даними у папці `./data`, яка
зберігається на хості (не зникає при перезапуску контейнера).
`docker-compose.yml` вже налаштований — тільки задайте `SESSION_SECRET`
у файлі `.env` перед запуском.

## Резервне копіювання

Усі дані (клієнти, завдання, рахунки, облікові записи) лежать в одному
файлі:

```
data/db.json
```

Регулярно копіюйте цей файл кудись окремо (наприклад, `cron`-завдання, що
раз на день робить `cp data/db.json /backup/db-$(date +%F).json`).

## Керування співробітниками

- Перший створений акаунт завжди отримує роль **адміністратор**.
- Адміністратор у розділі **Команда** може: додавати нових співробітників,
  скидати їм паролі, тимчасово вимикати доступ (без видалення), видаляти
  акаунти, призначати роль адміністратора іншим.
- Система не дозволить видалити або вимкнути **останнього** активного
  адміністратора — це захист від випадкового блокування самого себе.
- Звичайний співробітник (роль "employee") бачить і редагує клієнтів,
  завдання й рахунки, але не має доступу до розділу "Команда".

## Безпека, про яку варто знати

- Паролі зберігаються хешованими (scrypt), у відкритому вигляді ніде не
  пишуться.
- Після 8 невдалих спроб входу підряд логін тимчасово блокується на 5
  хвилин.
- Сесії живуть у пам'яті процесу: перезапуск сервера (оновлення коду,
  перезавантаження сервера) розлогінює всіх — це нормально для внутрішнього
  інструменту такого масштабу.
- Якщо цей сервер буде доступний з відкритого інтернету (а не тільки з
  вашої мережі), обов'язково використовуйте HTTPS (крок 5 вище) — інакше
  логін і паролі співробітників передаються у відкритому вигляді.

## Розробка / зміни

Структура проєкту:

```
server.js          — точка входу, HTTP-сервер
lib/store.js        — збереження даних у data/db.json
lib/auth.js          — хешування паролів, перевірка ролей
lib/sessions.js       — сесії користувачів
lib/session-cookie.js — cookie для сесій
lib/router.js         — маршрутизація запитів
lib/http-utils.js     — допоміжні функції (JSON, статичні файли)
lib/env.js            — читання .env
routes/*.js           — REST API (auth, users, clients, jobs, invoices)
public/               — фронтенд (index.html, styles.css, app.js)
data/db.json          — усі дані (створюється автоматично при першому запуску)
```

Після зміни файлів у `public/` просто оновіть сторінку в браузері — окремої
збірки не потрібно. Після зміни файлів у `routes/`, `lib/` або `server.js`
перезапустіть процес (`pm2 restart klinyx-crm` або `Ctrl+C` і знову
`node server.js`).
